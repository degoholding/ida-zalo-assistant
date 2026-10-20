import { parseMcpFamilies } from "./assistant/mcp-bridge/assistant-mcp-families.js";
import { ConcurrencyGate } from "./mcp/mcp-concurrency-gate.js";
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
import { DriveClient } from "./google/drive-client.js";
import { hasDriveScope } from "./google/google-oauth.js";
import { runOndemandRecap, type OndemandDestination } from "./meetings/meeting-recap-ondemand.js";
import { AttachmentDownloader, requestAndAwaitDownload } from "./sync/attachment-downloader.js";
import { BackfillBusyError, MAX_CONCURRENT_BACKFILLS_PER_ACCOUNT } from "./sync/backfill-busy-error.js";
import { BotAccountKind, BriefKind, BriefTrigger, ConversationType, JobKind } from "./constants.js";
import { CpuPool } from "./cpu/cpu-pool.js";
import type { JobRow } from "./jobs/job-queue.js";
import { JobSkippedError } from "./jobs/job-skipped-error.js";
import { JobRunner, type JobHandler } from "./jobs/job-runner.js";
import { markBriefFailed, markBriefSent } from "./briefs/brief-log-repository.js";
import type { BriefChatDeps } from "./briefs/brief-commands.js";
import { HighlightCache } from "./briefs/brief-ai-highlights.js";
import { produceBrief, type BriefDeps, type ProducedBrief } from "./briefs/brief-delivery.js";
import { findRecipient, type RecipientMessagePayload } from "./recipients/recipient-repository.js";
import { PeriodicStatsCache } from "./reports/periodic-report-stats-cache.js";
import { AlertService } from "./alerts/alert-service.js";
import { assertNotHalted, BotHaltControl } from "./messaging/bot-halt.js";
import { buildAlertModelClient } from "./alerts/ai-review.js";
import { workCalendarFrom } from "./background.js";
import type { WorkCalendar } from "./schedule/work-calendar.js";
import { recordAudit } from "./web/api/audit-log.js";
import { GROUP_COLUMNS, findThreadById, type GroupRow } from "./sync/group-repository.js";
import type { TicketDeps } from "./tickets/ticket-service.js";
import type { ContactMessagePayload } from "./messaging/contact-message.js";
import { deliverContactMessage } from "./messaging/contact-message-delivery.js";
import { runSendTargetJob } from "./send-commands/send-command-delivery.js";
import type { SendCommandDeps, SendDeliveryDeps } from "./send-commands/send-command-deps.js";
import { AccountRunner, type BackfillProgress } from "./zalo/account-runner.js";
import { listActiveAccounts, type BotAccountRow } from "./zalo/bot-account-repository.js";
import type { FriendRequestManager } from "./zalo/friend-requests.js";
import { WEB_CHAT_ID_PREFIX } from "./web/api/assistant-chat-api.js";
import { isCollectOnlyThread } from "./sync/collect-only.js";
import { noSendableRunnerError, pickSendableRunner } from "./sync/sendable-runner-picker.js";
import { CollectOnlyAccountError } from "./zalo/collect-only-account-error.js";

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
  /** Tắt bot khẩn (phase 9): web API + lệnh Zalo cùng gọi `halt` / `resume` / `status` — app là nơi DUY NHẤT ghi cờ. */
  readonly botHalt: BotHaltControl;
  /** Ticket qua bot (08/10/2026): lệnh trên Zalo + màn Ticket trên web dùng chung. */
  readonly tickets: TicketDeps;
  /** Lịch làm việc hiện hành (phase 8: bản tin / báo cáo gọi tay cần lịch để tính kỳ) — dựng ngay đầu constructor để
   * `buildAssistant()` (gọi ngay sau) dùng được; cùng một cái với `AlertService`, dựng lại khi cài đặt lịch đổi. */
  private readonly getCalendar: () => WorkCalendar;
  private currentAssistant: AssistantService | null;
  /** Cổng đồng thời RIÊNG của trợ lý qua MCP — giữ qua các lần dựng lại trợ lý (đổi cài đặt) để chỗ đang chạy không bị đếm lại. */
  private readonly assistantMcpGate: ConcurrencyGate;
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
    this.botHalt = new BotHaltControl(db, config, settings);
    this.getCalendar = workCalendarFrom(config);
    this.assistantMcpGate = new ConcurrencyGate(config.assistant.mcpMaxConcurrent, config.assistant.mcpQueueWaitMs);
    this.currentAssistant = this.buildAssistant();
    this.jobs = new JobRunner({
      db, role: "app", concurrency: config.assistant.concurrency,
      // Mọi handler đều là gửi tin ra Zalo → bọc `guard`: bot đang tắt khẩn thì ném BotHaltedError, JobRunner bỏ việc
      // (Expired, không thử lại). Phase 4 thêm handler SendCommandTarget vào cùng `guard`.
      handlers: {
        [JobKind.AssistantDirectReply]: this.guard((job) => this.runnerForJob(job).runDirectReplyJob(job)),
        [JobKind.AssistantGroupReply]: this.guard((job) => this.runnerForJob(job).runGroupReplyJob(job)),
        [JobKind.RecipientMessage]: this.guard((job) => this.sendRecipientMessage(job.payload as RecipientMessagePayload, job)),
        [JobKind.AlertDispatch]: this.guard((job) => this.alerts.runDispatchJob(job)),
        [JobKind.ContactMessage]: this.guard((job) => this.sendContactMessage(job)),
        // Lệnh gửi theo lệnh (phase 9): MỘT job / nơi nhận; tiến độ ghi vào payload (giữ targetId) qua cùng đường giao tin
        [JobKind.SendCommandTarget]: this.guard((job) => runSendTargetJob(this.sendDeliveryDeps(), job)),
      },
    });
    this.alerts = new AlertService(db, config, () => this.getCalendar(), () => this.jobs.wake(),
      (recipientId, text) => this.sendRecipientMessage({ recipientId, text }));
  }

  /**
   * Phụ thuộc của lõi lệnh gửi (phase 9): dùng chung cho trợ lý (lệnh gõ / công cụ AI), handler job và web. Lịch đọc LÚC DÙNG
   * (getter): chỉ dựng nháp cần lịch — lịch cài sai không được làm sập khởi động, chặn giao tin hay chặn hủy lệnh trên web.
   */
  sendCommandDeps(): SendCommandDeps {
    const getCalendar = this.getCalendar;
    return {
      db: this.db, wakeJobs: () => this.jobs?.wake(), requestDownload: (ids) => { for (const id of ids) this.downloader.enqueue(id); },
      get calendar() { return getCalendar(); },
    };
  }

  /** Không dùng spread (`...`) — spread gọi getter `calendar` ngay. */
  private sendDeliveryDeps(): SendDeliveryDeps {
    const deps = this.sendCommandDeps() as SendDeliveryDeps;
    deps.port = {
      deliver: (payload, job) => this.sendContactMessage(job, payload),
      createReminder: async (request) => {
        const thread = await findThreadById(this.db, request.threadId);
        if (!thread) throw new JobSkippedError("nhóm không còn trong hệ thống");
        await (await this.runnerForThread(thread)).createGroupReminder(thread, request, request.checkExisting);
      },
      createPin: async (request) => {
        const thread = await findThreadById(this.db, request.threadId);
        if (!thread) throw new JobSkippedError("nhóm không còn trong hệ thống");
        await (await this.runnerForThread(thread)).createGroupPin(thread, request.content, request.checkExisting);
      },
    };
    return deps;
  }

  /** Bọc handler gửi tin: bot đang tắt khẩn thì không chạy (ném BotHaltedError → việc bị bỏ, không thử lại). */
  private guard(handler: JobHandler): JobHandler {
    return async (job) => {
      assertNotHalted(this.config);
      await handler(job);
    };
  }

  /** Lịch cài sai (CalendarInputError) thì báo lỗi ở bản tin thay vì sập — khuôn giống `background.ts` `safeCalendar`. */
  private safeCalendar(): WorkCalendar | null {
    try {
      return this.getCalendar();
    } catch {
      return null;
    }
  }

  /**
   * Nút «Gửi thử bản tin» màn Người nhận (phase 4, quản trị) — soạn + xếp hàng gửi NGAY, trigger `WebTest` nên không
   * dùng `dedupe_key` (không chặn bản theo lịch chạy trong ngày). `recipients-api.ts` đã kiểm người nhận này tồn tại
   * (404 nếu không) trước khi gọi; ở đây kiểm lại `is_active` vì `produceBrief` cần `RecipientRow` đầy đủ.
   */
  async sendTestBrief(recipientId: number, kind: BriefKind, now: Date = new Date()): Promise<ProducedBrief | null> {
    const recipient = await findRecipient(this.db, recipientId);
    if (!recipient || !recipient.is_active) throw new Error("Người nhận này đang tắt — bật «Đang dùng» rồi thử lại.");
    const calendar = this.safeCalendar();
    if (!calendar) throw new Error("Lịch làm việc đang cấu hình sai — kiểm tra ở màn Cài đặt.");
    const deps: BriefDeps = {
      db: this.db, config: this.config, calendar, storage: this.storage,
      client: () => buildAlertModelClient(this.db, this.config), highlightCache: new HighlightCache(),
      messageStatsCache: new PeriodicStatsCache(),
    };
    const result = await produceBrief(deps, recipient, kind, BriefTrigger.WebTest, now);
    this.jobs.wake();
    return result;
  }

  /** Việc trả lời phải chạy đúng tài khoản bot đã nhận câu hỏi (phiên Zalo của tài khoản đó gửi câu trả lời). */
  private runnerForJob(job: JobRow): AccountRunner {
    const accountId = Number((job.payload as { accountId?: unknown }).accountId);
    const runner = this.runners.get(accountId);
    if (!runner) throw new Error(`tài khoản bot #${accountId} đang tắt`);
    // Việc xếp hàng từ lúc tài khoản còn là Trợ lý, sau đó quản trị đổi sang Normal: bỏ việc, không thử lại
    if (runner.isCollectOnly) throw new CollectOnlyAccountError();
    return runner;
  }

  /**
   * Nhắn riêng cho một người nhận (kênh báo / lệnh, phase 4), hoặc gửi bản tóm tắt + tệp báo cáo (`reportFiles`, phase 3
   * — báo cáo tuần / tháng: MỘT job gửi chữ rồi tới từng tệp, xem brief-delivery.ts `enqueuePeriodicReportJob`, review
   * phase 8 M2+M3). Gửi bằng tài khoản bot đã có cuộc riêng với người đó (người nhận đã kết bạn / từng nhắn với bot
   * đó); chưa có thì tài khoản bot đầu tiên đang chạy.
   *
   * `job` (có khi gọi từ hàng đợi, không có khi `AlertService` gọi thẳng) dùng để: (1) ghi lại đã gửi tới đâu
   * (`textSent` / `sentFileCount`) ngay vào payload của CHÍNH job này sau mỗi phần thành công — thử lại (lỗi giữa
   * chừng) không gửi lặp phần đã xong; (2) biết đây có phải LƯỢT THỬ CUỐI để ghi `brief_log` Failed kèm lỗi thật thay
   * vì chỉ im lặng hết hạn (job hết hạn hàng đợi mà KHÔNG qua đây thì `reconcileExpiredBriefJobs` dọn, brief-runner.ts).
   * Lỗi gửi thì ném tiếp — hàng đợi tự thử lại theo `retryDelayMs`.
   */
  private async sendRecipientMessage(payload: RecipientMessagePayload, job?: JobRow): Promise<void> {
    const recipient = await findRecipient(this.db, payload.recipientId);
    if (!recipient || !recipient.is_active) return;
    const [threads] = await this.db.query<RowDataPacket[]>(
      "SELECT owner_bot_id FROM zalo_group WHERE thread_type = ? AND zalo_group_id = ? ORDER BY last_message_at DESC",
      [ConversationType.Direct, recipient.zalo_uid]);
    const ownerIds = threads.map((row) => Number(row.owner_bot_id));
    // Chỉ bot Trợ lý nhắn được; hết bot gửi được thì bỏ việc (không rơi về «runner đầu tiên» — có thể là tài khoản Normal)
    const runner = pickSendableRunner(ownerIds.map((id) => this.runners.get(id)), this.runners.values());
    if (!runner) {
      const error = await noSendableRunnerError(this.db, "nhắn người nhận");
      if (error instanceof JobSkippedError) {
        log.warn(`bỏ việc nhắn «${recipient.name}»: hệ thống không có tài khoản bot Trợ lý nào dùng được`);
        if (payload.briefLogId) {
          await markBriefFailed(this.db, payload.briefLogId, error.message).catch((dbError) =>
            log.error(`ghi brief_log #${payload.briefLogId} Failed lỗi`, describeError(dbError)));
        }
      }
      throw error;
    }

    const persistProgress = async (patch: Partial<RecipientMessagePayload>): Promise<void> => {
      Object.assign(payload, patch);
      if (job) await this.db.query("UPDATE job SET payload = ? WHERE id = ?", [JSON.stringify(payload), job.id]);
    };
    try {
      if (payload.text && !payload.textSent) {
        await runner.sendDirectText(recipient.zalo_uid, recipient.name, payload.text);
        await persistProgress({ textSent: true });
      }
      const files = payload.reportFiles ?? [];
      for (let index = payload.sentFileCount ?? 0; index < files.length; index += 1) {
        await runner.sendDirectReportFile(recipient.zalo_uid, recipient.name, files[index]);
        await persistProgress({ sentFileCount: index + 1 });
      }
    } catch (error) {
      // Lượt thử CUỐI mà vẫn lỗi: ghi brief_log Failed kèm lý do thay vì để Queued mãi (review phase 8, M3)
      if (payload.briefLogId && job && job.attempts >= job.maxAttempts) {
        await markBriefFailed(this.db, payload.briefLogId, describeError(error)).catch((dbError) =>
          log.error(`ghi brief_log #${payload.briefLogId} Failed lỗi`, describeError(dbError)));
      }
      throw error;
    }
    if (payload.briefLogId) {
      // Gửi đã xong — lỗi ghi Sent không được bắt gửi lại nguyên bản tin lần nữa, chỉ log (review phase 8, M1)
      await markBriefSent(this.db, payload.briefLogId).catch((error) =>
        log.error(`đánh dấu brief_log #${payload.briefLogId} Sent lỗi`, describeError(error)));
    }
  }

  /**
   * Tin báo ticket / việc / recap họp (phase 4) và lệnh gửi (phase 9): giao qua `deliverContactMessage` — vào một cuộc có
   * sẵn (tin riêng → đúng tài khoản bot chủ cuộc, nhóm → bot đang ở nhóm) hoặc nhắn riêng một người (`zaloUid`). Tiến độ
   * chữ / tệp đính kèm / tệp báo cáo ghi vào CHÍNH payload của job — thử lại không gửi lặp phần đã xong.
   */
  private sendContactMessage(job: JobRow, payload: ContactMessagePayload = job.payload as ContactMessagePayload): Promise<void> {
    return deliverContactMessage({
      db: this.db, runnerForThread: (thread) => this.runnerForThread(thread), runnerForUid: (zaloUid) => this.runnerForUid(zaloUid),
    }, payload, job);
  }

  /** Tài khoản bot nhắn riêng một người: bot đã có cuộc riêng với người đó (cuộc mới nhất); chưa có thì bot đầu tiên đang chạy. */
  private async runnerForUid(zaloUid: string): Promise<AccountRunner> {
    const [threads] = await this.db.query<RowDataPacket[]>(
      "SELECT owner_bot_id FROM zalo_group WHERE thread_type = ? AND zalo_group_id = ? ORDER BY last_message_at DESC",
      [ConversationType.Direct, zaloUid]);
    const runner = pickSendableRunner(threads.map((row) => this.runners.get(Number(row.owner_bot_id))), this.runners.values());
    if (!runner) throw await noSendableRunnerError(this.db, "nhắn riêng");
    return runner;
  }

  /**
   * Tài khoản bot gửi được vào một cuộc: tin riêng → bot chủ cuộc; nhóm → bot đang ở nhóm. Cuộc CÓ bot Trợ lý mà runner
   * của nó chưa chạy (tắt / đang khởi động / mất kết nối) → lỗi thường để hàng đợi thử lại, KHÔNG lùi sang bot khác
   * (bot khác không ở trong nhóm) và KHÔNG bỏ việc.
   */
  private async runnerForThread(thread: GroupRow): Promise<AccountRunner> {
    let assistantIds: number[];
    if (thread.thread_type === ConversationType.Direct) {
      const runner = pickSendableRunner([this.runners.get(Number(thread.owner_bot_id))]);
      if (runner) return runner;
      assistantIds = await this.assistantIdsAmong([Number(thread.owner_bot_id)]);
    } else {
      const [rows] = await this.db.query<RowDataPacket[]>("SELECT bot_account_id FROM bot_group WHERE group_id = ? AND left_at IS NULL", [thread.id]);
      const runner = pickSendableRunner(rows.map((row) => this.runners.get(Number(row.bot_account_id))));
      if (runner) return runner;
      assistantIds = await this.assistantIdsAmong(rows.map((row) => Number(row.bot_account_id)));
    }
    if (assistantIds.length) {
      throw new Error(`bot Trợ lý của «${thread.name || thread.zalo_group_id}» đang tắt hoặc chưa kết nối — thử lại sau`);
    }
    // Cuộc «chỉ lưu» (không có bot Trợ lý): bỏ việc kèm lý do rõ, không đẩy sang bot khác không ở trong cuộc
    if (await isCollectOnlyThread(this.db, thread.id)) {
      log.warn(`bỏ việc gửi vào «${thread.name || thread.zalo_group_id}»: cuộc chỉ lưu, không có bot Trợ lý`);
      throw new CollectOnlyAccountError();
    }
    // Dữ liệu cũ chưa gắn bot (không có bot_group): lùi về bot Trợ lý đang chạy đầu tiên như trước
    const fallback = pickSendableRunner([], this.runners.values());
    if (!fallback) throw await noSendableRunnerError(this.db, "gửi vào cuộc");
    return fallback;
  }

  /** Trong các mã tài khoản này, những tài khoản loại Trợ lý. */
  private async assistantIdsAmong(ids: number[]): Promise<number[]> {
    if (!ids.length) return [];
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT id FROM bot_account WHERE kind = ? AND id IN (?)", [BotAccountKind.Assistant, ids]);
    return rows.map((row) => Number(row.id));
  }

  /** Trợ lý AI đang dùng (null = tắt). Đổi khóa / mô hình trên màn Cài đặt thì dựng lại — xem applySettings. */
  get assistant(): AssistantService | null {
    return this.currentAssistant;
  }

  private buildAssistant(): AssistantService | null {
    const settings = this.config.assistant;
    const { apiKey, openaiApiKey, maxPerHour, dailyTokenCap, dailyTokenCapPerBot, maxReadFileBytes, readableFileTypes, showTokenUsage, coreQueryTools } = settings;
    const limits = { maxPerHour, dailyTokenCap, dailyTokenCapPerBot };
    // Dùng chung cho công cụ create_meeting/list_meetings (narrow MeetingCreator) VÀ recap theo yêu cầu chat (phase 6,
    // cần listMeetingsBetween — chỉ có ở kiểu đầy đủ MeetingScheduler) — một instance, đọc config.google lúc gọi.
    const meetingScheduler = new MeetingScheduler(() => this.config.google);
    const options = {
      storage: this.storage, maxReadFileBytes, readableFileTypes, showTokenUsage, coreQueryTools,
      // Họ đọc LẠI cài đặt mỗi lượt (config sống) — đổi `assistant_mcp_families` có hiệu lực ở lượt kế tiếp
      mcpBridge: { families: () => parseMcpFamilies(this.config.assistant.mcpFamilies), gate: this.assistantMcpGate },
      requestFileDownload: (attachmentId: number) => requestAndAwaitDownload(this.db, this.downloader, attachmentId),
      meetingRecapOnDemand: {
        isAvailable: () => Boolean(this.config.meetingRecap.folderId) && hasDriveScope(this.config.google.calendarAccount),
        run: (args: Record<string, unknown>, destination: OndemandDestination, now: Date) => runOndemandRecap(
          this.db, { drive: new DriveClient(() => this.config.google, this.config.meetingRecap.folderId), calendar: meetingScheduler },
          args, destination, now,
        ),
      },
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
      sendCommands: this.sendCommandDeps(),
      briefs: {
        db: this.db, config: this.config, storage: this.storage,
        calendar: () => this.safeCalendar(),
        buildClient: () => buildAlertModelClient(this.db, this.config),
        wakeJobs: () => this.jobs?.wake(),
      } satisfies BriefChatDeps,
      webSearch: buildWebSearchChain(this.config.assistant.tavilyApiKey),
      reportExporter: new ReportExporter(this.storage, () => this.config.google),
      meetingScheduler,
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

  /** Đổi loại tài khoản bot lúc đang chạy (PATCH trên web) — runner áp dụng ngay, không khởi động lại. */
  setAccountKind(accountId: number, kind: BotAccountKind): void {
    this.runners.get(accountId)?.setKind(kind);
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
  /** Nhóm → tài khoản bot đang kéo tin cũ cho nhóm đó (để đếm trần theo tài khoản). */
  private readonly backfillAccounts = new Map<number, number>();

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
    // Giữ chỗ NGAY (trước await đầu tiên): hai lần bấm sát nhau không cùng qua được kiểm «đang chạy» rồi chạy đôi
    const job: BackfillJob = { groupId, full: options.full, startedAt: new Date(), finishedAt: null, pages: 0, fetched: 0, stored: 0, oldest: null, method: "", error: "" };
    this.backfillJobs.set(groupId, job);
    const release = () => { this.backfillJobs.delete(groupId); this.backfillAccounts.delete(groupId); };
    let pick: RowDataPacket | undefined;
    try {
      const [rows] = await this.db.query<RowDataPacket[]>(
        `SELECT g.zalo_group_id, bg.bot_account_id FROM zalo_group g
         JOIN bot_group bg ON bg.group_id = g.id AND bg.left_at IS NULL
         WHERE g.id = ? ORDER BY bg.bot_account_id`,
        [groupId],
      );
      pick = rows.find((row) => this.runners.has(row.bot_account_id as number));
      if (!pick) throw new Error("Không có bot nào đang chạy trong nhóm này");
      // Trần số nhóm đang lấy tin cũ cùng lúc trên MỘT tài khoản bot — kéo lịch sử nhiều nhóm một lúc dễ chạm giới hạn của Zalo
      const accountId = pick.bot_account_id as number;
      let busy = 0;
      for (const [otherGroupId, otherAccountId] of this.backfillAccounts) {
        if (otherAccountId === accountId && !this.backfillJobs.get(otherGroupId)?.finishedAt) busy += 1;
      }
      if (busy >= MAX_CONCURRENT_BACKFILLS_PER_ACCOUNT) throw new BackfillBusyError(busy);
      this.backfillAccounts.set(groupId, accountId);
    } catch (error) {
      release();
      throw error;
    }
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
      if (runner.isCollectOnly) throw new CollectOnlyAccountError();
      return { runner, thread };
    }
    const [bots] = await this.db.query<RowDataPacket[]>(
      "SELECT bot_account_id FROM bot_group WHERE group_id = ? AND left_at IS NULL ORDER BY bot_account_id", [threadId]);
    const runner = pickSendableRunner(bots.map((row) => this.runners.get(row.bot_account_id as number)));
    if (!runner) {
      const botIds = bots.map((row) => Number(row.bot_account_id));
      // Nhóm CÓ bot Trợ lý nhưng nó đang tắt / chưa kết nối ≠ nhóm chỉ lưu: báo đúng nguyên nhân để admin biết bật lại bot
      if ((await this.assistantIdsAmong(botIds)).length) throw new Error("Bot Trợ lý của nhóm này đang tắt hoặc chưa kết nối");
      // Chỉ còn bot Normal trong nhóm: báo «chỉ thu thập dữ liệu» thay vì «không có bot nào đang chạy»
      if (botIds.length) throw new CollectOnlyAccountError();
      throw new Error("Không có tài khoản bot nào đang chạy trong nhóm này");
    }
    return { runner, thread };
  }

  // Kiểm tắt khẩn TRƯỚC khi chọn tài khoản: bot đang tắt thì luôn báo 409 «bot đang tắt» (màn Hội thoại), không lẫn với lỗi
  // cuộc demo / tài khoản chưa kết nối — ZaloSender vẫn chặn lần nữa ở tầng gửi.
  async sendAdminText(threadId: number, text: string): Promise<number | null> {
    assertNotHalted(this.config);
    const { runner, thread } = await this.pickRunnerForThread(threadId);
    return runner.sendAdminText(thread, text);
  }

  async sendAdminFile(threadId: number, data: Buffer, fileName: string, contentType: string): Promise<number | null> {
    assertNotHalted(this.config);
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
    const runner = new AccountRunner(account, this.db, this.config, this.downloader, this.storage, this.assistant, this.jobs, this.botHalt);
    if (!(await runner.start())) return false;
    this.runners.set(account.id, runner);
    return true;
  }
}
