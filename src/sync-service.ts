import type { RowDataPacket } from "mysql2";
import { AssistantService } from "./assistant/assistant-service.js";
import type { AiKeyStore } from "./assistant/ai-key-store.js";
import { HEAVY_MODEL_ALIAS, KeyChainClient } from "./assistant/key-chain-client.js";
import { ModelRouterClient, missingKeyProblem, primaryModels, resolveModelKeys, type ModelPlan } from "./assistant/model-router-client.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/pool.js";
import { createLogger, describeError } from "./logger.js";
import type { SettingsStore } from "./settings/settings-store.js";
import type { FileStorage } from "./storage/file-storage.js";
import { ReportExporter } from "./reports/report-exporter.js";
import { createTavilySearch } from "./assistant/tavily-search.js";
import { createFreeWebSearch } from "./assistant/free-web-search.js";
import type { WebSearchResult } from "./assistant/gemini-client.js";

/**
 * Tìm web của trợ lý: Tavily (nếu có khóa) → DuckDuckGo / Bing không cần khóa (cách của bot ERP) — rồi AssistantService
 * lùi tiếp về tìm Google của Gemini nếu cả hai hỏng.
 */
function buildWebSearchChain(tavilyApiKey: string): (query: string) => Promise<WebSearchResult> {
  const free = createFreeWebSearch();
  if (!tavilyApiKey) return free;
  const tavily = createTavilySearch(tavilyApiKey);
  return async (query) => {
    try {
      return await tavily(query);
    } catch (error) {
      log.warn(`tìm web Tavily lỗi, dùng DuckDuckGo / Bing: ${describeError(error)}`);
      return free(query);
    }
  };
}
import { MeetingScheduler } from "./google/calendar-meetings.js";
import { AttachmentDownloader } from "./sync/attachment-downloader.js";
import { ConversationType, JobKind } from "./constants.js";
import { CpuPool } from "./cpu/cpu-pool.js";
import type { JobRow } from "./jobs/job-queue.js";
import { JobRunner } from "./jobs/job-runner.js";
import { findRecipient, type RecipientMessagePayload } from "./recipients/recipient-repository.js";
import { AlertService } from "./alerts/alert-service.js";
import { workCalendarFrom } from "./background.js";
import { recordAudit } from "./web/api/audit-log.js";
import { findThreadById, GROUP_COLUMNS, type GroupRow } from "./sync/group-repository.js";
import type { ContactMessagePayload, TicketDeps } from "./tickets/ticket-service.js";
import { AccountRunner, type BackfillProgress } from "./zalo/account-runner.js";
import { listActiveAccounts, type BotAccountRow } from "./zalo/bot-account-repository.js";
import type { FriendRequestManager } from "./zalo/friend-requests.js";
import { WEB_CHAT_ID_PREFIX } from "./web/api/assistant-chat-api.js";

const log = createLogger("service");
/** Mã Zalo của dữ liệu mẫu (src/dev/demo-conversations.ts) — không gửi ra Zalo được. */
const DEMO_ZALO_ID_PREFIX = "demo-";
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

/** Giữ các tài khoản bot đang chạy — cho phép bật thêm/tắt bớt lúc đang chạy (đăng nhập QR trên web). */
export class SyncService {
  readonly downloader: AttachmentDownloader;
  /** Luồng phụ bóc chữ xlsx / docx — tệp lớn không làm đứng việc nghe tin. */
  readonly cpu = new CpuPool(1);
  /** Hàng đợi trả lời: câu hỏi ghi vào bảng job, chạy song song tối đa `assistant.concurrency` câu (08/10/2026). */
  readonly jobs: JobRunner;
  /** Cảnh báo tin nhắn (phase 5): phân loại tin mới, báo KHẨN / VIP cho người nhận. */
  readonly alerts: AlertService;
  /** Ticket qua bot (08/10/2026): lệnh trên Zalo + màn Ticket trên web dùng chung. */
  readonly tickets: TicketDeps;
  private currentAssistant: AssistantService | null;
  private readonly runners = new Map<number, AccountRunner>();

  constructor(
    readonly db: Db,
    readonly config: AppConfig,
    readonly storage: FileStorage,
    readonly settings: SettingsStore,
    /** Bảng «Khóa AI»: còn khóa dùng được thì bot chạy bằng chuỗi khóa, bỏ qua các ô AI cũ của tab Trợ lý. */
    readonly aiKeys: AiKeyStore | null = null,
  ) {
    this.downloader = new AttachmentDownloader(db, storage, {
      concurrency: config.downloadConcurrency,
      maxFileBytes: config.maxFileBytes,
    });
    this.tickets = {
      db,
      requestDownload: (ids) => { for (const id of ids) this.downloader.enqueue(id); },
      wakeJobs: () => this.jobs?.wake(),
    };
    this.currentAssistant = this.buildAssistant();
    this.jobs = new JobRunner({
      db, role: "app", concurrency: config.assistant.concurrency,
      handlers: {
        [JobKind.AssistantDirectReply]: (job) => this.runnerForJob(job).runDirectReplyJob(job),
        [JobKind.AssistantGroupReply]: (job) => this.runnerForJob(job).runGroupReplyJob(job),
        [JobKind.RecipientMessage]: (job) => this.sendRecipientMessage(job.payload as RecipientMessagePayload),
        [JobKind.AlertDispatch]: (job) => this.alerts.runDispatchJob(job),
        [JobKind.ContactMessage]: (job) => this.sendContactMessage(job),
      },
    });
    const getCalendar = workCalendarFrom(config);
    this.alerts = new AlertService(db, config, () => getCalendar(), () => this.jobs.wake(),
      (recipientId, text) => this.sendRecipientMessage({ recipientId, text }));
  }

  /** Việc trả lời phải chạy đúng tài khoản bot đã nhận câu hỏi (phiên Zalo của tài khoản đó gửi câu trả lời). */
  private runnerForJob(job: JobRow): AccountRunner {
    const accountId = Number((job.payload as { accountId?: unknown }).accountId);
    const runner = this.runners.get(accountId);
    if (!runner) throw new Error(`tài khoản bot #${accountId} đang tắt`);
    return runner;
  }

  /**
   * Nhắn riêng cho một người nhận (kênh báo / lệnh, phase 4). Gửi bằng tài khoản bot đã có cuộc riêng với người đó
   * (người nhận đã kết bạn / từng nhắn với bot đó); chưa có thì tài khoản bot đầu tiên đang chạy. Lỗi thì ném — hàng
   * đợi thử lại.
   */
  private async sendRecipientMessage(payload: RecipientMessagePayload): Promise<void> {
    const recipient = await findRecipient(this.db, payload.recipientId);
    if (!recipient || !recipient.is_active) return;
    const [threads] = await this.db.query<RowDataPacket[]>(
      "SELECT owner_bot_id FROM zalo_group WHERE thread_type = ? AND zalo_group_id = ? ORDER BY last_message_at DESC",
      [ConversationType.Direct, recipient.zalo_uid]);
    const ownerIds = threads.map((row) => Number(row.owner_bot_id));
    const runner = ownerIds.map((id) => this.runners.get(id)).find(Boolean) ?? [...this.runners.values()][0];
    if (!runner) throw new Error("không có tài khoản bot nào đang chạy để nhắn người nhận");
    await runner.sendDirectText(recipient.zalo_uid, recipient.name, payload.text);
  }

  /**
   * Tin báo ticket: vào một cuộc có sẵn (`threadId` — tin riêng thì đúng tài khoản bot chủ cuộc, nhóm thì tài khoản bot
   * đang ở nhóm) hoặc nhắn riêng một người (`zaloUid`). Tệp kèm: tệp chưa vào kho thì đợi lượt thử sau; lượt cuối gửi
   * những tệp đã có. Lỗi thì ném — hàng đợi thử lại.
   */
  private async sendContactMessage(job: JobRow): Promise<void> {
    const payload = job.payload as ContactMessagePayload;
    const attachmentIds = payload.attachmentIds ?? [];
    let ready = attachmentIds;
    if (attachmentIds.length) {
      const [rows] = await this.db.query<RowDataPacket[]>("SELECT id FROM attachment WHERE id IN (?) AND status = 1", [attachmentIds]);
      ready = attachmentIds.filter((id) => rows.some((row) => Number(row.id) === id));
      const lastAttempt = job.attempts >= job.maxAttempts;
      if (ready.length < attachmentIds.length && !lastAttempt) throw new Error(`còn ${attachmentIds.length - ready.length} tệp chưa tải về kho`);
    }
    if (payload.threadId) {
      const thread = await findThreadById(this.db, payload.threadId);
      if (!thread) return;
      const runner = await this.runnerForThread(thread);
      if (payload.text) await runner.sendThreadText(thread, payload.text);
      for (const id of ready) await runner.sendThreadStoredFile(thread, id);
      return;
    }
    if (!payload.zaloUid) return;
    const [threads] = await this.db.query<RowDataPacket[]>(
      "SELECT owner_bot_id FROM zalo_group WHERE thread_type = ? AND zalo_group_id = ? ORDER BY last_message_at DESC",
      [ConversationType.Direct, payload.zaloUid]);
    const runner = threads.map((row) => this.runners.get(Number(row.owner_bot_id))).find(Boolean) ?? [...this.runners.values()][0];
    if (!runner) throw new Error("không có tài khoản bot nào đang chạy");
    if (payload.text) await runner.sendDirectText(payload.zaloUid, payload.name ?? "", payload.text);
    for (const id of ready) await runner.sendDirectStoredFile(payload.zaloUid, id);
  }

  /** Tài khoản bot gửi được vào một cuộc: tin riêng → bot chủ cuộc; nhóm → bot đang ở nhóm. */
  private async runnerForThread(thread: GroupRow): Promise<AccountRunner> {
    if (thread.thread_type === ConversationType.Direct) {
      const runner = this.runners.get(Number(thread.owner_bot_id));
      if (runner) return runner;
    } else {
      const [rows] = await this.db.query<RowDataPacket[]>("SELECT bot_account_id FROM bot_group WHERE group_id = ?", [thread.id]);
      const runner = rows.map((row) => this.runners.get(Number(row.bot_account_id))).find(Boolean);
      if (runner) return runner;
    }
    const fallback = [...this.runners.values()][0];
    if (!fallback) throw new Error("không có tài khoản bot nào đang chạy");
    return fallback;
  }

  /** Trợ lý AI đang dùng (null = tắt). Đổi khóa / mô hình trên màn Cài đặt thì dựng lại — xem applySettings. */
  get assistant(): AssistantService | null {
    return this.currentAssistant;
  }

  private buildAssistant(): AssistantService | null {
    const settings = this.config.assistant;
    const { apiKey, openaiApiKey, maxPerHour, dailyTokenCap, dailyTokenCapPerBot, maxReadFileBytes, readableFileTypes, showTokenUsage } = settings;
    const limits = { maxPerHour, dailyTokenCap, dailyTokenCapPerBot };
    const options = {
      storage: this.storage, maxReadFileBytes, readableFileTypes, showTokenUsage,
      heavyExtract: (task: "sheet" | "docx", data: Buffer) => this.cpu.run(task, data),
      privacy: { maskPersonalData: this.config.privacy.maskPersonalData, blockWebForAgroTechnical: this.config.privacy.blockWebForAgroTechnical },
      alertTools: {
        db: this.db, config: this.config,
        saveSettings: async (patch: Record<string, unknown>, actor: string) => {
          const changed = await this.settings.save(patch, actor);
          if (changed.length) {
            this.applySettings(changed);
            await recordAudit(this.db, { entity: "setting", entityId: 1, action: "update", message: `Đổi qua Zalo bởi ${actor}`, changedFields: changed });
          }
          return changed;
        },
        invalidate: () => this.alerts.invalidate(),
      },
      tickets: this.tickets,
      webSearch: buildWebSearchChain(this.config.assistant.tavilyApiKey),
      reportExporter: new ReportExporter(this.storage, () => this.config.google),
      meetingScheduler: new MeetingScheduler(() => this.config.google),
    };
    // Bảng Khóa AI có khóa → chuỗi khóa (khóa số 1 trước, hỏng thì khóa kế); bảng rỗng → cài đặt cũ như trước 07/10/2026
    const chainKeys = this.aiKeys?.buildChainKeys(this.config.privacy.allowedAiProviders) ?? [];
    if (this.aiKeys && chainKeys.length) {
      log.info(`trợ lý AI bật — bảng Khóa AI: ${chainKeys.map((key) => `${key.label} ${key.model}`).join(" → ")}`);
      // Việc nặng: mỗi khóa tự đổi HEAVY_MODEL_ALIAS thành mô hình việc nặng của nó (không khai thì chính mô hình chính)
      return new AssistantService(this.db, new KeyChainClient(chainKeys, this.aiKeys.ledger), chainKeys[0].model, limits,
        () => new Date(), { ...options, heavyModel: HEAVY_MODEL_ALIAS });
    }
    const keys = resolveModelKeys({ geminiKey: apiKey, openaiKey: openaiApiKey, openaiBaseUrl: settings.openaiBaseUrl });
    const plan: ModelPlan = {
      provider: settings.provider,
      gemini: { model: settings.model, heavyModel: settings.heavyModel, fallbackModels: settings.fallbackModels },
      openai: { model: settings.openaiModel, heavyModel: settings.openaiHeavyModel, fallbackModels: settings.openaiFallbackModels },
    };
    // Bên trả lời chính quyết định tên mô hình chính / bản nặng mà AssistantService dùng
    const { model, heavyModel } = primaryModels(plan, keys);
    const problem = missingKeyProblem(plan.provider, keys);
    const assistant = !problem
      ? new AssistantService(this.db, new ModelRouterClient(keys, plan), model, limits, () => new Date(),
          { ...options, heavyModel: heavyModel || undefined })
      : null;
    log.info(assistant
      ? `trợ lý AI bật (${plan.provider}: ${model}; việc nặng: ${heavyModel || model}${plan.provider === "openai_then_gemini" && keys.geminiKey ? `; lỗi thì lùi về ${plan.gemini.model}` : ""})`
      : `trợ lý AI tắt — ${problem}`);
    return assistant;
  }

  /**
   * Cài đặt vừa đổi trên web (giá trị mới đã phủ lên `config`): dựng lại những thứ chép giá trị lúc khởi
   * tạo. `default_*` không cần làm gì — runner đọc thẳng `config` mỗi lần dùng.
   */
  applySettings(changedKeys: string[]): void {
    const notAssistantBuild = new Set(["assistant_send_interval_ms", "assistant_concurrency"]);
    const assistantChanged = changedKeys.some((key) =>
      key.startsWith("gemini_") || key.startsWith("openai_") || key.startsWith("privacy_") || key === "ai_provider"
      || (key.startsWith("assistant_") && !notAssistantBuild.has(key)));
    if (assistantChanged) this.rebuildAssistant();
    if (changedKeys.includes("assistant_concurrency")) this.jobs.setConcurrency(this.config.assistant.concurrency);
    if (changedKeys.some((key) => key.startsWith("alert_"))) this.alerts.invalidate();
    if (changedKeys.includes("max_file_mb")) this.downloader.setMaxFileBytes(this.config.maxFileBytes);
    if (changedKeys.includes("assistant_send_interval_ms")) {
      for (const runner of this.runners.values()) runner.setSendInterval(this.config.assistant.sendIntervalMs);
    }
  }

  /** Bảng Khóa AI vừa đổi (thêm / sửa / đưa lên / gỡ) — dựng lại trợ lý theo chuỗi khóa mới. */
  applyAiKeys(): void {
    this.rebuildAssistant();
  }

  private rebuildAssistant(): void {
    this.currentAssistant = this.buildAssistant();
    // Lượt hỏi đang chạy dở thì chạy nốt bằng bản cũ — không hủy
    for (const runner of this.runners.values()) runner.setAssistant(this.currentAssistant);
  }

  async startAll(): Promise<void> {
    const resumed = await this.downloader.resumePending();
    if (resumed) log.info(`tải tiếp ${resumed} tệp còn dở`);
    const accounts = await listActiveAccounts(this.db);
    if (!accounts.length) log.warn("chưa có tài khoản bot nào — đăng nhập bằng QR trên giao diện web");
    for (const account of accounts) await this.startAccount(account);
    log.info(`đang chạy ${this.runners.size}/${accounts.length} tài khoản bot`);
    // Bật bộ chạy việc SAU khi các tài khoản đã chạy — câu hỏi còn trong hàng từ lần trước có runner để trả lời
    await this.jobs.start();
    this.alerts.start();
  }

  isRunning(accountId: number): boolean {
    return this.runners.has(accountId);
  }

  /** Việc kết bạn của một tài khoản bot đang chạy (tab «Kết bạn»); null = tài khoản đang tắt / chưa kết nối. */
  friendsFor(accountId: number): FriendRequestManager | null {
    return this.runners.get(accountId)?.friends ?? null;
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
    // Dữ liệu mẫu (npm run seed:demo) mang mã giả `demo-…` — đẩy sang Zalo chỉ nhận lại «Tham số không hợp lệ»
    if (thread.zalo_group_id.startsWith(DEMO_ZALO_ID_PREFIX)) {
      throw new Error("đây là cuộc DEMO (dữ liệu mẫu), không có thật trên Zalo. Gửi thử vào một nhóm hoặc cuộc riêng thật.");
    }
    // Cuộc «Hỏi trợ lý» trên web (mã web-…) chỉ có trong kho — hỏi tiếp ở màn Hỏi trợ lý
    if (thread.zalo_group_id.startsWith(WEB_CHAT_ID_PREFIX)) {
      throw new Error("đây là cuộc Hỏi trợ lý trên web, không có trên Zalo — hỏi tiếp ở màn «Hỏi trợ lý».");
    }
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
    // Thôi nhận việc mới, chờ câu đang trả lời dở xong rồi mới tắt phiên Zalo
    this.alerts.stop();
    await this.jobs.stop();
    this.downloader.stop();
    await Promise.allSettled([...this.runners.keys()].map((id) => this.stopAccount(id)));
    await this.cpu.close();
  }

  private async startAccount(account: BotAccountRow): Promise<boolean> {
    const runner = new AccountRunner(account, this.db, this.config, this.downloader, this.storage, this.assistant, this.jobs);
    if (!(await runner.start())) return false;
    this.runners.set(account.id, runner);
    return true;
  }
}
