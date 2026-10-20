import { AssistantTurnStatus, ContactRole } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { ContactRow } from "../sync/contact-repository.js";
import type { FileStorage } from "../storage/file-storage.js";
import { readAttachmentText, type HeavyExtractor, type ReadFileResult } from "./file-reader.js";
import type { ModelClient, WebSearchResult } from "./gemini-client.js";
import type { GeneratedReportFile, ReportExporter } from "../reports/report-exporter.js";
import { LIST_CONTACTS_DECLARATION } from "./contact-directory-tool.js";
import { buildGroupQuestion, groupContextSource } from "./group-context.js";
import { buildSystemPrompt, groupScopePrompt } from "./assistant-system-prompt.js";
import { MEETING_RECAP_PDF_DECLARATION, SUMMARY_PDF_DECLARATION } from "./meeting-recap-tool.js";
import { readLinkContent } from "./link-reader.js";
import { READ_LINK_DECLARATION } from "./read-link-tool.js";
import { SEARCH_MESSAGES_DECLARATION } from "./search-messages-tool.js";
import { REPORT_MAX_TOOL_ROUNDS, REPORT_PLAYBOOK_PROMPT, isReportRequest } from "./report-playbook.js";
import { appendTokenFooter } from "./token-usage-footer.js";
import { isAckText, UNCLEAR_REPLY } from "./assistant-ack-texts.js";
import { GROUP_ACTION_DECLARATIONS, type GroupActions } from "./group-action-tools.js";
import { CREATE_MEETING_DECLARATION, MEETING_MANAGE_DECLARATIONS, type MeetingCreator } from "./meeting-tool.js";
import { RECAP_DRIVE_RECORDING_DECLARATION } from "./drive-recap-tool.js";
import type { OndemandDestination, OndemandRecapOutcome } from "../meetings/meeting-recap-ondemand.js";
import { EXPORT_REPORT_DECLARATION } from "./export-report-tool.js";
import { buildCoreQueryTools } from "./core-tools-wiring.js";
import { coreToolOptions } from "./core-tool-adapter.js";
import { resolveAssistantMcpBridge, type AssistantMcpBridge } from "./mcp-bridge/assistant-mcp-bridge-config.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import { openMcpTurn } from "./mcp-bridge/open-mcp-turn.js";
import { applyMcpTurnPrompt, applyMcpTurnTools, loadMcpTurnTools } from "./mcp-bridge/turn-tool-declarations.js";
import { GROUP_SCOPE_TOOL_NAMES, READ_FILE_DECLARATION, TOOL_DECLARATIONS, WEB_SEARCH_DECLARATION, runTool, type ToolContext } from "./tools.js";
import { AGRO_TECHNICAL_PROMPT, isAgroTechnicalQuestion } from "../privacy/agro-technical.js";
import { maskPersonalDataDeep } from "../privacy/personal-data.js";
import { ALERT_TOOL_DECLARATIONS, ALERT_TOOLS_PROMPT, resolveAlertAsker, type AlertToolsDeps } from "./alert-tools.js";
import { parseChatCommand, runChatCommand } from "./chat-commands.js";
import { buildTicketContext } from "../tickets/ticket-commands.js";
import { TICKET_TOOL_DECLARATIONS, TICKET_TOOLS_PROMPT } from "../tickets/ticket-tools.js";
import { buildTaskContext } from "../tasks/task-commands.js";
import { TASK_TOOL_DECLARATIONS, TASK_TOOLS_PROMPT } from "../tasks/task-tools.js";
import type { TicketDeps } from "../tickets/ticket-service.js";
import type { BriefChatDeps } from "../briefs/brief-commands.js";
import { BRIEF_TOOL_PROMPT, SEND_BRIEF_DECLARATION } from "../briefs/brief-tool.js";
import { buildSendChatContext } from "../send-commands/send-command-context.js";
import type { SendCommandDeps } from "../send-commands/send-command-deps.js";
import { canIssueSendCommand } from "../send-commands/send-command-permissions.js";
import { PROPOSE_SEND_DECLARATION, SEND_TOOL_PROMPT } from "../send-commands/send-command-tool.js";
import { buildNoFakeActionPrompt } from "./no-fake-action-prompt.js";
import { can } from "../auth/principal.js";
import { askerContactActor, resolveAskerAccess, type AskerAccess } from "./infra/asker-access.js";
import { checkTurnLimits, logAssistantTurn, type AssistantLimits, type TurnLogDetail } from "./infra/assistant-turn-log.js";
import { loadHistory } from "./infra/conversation-history.js";
import { MEETING_ANNOUNCE_TOOL_PROMPT, PROPOSE_MEETING_ANNOUNCEMENT_DECLARATION } from "../send-commands/send-meeting-announcement-tool.js";
import { PIN_TOOL_PROMPT, PROPOSE_PIN_DECLARATION } from "../send-commands/send-pin-tool.js";
import { PROPOSE_REMINDER_DECLARATION, REMINDER_TOOL_PROMPT } from "../send-commands/send-reminder-tool.js";
import { SUGGEST_REPLIES_DECLARATION, SUGGEST_REPLIES_PROMPT } from "../reply-suggestions/reply-suggestion-tool.js";
import { QUERY_METRICS_DECLARATION, QUERY_METRICS_PROMPT } from "../metrics/metric-query-tool.js";
import { SUGGEST_REPLIES_MANDATORY_PROMPT } from "./reply-suggestion-wiring.js";

// Một lượt hỏi đáp: kiểm vai trò → giới hạn số câu/giờ → trần token/ngày → gọi AI kèm công cụ
// (tối đa MAX_TOOL_ROUNDS vòng) → ghi nhật ký assistant_turn. Không tự gửi Zalo — trả về câu trả
// lời + tệp cần gửi, nơi gọi lo việc gửi (để giới hạn tốc độ gửi ở một chỗ).

const MAX_TOOL_ROUNDS = 6;
/** Dữ liệu công cụ kéo về vượt ngần này ký tự (~8.000 token) thì lượt trả lời đi bản mô hình nặng. */
const HEAVY_THRESHOLD_CHARS = 24_000;

/** Tùy chọn đọc tệp + định tuyến nặng / nhẹ. Bỏ trống = không đọc tệp, một mô hình cho mọi việc. */
export interface AssistantOptions {
  storage?: FileStorage;
  /** Tệp lớn hơn thì bot từ chối đọc (mặc định 5 MB). */
  maxReadFileBytes?: number;
  /** Tạo cuộc họp Google Meet (tài khoản «Kết nối Google»); bỏ trống / chưa kết nối = không có công cụ create_meeting. */
  meetingScheduler?: MeetingCreator;
  /** Cài đặt «assistant_core_query_tools»: trợ lý có query_records / describe_entities (công cụ lõi, phase 7). */
  coreQueryTools?: boolean;
  /** Cầu nối MCP trong tiến trình (họ bật + cổng riêng); bỏ trống = không họ nào đi qua MCP. */
  mcpBridge?: AssistantMcpBridge;
  /** Gắn dòng đo token dưới mỗi câu trả lời (cài đặt «Hiện số token dưới câu trả lời»). */
  showTokenUsage?: boolean;
  /** Đuôi tệp được đọc (cài đặt «Loại tệp bot được đọc»); bỏ trống = mọi loại. */
  readableFileTypes?: string[];
  /** Mô hình cho lượt nặng (tóm tắt dài, đọc tệp); bỏ trống = dùng mô hình chính. */
  heavyModel?: string;
  /** Xuất báo cáo ra Google Sheets / Excel; bỏ trống = không có công cụ export_report. */
  reportExporter?: ReportExporter;
  /** Bóc xlsx / docx ở luồng phụ; bỏ trống = bóc ngay trên luồng chính. */
  heavyExtract?: HeavyExtractor;
  /** Bảo vệ dữ liệu (phase 3, bước 3.3); bỏ trống = không che, không chặn. */
  privacy?: { maskPersonalData: boolean; blockWebForAgroTechnical: boolean };
  /** Công cụ cảnh báo (phase 5): «có gì cần xử lý», «xong tin…», đổi cấu hình qua chat. Bỏ trống = không có. */
  alertTools?: AlertToolsDeps;
  /** Ticket qua bot (08/10/2026): «báo lỗi: …», «nhận / xong T-12». Bỏ trống = không có lệnh ticket. */
  tickets?: TicketDeps;
  /** Bản tin / báo cáo gọi tay (phase 8): «bản tin sáng», «báo cáo tuần»… Bỏ trống = không có. */
  briefs?: BriefChatDeps;
  /** Lệnh gửi tin theo lệnh (phase 9): lệnh gõ «gửi nhóm A: …» + công cụ propose_send_message. Bỏ trống = không có. */
  sendCommands?: SendCommandDeps;
  /** Tìm web riêng (Tavily). Có thì dùng trước; lỗi / hết hạn mức thì lùi về tìm web của mô hình (Gemini) nếu có. */
  webSearch?: (query: string) => Promise<WebSearchResult>;
  /** Recap ghi âm trong thư mục Drive theo yêu cầu chat (phase 6). Không có / `isAvailable()` false = ẩn công cụ
   * recap_drive_recording (chưa cấu hình thư mục hoặc chưa có quyền Drive). */
  meetingRecapOnDemand?: {
    isAvailable: () => boolean;
    run: (args: Record<string, unknown>, destination: OndemandDestination, now: Date) => Promise<OndemandRecapOutcome>;
  };
  /** Tệp Skip/Failed/Pending còn link Zalo — read_file chủ động đưa lại hàng tải rồi chờ ít lâu (phase 6). Không có =
   * read_file báo ngay «chưa có trong kho» như trước. */
  requestFileDownload?: (attachmentId: number) => Promise<"stored" | "pending" | "failed">;
}

export interface AssistantRequest {
  botAccountId: number;
  contact: ContactRow;
  threadId: number;
  questionMessageId: number | null;
  question: string;
  /**
   * Hỏi TRONG NHÓM (được gọi bằng @nhắc / từ khóa): câu trả lời mọi thành viên đều đọc, nên chỉ dùng dữ liệu
   * của nhóm này (công cụ bị khóa vào nhóm), không đọc lịch sử chat như cuộc riêng.
   */
  groupScope?: { groupId: number; groupName: string; actions?: GroupActions };
  /** Ngữ cảnh truy cập ĐÃ phân giải ở nơi gọi (cổng nhóm Mật) — truyền xuống để không phân giải + log lại lần nữa trong lượt. */
  access?: AskerAccess;
  /** Hỏi từ web «Hỏi trợ lý»: cờ Mật của quản trị đang đăng nhập (giao với cờ người được chọn) + không đọc cuộc riêng của người được chọn. */
  webViewer?: { canViewConfidential: boolean };
}

export type { AssistantLimits };

export interface AssistantReply {
  /** null = không trả lời gì (vd đã báo chạm giới hạn trước đó rồi). */
  text: string | null;
  attachmentIds: number[];
  /** Tệp báo cáo (Excel) trợ lý vừa tạo, đã cất kho — nơi gọi gửi cho người hỏi sau câu trả lời. */
  reportFiles?: GeneratedReportFile[];
  /** Các tin gửi riêng SAU `text` (mỗi bản nháp gợi ý trả lời một tin); nơi gọi gửi lần lượt qua đường gửi chung. */
  followUps?: string[];
  status: AssistantTurnStatus;
}

const RATE_LIMIT_TEXT = "Anh/chị hỏi hơi nhiều trong một giờ qua — em tạm nghỉ, lát nữa anh/chị hỏi lại giúp em nhé.";
const DAILY_CAP_TEXT = "Em đã dùng hết hạn mức hôm nay. Ngày mai anh/chị hỏi lại giúp em nhé.";
const FAILURE_TEXT = "Dạ em đang gặp lỗi khi trả lời, anh/chị thử lại sau ít phút giúp em nhé.";

export class AssistantService {
  constructor(
    private readonly db: Db,
    private readonly client: ModelClient,
    private readonly model: string,
    private readonly limits: AssistantLimits,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: AssistantOptions = {},
  ) {}

  /** Đọc (hoặc lấy lại chữ đã bóc của) một tệp — màn Tệp gọi để quản trị xem / bóc trước. */
  async readFile(attachmentId: number): Promise<ReadFileResult | { error: string }> {
    const storage = this.options.storage;
    if (!storage) return { error: "Bot chưa bật đọc tệp" };
    const readDocument = this.client.readDocument
      ? (mime: string, data: Buffer, instruction: string) => this.client.readDocument!(mime, data, instruction, this.options.heavyModel)
      : undefined;
    return readAttachmentText({ db: this.db, storage, readDocument, maxFileBytes: this.options.maxReadFileBytes ?? 5 * 1024 * 1024,
      allowedExtensions: this.options.readableFileTypes, heavyExtract: this.options.heavyExtract }, attachmentId);
  }

  /**
   * Trả lời một câu hỏi. `hooks.onAccepted` gọi ngay khi câu hỏi QUA được giới hạn (giờ / ngày) và sắp
   * đi vào mô hình — nơi gọi dùng để nhắn «em nhận được rồi» nếu câu trả lời lâu.
   */
  async answer(request: AssistantRequest, hooks: { onAccepted?: () => void } = {}): Promise<AssistantReply> {
    const started = Date.now();
    const now = this.clock();

    // Lệnh gõ sẵn («hướng dẫn», «cấu hình», «cần xử lý», «thêm từ khẩn …», «đồng ý»…): trả lời ngay, không qua mô hình,
    // không tính token — chạy cả khi đã chạm trần token ngày
    const tickets = this.options.tickets;
    // Ngữ cảnh truy cập của người hỏi: phân giải LƯỜI, MỘT lần cho cả lượt (lệnh ticket, công cụ, cổng) — xem asker-access.ts
    let accessPromise: Promise<AskerAccess> | null = null;
    const turn = { threadId: request.threadId, messageId: request.questionMessageId, botAccountId: request.botAccountId };
    const groupId = request.groupScope?.groupId;
    const accessOnce = () => (accessPromise ??= request.access
      // Phân giải sẵn ở nơi gọi (cổng nhóm Mật): chỉ thêm cuộc + tin của lượt vào chủ thể liên hệ (và móc nền)
      ? Promise.resolve({ ...request.access, now, wakeJobs: tickets?.wakeJobs, saveSettings: this.options.alertTools?.saveSettings,
        contactActor: askerContactActor(this.db, request.contact, request.access.origin, groupId, turn) })
      : resolveAskerAccess(this.db, request.contact, {
        groupScopeId: groupId, maskPersonal: Boolean(this.options.privacy?.maskPersonalData), now, webViewer: request.webViewer,
        turn, wakeJobs: tickets?.wakeJobs, saveSettings: this.options.alertTools?.saveSettings }));
    // Phiên MCP của lệnh gõ (mặt `assistant_command`): mở lười khi lệnh cần (đồng ý / hủy nháp ghi, lệnh ticket / việc / số liệu của họ đã bật); đóng ngay sau lệnh
    let commandTurn: AssistantMcpTurn | undefined;
    const commandMcp = async () => (commandTurn ??= openMcpTurn(await accessOnce(), resolveAssistantMcpBridge(this.options.mcpBridge), { wakeJobs: tickets?.wakeJobs, requestDownload: tickets?.requestDownload }));
    const ticket = tickets ? buildTicketContext(tickets, {
      contact: { id: request.contact.id, uid: request.contact.zalo_uid, name: request.contact.display_name || request.contact.zalo_name || request.contact.zalo_uid, role: request.contact.role },
      threadId: request.threadId, messageId: request.questionMessageId, botAccountId: request.botAccountId,
      scopeGroupId: request.groupScope?.groupId, access: accessOnce, mcp: commandMcp,
    }) : undefined;
    // Việc (checklist, phase 7) đi cùng ticket: cùng hàng đợi báo tin
    const task = tickets ? buildTaskContext({ db: this.db, wakeJobs: tickets.wakeJobs }, {
      contact: { id: request.contact.id, uid: request.contact.zalo_uid, name: request.contact.display_name || request.contact.zalo_name || request.contact.zalo_uid, role: request.contact.role, kind: request.contact.kind },
      threadId: request.threadId, messageId: request.questionMessageId, groupId: request.groupScope?.groupId ?? null, access: accessOnce,
    }) : undefined;
    // Lệnh gửi tin chỉ ở tin riêng Zalo thật; câu trả lời của lệnh gõ đã nằm trong runChatCommand
    const send = !request.groupScope && this.options.sendCommands
      ? await buildSendChatContext(this.options.sendCommands, request) : null;
    const command = parseChatCommand(request.question);
    if (command) {
      const alertTools = this.options.alertTools;
      const brief = this.options.briefs;
      // Người nhận cảnh báo (asker.recipientId) dùng chung cho cả công cụ cảnh báo lẫn lệnh bản tin — dựng asker khi
      // một trong hai bật, không chỉ khi có alertTools (một bot có thể bật bản tin mà chưa bật cảnh báo qua chat)
      const asker = !request.groupScope && (alertTools || brief) ? await resolveAlertAsker(this.db, request.contact) : null;
      const contact = request.contact;
      // Tin riêng của người chưa có vai trò / không là người nhận: cổng tin riêng chỉ cho qua lệnh ticket + «hướng dẫn»
      const ticketOnly = !request.groupScope && !asker && contact.role === ContactRole.None;
      let text: string | null;
      try {
        text = await runChatCommand({ db: this.db, alertTools, asker, inGroup: Boolean(request.groupScope), now, ticket, task, brief, ticketOnly, send: send ?? undefined, access: accessOnce, mcp: commandMcp, wakeJobs: tickets?.wakeJobs }, command);
      } finally {
        await commandTurn?.close();
      }
      if (text !== null) {
        await this.logTurn(request, AssistantTurnStatus.Answered, { started, answer: text, toolCalls: [{ name: "chat_command", args: "code" in command && command.code ? { ...command, code: "[đã ẩn]" } : command }], model: "lệnh" });
        return { text, attachmentIds: [], status: AssistantTurnStatus.Answered };
      }
    }

    const verdict = await checkTurnLimits(this.db, this.limits, request, now);
    if (verdict.kind !== "ok") {
      const status = verdict.kind === "rate_limited" ? AssistantTurnStatus.RateLimited : AssistantTurnStatus.DailyCapReached;
      await this.logTurn(request, status, { started });
      return { text: verdict.alreadyTold ? null : verdict.kind === "rate_limited" ? RATE_LIMIT_TEXT : DAILY_CAP_TEXT, attachmentIds: [], status };
    }

    hooks.onAccepted?.();
    const usage = { inputTokens: 0, outputTokens: 0 };
    // Lượt «nặng»: đã đọc tệp, hoặc dữ liệu công cụ kéo về nhiều → câu trả lời cuối đi bản mô hình nặng
    // Yêu cầu báo cáo / xuất file: đi bản NẶNG ngay từ đầu — lượt quyết định nội dung báo cáo (soạn bảng, gọi công cụ xuất)
    // là lượt quan trọng nhất, không để bản lite làm rồi mới đổi
    const reportTurn = isReportRequest(request.question);
    const privacy = this.options.privacy;
    // Câu hỏi kỹ thuật thuốc BVTV (IDA câu 13): tắt tìm web, thêm luật chỉ trích tài liệu + «cần kỹ thuật xác nhận»
    const agroTechnical = Boolean(privacy?.blockWebForAgroTechnical) && isAgroTechnicalQuestion(request.question);
    // Che SĐT / STK / CCCD trong mọi dữ liệu kho đưa cho mô hình (kết quả công cụ, lịch sử, ngữ cảnh nhóm)
    const mask = privacy?.maskPersonalData ? maskPersonalDataDeep : <T>(value: T) => value;
    let heavy = reportTurn;
    let toolChars = 0;
    const storage = this.options.storage;
    const readDocument = this.client.readDocument
      ? (mime: string, data: Buffer, instruction: string) => this.client.readDocument!(mime, data, instruction, this.options.heavyModel)
      : undefined;
    const reportFiles: GeneratedReportFile[] = [];
    const exporter = this.options.reportExporter;
    // Phase 6: người hỏi → phạm vi nhóm + Mật + cuộc riêng của mình, MỘT lần mỗi lượt (xem asker-access.ts)
    const access = await accessOnce();
    const coreTools = buildCoreQueryTools(access, Boolean(this.options.coreQueryTools), request.groupScope?.groupId);
    const context: ToolContext = {
      db: this.db, askerUid: request.contact.zalo_uid, access, filesToSend: [], now, usage,
      exportReport: exporter
        ? async (table, format) => {
          // Một lượt hỏi một báo cáo — mô hình gọi lặp thì không đẻ thêm tệp
          if (reportFiles.length) return { error: "Lượt này đã xuất báo cáo rồi." };
          const outcome = await exporter.export(table, format, now, request.contact.display_name || request.contact.zalo_name);
          if (outcome.file) reportFiles.push(outcome.file);
          return outcome.response;
        }
        : undefined,
      createRecapPdf: exporter
        ? async (recap) => {
          if (reportFiles.length) return { error: "Lượt này đã xuất tệp rồi." };
          const outcome = await exporter.exportRecapPdf(recap, now);
          if (outcome.file) reportFiles.push(outcome.file);
          return outcome.response;
        }
        : undefined,
      searchWeb: this.buildWebSearch(),
      readFile: storage
        ? (attachmentId) => readAttachmentText({ db: this.db, storage, readDocument, maxFileBytes: this.options.maxReadFileBytes ?? 5 * 1024 * 1024,
          allowedExtensions: this.options.readableFileTypes, heavyExtract: this.options.heavyExtract }, attachmentId)
        : undefined,
      requestFileDownload: this.options.requestFileDownload,
      markHeavy: () => { heavy = true; },
      // H3: ghi âm từ link nghe CHẢY THẲNG qua readAudioSource (Gemini, như worker recap họp) khi mô hình hỗ trợ —
      // app không đệm cả tệp vào RAM; readAudioSource không có (vd chỉ còn OpenAI) thì link-reader.ts tự lùi về
      // readDocument (Buffer, trần thấp hơn, xem FALLBACK_AUDIO_MAX_BYTES)
      readLink: (url) => readLinkContent(url, readDocument, {
        maxAudioBytes: this.options.maxReadFileBytes ?? 5 * 1024 * 1024,
        allowedExtensions: this.options.readableFileTypes,
        readAudioSource: this.client.readAudioSource
          ? (source, instruction) => this.client.readAudioSource!(source, instruction, this.options.heavyModel)
          : undefined,
      }),
      question: request.question,
      coreQueryTools: coreTools.declarations.length > 0,
    };
    // Phiên MCP của lượt (undefined khi không họ nào bật ⇒ hành vi y nguyên); mở lười ở `loadMcpTurnTools`, đóng ở `finally`
    const mcpTurn = openMcpTurn(access, resolveAssistantMcpBridge(this.options.mcpBridge), {
      groupScopeId: request.groupScope?.groupId, coreQueryTools: Boolean(this.options.coreQueryTools), wakeJobs: tickets?.wakeJobs, requestDownload: tickets?.requestDownload });
    context.mcp = mcpTurn;
    context.meetings = this.options.meetingScheduler;
    context.ticket = ticket;
    context.task = task;
    const scope = request.groupScope;
    const onDemandRecap = this.options.meetingRecapOnDemand;
    const onDemandRecapAvailable = Boolean(onDemandRecap?.isAvailable());
    if (onDemandRecap && onDemandRecapAvailable) {
      context.onDemandRecap = async (args) => {
        // Tài khoản web đã tắt: không recap cuộc họp công ty; còn lại thì đích = cuộc đang hỏi, nhóm Mật chỉ khi người hỏi có quyền Mật
        if (access.origin === "disabled_account" || !can(access.principal, "file", "read")) return { error: "Anh/chị chưa được cấp quyền xem tệp / ghi âm họp qua bot." };
        const destination = { targetThreadId: scope?.groupId ?? null, requesterUid: request.contact.zalo_uid, allowConfidential: access.includeConfidential };
        const outcome = await onDemandRecap.run(args, destination, now);
        if (outcome.file) reportFiles.push(outcome.file);
        return outcome.response;
      };
    }
    // Công cụ cảnh báo + công cụ bản tin (send_brief): chỉ tin riêng, người hỏi có vai trò hoặc là người nhận — một
    // lượt resolveAlertAsker dùng chung cho cả hai (asker.recipientId quyết định có công cụ send_brief hay không)
    const asker = !scope && (this.options.alertTools || this.options.briefs) ? await resolveAlertAsker(this.db, request.contact) : null;
    const alertAsker = this.options.alertTools ? asker : null;
    if (alertAsker) {
      context.alertTools = this.options.alertTools;
      context.alertAsker = alertAsker;
      context.turnStartedAt = Date.now();
    }
    const briefAsker = this.options.briefs && asker?.recipientId ? asker : null;
    if (briefAsker) {
      context.brief = this.options.briefs;
      context.briefAsker = briefAsker;
    }
    // Công cụ đề xuất gửi tin: tin riêng Zalo thật + người hỏi đủ quyền (quyền kiểm lại ở createDraft)
    const sendAsker = send?.requester && canIssueSendCommand(send.requester) ? send : null;
    if (sendAsker) context.sendCommand = sendAsker;
    // Gửi lời mời họp vào nhóm: cần cả quyền ra lệnh gửi lẫn kết nối Calendar
    const announceAsker = Boolean(sendAsker && this.options.meetingScheduler?.connected);
    if (scope) {
      context.scopeGroupId = scope.groupId;
      context.groupActions = scope.actions;
    } else {
      // Gợi ý trả lời + hỏi số liệu: chỉ tin riêng (cổng tin riêng đã chặn người lạ); bản nháp / số doanh số không ra nhóm
      context.replySuggestion = {
        db: this.db, model: this.client, usage, maskPersonal: Boolean(privacy?.maskPersonalData), now,
        tenantId: 1, askerContactId: request.contact.id, askerUid: request.contact.zalo_uid,
      };
    }
    const mcpTools = await loadMcpTurnTools(mcpTurn, coreToolOptions(scope?.groupId));
    const tools = applyMcpTurnTools([
      ...TOOL_DECLARATIONS,
      ...coreTools.declarations,
      LIST_CONTACTS_DECLARATION,
      ...(storage ? [READ_FILE_DECLARATION] : []),
      READ_LINK_DECLARATION,
      SEARCH_MESSAGES_DECLARATION,
      ...((this.options.webSearch || this.client.searchWeb) && !agroTechnical ? [WEB_SEARCH_DECLARATION] : []),
      ...(exporter ? [EXPORT_REPORT_DECLARATION, MEETING_RECAP_PDF_DECLARATION, SUMMARY_PDF_DECLARATION] : []),
      ...(scope?.actions ? GROUP_ACTION_DECLARATIONS : []),
      ...(this.options.meetingScheduler?.connected ? [CREATE_MEETING_DECLARATION, ...MEETING_MANAGE_DECLARATIONS] : []),
      ...(onDemandRecapAvailable ? [RECAP_DRIVE_RECORDING_DECLARATION] : []),
      ...(alertAsker ? ALERT_TOOL_DECLARATIONS : []),
      ...(ticket ? TICKET_TOOL_DECLARATIONS : []),
      ...(task ? TASK_TOOL_DECLARATIONS : []),
      ...(briefAsker ? [SEND_BRIEF_DECLARATION] : []),
      ...(sendAsker ? [PROPOSE_SEND_DECLARATION, PROPOSE_REMINDER_DECLARATION, PROPOSE_PIN_DECLARATION] : []),
      ...(announceAsker ? [PROPOSE_MEETING_ANNOUNCEMENT_DECLARATION] : []),
      ...(scope ? [] : [SUGGEST_REPLIES_DECLARATION, QUERY_METRICS_DECLARATION]),
    ], mcpTools).filter((tool) => !scope || GROUP_SCOPE_TOOL_NAMES.has(tool.name));
    // Trong nhóm: tin trước đó là của nhiều người, không phải hội thoại user/model — đưa vài tin gần nhất của nhóm
    // thành một khối ngữ cảnh trong lượt hỏi (hỏi nối tiếp «chi tiết báo cáo đó» mới hiểu)
    const groupSource = scope ? await groupContextSource(this.db, scope.groupId, request.questionMessageId, mcpTurn) : null;
    const system = applyMcpTurnPrompt(buildSystemPrompt(request.contact, now) + (scope && groupSource ? groupScopePrompt(scope.groupName, groupSource.memberNames) : "")
      + (reportTurn ? REPORT_PLAYBOOK_PROMPT : "") + coreTools.prompt + (agroTechnical ? AGRO_TECHNICAL_PROMPT : "") + (alertAsker ? ALERT_TOOLS_PROMPT : "") + (ticket ? TICKET_TOOLS_PROMPT : "")
      + (task ? TASK_TOOLS_PROMPT : "") + (briefAsker ? BRIEF_TOOL_PROMPT : "") + (sendAsker ? SEND_TOOL_PROMPT + REMINDER_TOOL_PROMPT + PIN_TOOL_PROMPT : "")
      + (announceAsker ? MEETING_ANNOUNCE_TOOL_PROMPT : "")
      + (scope ? "" : `\n\n${SUGGEST_REPLIES_PROMPT}${SUGGEST_REPLIES_MANDATORY_PROMPT}\n\n${QUERY_METRICS_PROMPT}`)
      + buildNoFakeActionPrompt({ inGroup: Boolean(scope), canProposeReminder: Boolean(sendAsker), canAnnounceMeeting: announceAsker, canProposePin: Boolean(sendAsker) }), mcpTools);
    const maxRounds = reportTurn ? REPORT_MAX_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
    const contents = scope ? [] : mask(await loadHistory(this.db, request.threadId, request.questionMessageId, request.contact.zalo_uid));
    // Câu hỏi của chính người hỏi giữ nguyên (họ có thể đang hỏi đúng một số điện thoại); ngữ cảnh nhóm kèm theo thì che
    const question = scope && groupSource
      ? buildGroupQuestion(mask(groupSource.context), request.question)
      : request.question;
    const lastTurn = contents[contents.length - 1];
    if (lastTurn?.role === "user") lastTurn.parts.push({ text: question });
    else contents.push({ role: "user", parts: [{ text: question }] });

    const toolCalls: { name: string; args: unknown }[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      for (let round = 0; round <= maxRounds; round += 1) {
        // Công cụ đã chốt câu trả lời của cả lượt (bản xem trước lệnh gửi): KHÔNG gọi mô hình thêm — chữ của nó bị bỏ đi đằng
        // nào cũng vậy, và lỗi / quá vòng ở lượt gọi sau sẽ nuốt mất bản xem trước của nháp VỪA TẠO (người dùng «đồng ý» mù)
        const result = context.fixedReply !== undefined ? null : await this.client.generate({
          system,
          contents,
          tools,
          // Vòng cuối CẤM gọi công cụ — buộc trả lời bằng dữ liệu đã có. Chỉ bỏ danh sách công cụ thì không đủ:
          // Gemini vẫn trả lệnh gọi (gặp 06/10/2026, câu «có bao nhiêu khách hàng» → lỗi «Quá số vòng»)
          forceText: round === maxRounds,
          model: heavy && this.options.heavyModel ? this.options.heavyModel : undefined,
        });
        if (result) {
          inputTokens += result.inputTokens;
          outputTokens += result.outputTokens;
          contents.push(result.content);
        }
        const calls = result ? result.content.parts.filter((part) => part.functionCall) : [];
        if (!calls.length) {
          // Công cụ đã dựng sẵn câu trả lời của cả lượt (bản xem trước lệnh gửi): trả nguyên văn, bỏ chữ của mô hình — kèm trước
          // nó những việc đã làm thật trong lượt (link Meet vừa tạo…), vì chữ mô hình báo việc đó bị bỏ cùng
          const fixed = context.fixedReply === undefined ? undefined : [...(context.actionNotes ?? []), context.fixedReply].join("\n\n");
          const text = fixed ?? (result?.content.parts ?? []).map((part) => part.text ?? "").join("").trim();
          if (!text) throw new Error("Mô hình trả lời rỗng");
          // Mô hình trả đúng một câu «chờ em xíu» = không làm gì cả (tin chờ thật đã gửi rồi) — hỏi lại thay vì gửi câu chờ thứ hai
          const cleaned = fixed !== undefined ? fixed : isAckText(text) ? UNCLEAR_REPLY : stripMarkdown(text);
          const totalIn = inputTokens + usage.inputTokens;
          const totalOut = outputTokens + usage.outputTokens;
          const followUps = context.followUps?.length ? context.followUps : undefined;
          await this.logTurn(request, AssistantTurnStatus.Answered, {
            started, answer: followUps ? [cleaned, ...followUps].join("\n\n---\n\n") : cleaned, toolCalls, inputTokens: totalIn, outputTokens: totalOut,
          });
          const shown = this.options.showTokenUsage
            ? appendTokenFooter(cleaned, {
              inputTokens: totalIn, outputTokens: totalOut, durationMs: Date.now() - started,
              model: (this.client as { lastModel?: string }).lastModel ?? this.model,
            })
            : cleaned;
          return { text: shown, attachmentIds: context.filesToSend, reportFiles, followUps, status: AssistantTurnStatus.Answered };
        }
        const responses = [];
        for (const part of calls) {
          const { name, args } = part.functionCall!;
          toolCalls.push({ name, args });
          const response = mask(await runTool(context, name, args ?? {}));
          toolChars += JSON.stringify(response).length;
          if (toolChars > HEAVY_THRESHOLD_CHARS) heavy = true;
          responses.push({ functionResponse: { name, response } });
        }
        contents.push({ role: "user", parts: responses });
      }
      throw new Error("Quá số vòng gọi công cụ");
    } catch (error) {
      await this.logTurn(request, AssistantTurnStatus.Failed, {
        started, toolCalls, inputTokens: inputTokens + usage.inputTokens, outputTokens: outputTokens + usage.outputTokens,
        error: error instanceof Error ? error.message : String(error),
      });
      return { text: FAILURE_TEXT, attachmentIds: [], status: AssistantTurnStatus.Failed };
    } finally {
      await mcpTurn?.close();
    }
  }

  /** Tìm web: nguồn riêng (Tavily) trước, lỗi thì lùi về tìm web của mô hình (Gemini). Không có nguồn nào = không tìm web. */
  private buildWebSearch(): ((query: string) => Promise<WebSearchResult>) | undefined {
    const external = this.options.webSearch;
    const modelSearch = this.client.searchWeb ? (query: string) => this.client.searchWeb!(query) : undefined;
    if (!external) return modelSearch;
    return async (query: string) => {
      try {
        return await external(query);
      } catch (error) {
        if (!modelSearch) throw error;
        return modelSearch(query);
      }
    };
  }

  private logTurn(request: AssistantRequest, status: AssistantTurnStatus, detail: TurnLogDetail): Promise<void> {
    // Ghi đúng mô hình đã trả lời — có thể là mô hình dự phòng khi mô hình chính quá tải
    return logAssistantTurn(this.db, request, status, detail, (this.client as { lastModel?: string }).lastModel ?? this.model, this.clock());
  }
}

/** Zalo không hiển thị markdown — gỡ ** __ # ` còn sót nếu mô hình lỡ dùng. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*\*\s+/gm, "- ");
}

/** Chia câu trả lời dài thành các tin ≤ maxLength, ưu tiên cắt ở chỗ xuống dòng. */
export function splitForZalo(text: string, maxLength = 1800): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf("\n", maxLength);
    if (cut < maxLength / 2) cut = rest.lastIndexOf(" ", maxLength);
    if (cut <= 0) cut = maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
