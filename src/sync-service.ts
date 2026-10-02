import type { RowDataPacket } from "mysql2";
import { AssistantService } from "./assistant/assistant-service.js";
import { GeminiClient } from "./assistant/gemini-client.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/pool.js";
import { createLogger, describeError } from "./logger.js";
import type { FileStorage } from "./storage/file-storage.js";
import { AttachmentDownloader } from "./sync/attachment-downloader.js";
import { cacheAvatars } from "./sync/avatar-cache.js";
import { ConversationType } from "./constants.js";
import { GROUP_COLUMNS, type GroupRow } from "./sync/group-repository.js";
import { AccountRunner, type BackfillProgress } from "./zalo/account-runner.js";
import { listActiveAccounts, type BotAccountRow } from "./zalo/bot-account-repository.js";

const log = createLogger("service");
/** «Lấy hết»: 400 trang × 50 = 20.000 tin — đủ cho nhóm lớn mà không kéo vô tận. */
const BACKFILL_FULL_MAX_PAGES = 400;
/** Lúc vừa bật đọc: vài trang gần nhất cho nhóm có nội dung ngay. */
const BACKFILL_QUICK_MAX_PAGES = 4;

export interface BackfillJob extends BackfillProgress {
  groupId: number;
  full: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  method: string;
  error: string;
}
const AVATAR_INTERVAL_MS = 2 * 60 * 1000;

/** Giữ các tài khoản bot đang chạy — cho phép bật thêm/tắt bớt lúc đang chạy (đăng nhập QR trên web). */
export class SyncService {
  readonly downloader: AttachmentDownloader;
  readonly assistant: AssistantService | null;
  private readonly runners = new Map<number, AccountRunner>();
  private avatarTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly db: Db,
    readonly config: AppConfig,
    readonly storage: FileStorage,
  ) {
    this.downloader = new AttachmentDownloader(db, storage, {
      concurrency: config.downloadConcurrency,
      maxFileBytes: config.maxFileBytes,
    });
    const { apiKey, model, heavyModel, fallbackModels, maxPerHour, dailyTokenCap, maxReadFileBytes } = config.assistant;
    this.assistant = apiKey
      ? new AssistantService(db, new GeminiClient(apiKey, model, fallbackModels), model, { maxPerHour, dailyTokenCap }, () => new Date(),
          { storage, heavyModel: heavyModel || undefined, maxReadFileBytes })
      : null;
    log.info(this.assistant ? `trợ lý AI bật (${model}; việc nặng: ${heavyModel || model})` : "trợ lý AI tắt — chưa có GEMINI_API_KEY");
  }

  async startAll(): Promise<void> {
    const resumed = await this.downloader.resumePending();
    if (resumed) log.info(`tải tiếp ${resumed} tệp còn dở`);
    const accounts = await listActiveAccounts(this.db);
    if (!accounts.length) log.warn("chưa có tài khoản bot nào — đăng nhập bằng QR trên giao diện web");
    for (const account of accounts) await this.startAccount(account);
    log.info(`đang chạy ${this.runners.size}/${accounts.length} tài khoản bot`);
    // Ảnh đại diện: tải nền theo lô, lần đầu sau 30 giây (đợi quét nhóm + thành viên xong)
    const runAvatars = () => cacheAvatars(this.db, this.storage).catch((error) => log.warn("tải ảnh đại diện lỗi", error));
    setTimeout(runAvatars, 30_000).unref();
    this.avatarTimer = setInterval(runAvatars, AVATAR_INTERVAL_MS);
  }

  isRunning(accountId: number): boolean {
    return this.runners.has(accountId);
  }

  /** Chạy (hoặc chạy lại sau khi quét QR mới) một tài khoản theo id. */
  async restartAccount(accountId: number): Promise<boolean> {
    await this.stopAccount(accountId);
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT * FROM bot_account WHERE id = ?", [accountId]);
    const account = rows[0] as BotAccountRow | undefined;
    if (!account || !account.is_active || !account.session_cipher) return false;
    return this.startAccount(account);
  }

  async stopAccount(accountId: number): Promise<void> {
    const runner = this.runners.get(accountId);
    if (!runner) return;
    this.runners.delete(accountId);
    await runner.stop();
  }

  /** Việc lấy tin cũ đang chạy / vừa xong của từng nhóm (trong bộ nhớ; khởi động lại là mất, không sao). */
  private readonly backfillJobs = new Map<number, BackfillJob>();

  getBackfillJob(groupId: number): BackfillJob | null {
    return this.backfillJobs.get(groupId) ?? null;
  }

  /**
   * Bắt đầu lấy tin cũ của một nhóm ở NỀN (nhóm nghìn tin kéo vài phút — không giữ HTTP chờ).
   * `full` = kéo tới hết (trần BACKFILL_FULL_MAX_PAGES); không thì vài trang gần nhất, dừng sớm khi gặp tin đã có.
   */
  async startBackfill(groupId: number, options: { full: boolean }): Promise<BackfillJob> {
    const running = this.backfillJobs.get(groupId);
    if (running && !running.finishedAt) return running;
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT g.zalo_group_id, bg.bot_account_id FROM zalo_group g
       JOIN bot_group bg ON bg.group_id = g.id AND bg.left_at IS NULL
       WHERE g.id = ? ORDER BY bg.bot_account_id`,
      [groupId],
    );
    const pick = rows.find((row) => this.runners.has(row.bot_account_id as number));
    if (!pick) throw new Error("Không có bot nào đang chạy trong nhóm này");
    const job: BackfillJob = { groupId, full: options.full, startedAt: new Date(), finishedAt: null, pages: 0, fetched: 0, stored: 0, oldest: null, method: "", error: "" };
    this.backfillJobs.set(groupId, job);
    const runner = this.runners.get(pick.bot_account_id as number)!;
    void runner
      .backfillGroup(pick.zalo_group_id as string, {
        maxPages: options.full ? BACKFILL_FULL_MAX_PAGES : BACKFILL_QUICK_MAX_PAGES,
        stopWhenKnown: !options.full,
        onProgress: (progress) => Object.assign(job, progress),
      })
      .then((result) => Object.assign(job, result))
      .catch((error) => { job.error = describeError(error); })
      .finally(() => { job.finishedAt = new Date(); });
    return job;
  }

  /**
   * Bot đang chạy để gửi vào một cuộc: cuộc riêng → bot chủ cuộc (owner_bot_id); nhóm → một bot
   * còn trong nhóm. Không có thì báo rõ để giao diện nói với người dùng.
   */
  private async pickRunnerForThread(threadId: number): Promise<{ runner: AccountRunner; thread: GroupRow }> {
    const [rows] = await this.db.query<RowDataPacket[]>(`SELECT ${GROUP_COLUMNS} FROM zalo_group WHERE id = ?`, [threadId]);
    const thread = rows[0] as GroupRow | undefined;
    if (!thread) throw new Error("Không có cuộc trò chuyện này");
    if (thread.thread_type === ConversationType.Direct) {
      const runner = this.runners.get(thread.owner_bot_id);
      if (!runner) throw new Error("Tài khoản bot của cuộc này đang tắt hoặc chưa kết nối");
      return { runner, thread };
    }
    const [bots] = await this.db.query<RowDataPacket[]>(
      "SELECT bot_account_id FROM bot_group WHERE group_id = ? AND left_at IS NULL ORDER BY bot_account_id", [threadId]);
    const pick = bots.find((row) => this.runners.has(row.bot_account_id as number));
    if (!pick) throw new Error("Không có tài khoản bot nào đang chạy trong nhóm này");
    return { runner: this.runners.get(pick.bot_account_id as number)!, thread };
  }

  async sendAdminText(threadId: number, text: string): Promise<number | null> {
    const { runner, thread } = await this.pickRunnerForThread(threadId);
    return runner.sendAdminText(thread, text);
  }

  async sendAdminFile(threadId: number, data: Buffer, fileName: string, contentType: string): Promise<number | null> {
    const { runner, thread } = await this.pickRunnerForThread(threadId);
    return runner.sendAdminFile(thread, data, fileName, contentType);
  }

  async stopAll(): Promise<void> {
    if (this.avatarTimer) clearInterval(this.avatarTimer);
    this.downloader.stop();
    await Promise.allSettled([...this.runners.keys()].map((id) => this.stopAccount(id)));
  }

  private async startAccount(account: BotAccountRow): Promise<boolean> {
    const runner = new AccountRunner(account, this.db, this.config, this.downloader, this.storage, this.assistant);
    if (!(await runner.start())) return false;
    this.runners.set(account.id, runner);
    return true;
  }
}
