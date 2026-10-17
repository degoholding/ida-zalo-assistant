import { askerContactScope } from "./asker-access.js";
import { runListContacts } from "./contact-directory-tool.js";
import { coreToolOptions, findAssistantCoreTool, runCoreTool } from "./core-tool-adapter.js";
import { runExportReport } from "./export-report-tool.js";
import { readFile, searchFiles, sendFile } from "./file-access-tools.js";
import { WebSearchUnavailableError } from "./gemini-client.js";
import { GROUP_ACTION_TOOL_NAMES, runGroupAction } from "./group-action-tools.js";
import { runRecapDriveRecording } from "./drive-recap-tool.js";
import { runCreateRecapPdf } from "./meeting-recap-tool.js";
import { meetingScopeTag, runCancelMeeting, runCreateMeeting, runListMeetings } from "./meeting-tool.js";
import { runReadLink } from "./read-link-tool.js";
import { runQueryMetricsInTurn, runSuggestRepliesInTurn } from "./reply-metric-wiring.js";
import { ASSISTANT_WRITE_TOOL_NAMES, runWriteTool } from "./write-tool-adapter.js";
import { runSearchMessages } from "./search-messages-tool.js";
import { findPeople, getConversationWithPerson, getGroupMessages, listGroups } from "./thread-read-tools.js";
import type { ToolContext } from "./tools.js";
import { ALERT_TOOL_NAMES, runAlertTool } from "./alert-tools.js";
import { runSendBriefTool } from "../briefs/brief-tool.js";
import { runProposeSendTool } from "../send-commands/send-command-tool.js";
import { runProposeMeetingAnnouncementTool } from "../send-commands/send-meeting-announcement-tool.js";
import { runProposePinTool } from "../send-commands/send-pin-tool.js";
import { runProposeReminderTool } from "../send-commands/send-reminder-tool.js";
import { runTicketTool, TICKET_TOOL_NAMES } from "../tickets/ticket-tools.js";
import { runTaskTool, TASK_TOOL_NAMES } from "../tasks/task-tools.js";

// Bảng công cụ của trợ lý: tên → hàm chạy. Dùng `Map` (không phải object literal) nên tên như `constructor` / `__proto__` do mô hình
// gửi không rơi vào prototype (M6 của review phase 2). Gồm công cụ riêng của trợ lý + công cụ LÕI (phase 7, qua core-tool-adapter).

export type Executor = (context: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

async function webSearch(context: ToolContext, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
  if (!query) return { error: "Thiếu câu tìm" };
  if (!context.searchWeb) return { error: "Tìm web chưa bật cho trợ lý này." };
  try {
    const result = await context.searchWeb(query);
    if (context.usage) {
      context.usage.inputTokens += result.inputTokens;
      context.usage.outputTokens += result.outputTokens;
    }
    return { answer: result.text || "(không có kết quả)", sources: result.sources };
  } catch (error) {
    if (error instanceof WebSearchUnavailableError) {
      return { error: "Tìm web tạm không dùng được (khóa tìm web sai / hết hạn mức). Báo người hỏi ngắn gọn là quản trị cần kiểm khóa Tavily hoặc nạp khóa Gemini — không đưa số liệu cũ." };
    }
    throw error;
  }
}

const EXECUTOR_TABLE: Record<string, Executor> = {
  list_groups: listGroups,
  get_group_messages: getGroupMessages,
  find_people: findPeople,
  get_conversation_with_person: getConversationWithPerson,
  search_files: searchFiles,
  search_messages: (context, args) => runSearchMessages(context, args),
  send_file: sendFile,
  read_file: readFile,
  web_search: webSearch,
  read_link: async (context, args) => {
    const { response, content } = await runReadLink(context, args);
    if (content) {
      if (context.usage) {
        context.usage.inputTokens += content.inputTokens;
        context.usage.outputTokens += content.outputTokens;
      }
      context.markHeavy?.("đọc link");
    }
    return response;
  },
  export_report: (context, args) => runExportReport(context.exportReport, args),
  list_contacts: (context, args) => runListContacts(context.db, args, askerContactScope(context.access)),
  create_meeting_recap_pdf: (context, args) => runCreateRecapPdf(context.createRecapPdf, args, context.now),
  create_summary_pdf: (context, args) => runCreateRecapPdf(context.createRecapPdf, args, context.now, "document"),
  create_meeting: (context, args) =>
    runCreateMeeting(context.meetings, (context.actionCounter ??= { done: 0 }), args, context.now, meetingScopeTag(context.scopeGroupId), context.askerUid),
  list_meetings: (context) => runListMeetings(context.meetings, meetingScopeTag(context.scopeGroupId)),
  cancel_meeting: (context, args) =>
    runCancelMeeting(context.meetings, (context.actionCounter ??= { done: 0 }), args, meetingScopeTag(context.scopeGroupId)),
  recap_drive_recording: (context, args) => runRecapDriveRecording(context.onDemandRecap, args),
  ...Object.fromEntries([...TICKET_TOOL_NAMES].map((name) => [name,
    (context: ToolContext, args: Record<string, unknown>) => runTicketTool(context.ticket, name, args, context.now)])),
  ...Object.fromEntries([...TASK_TOOL_NAMES].map((name) => [name,
    (context: ToolContext, args: Record<string, unknown>) => runTaskTool(context.task, name, args, context.now)])),
  suggest_replies: (context, args) => runSuggestRepliesInTurn(context, args),
  query_metrics: (context, args) => runQueryMetricsInTurn(context, args),
  send_brief: (context, args) => runSendBriefTool(context.brief, context.briefAsker, args, context.now),
  propose_send_message: async (context, args) => {
    if (context.fixedReply !== undefined) return { error: "Lượt này đã tạo bản xem trước lệnh gửi rồi — không tạo thêm." };
    const outcome = await runProposeSendTool(context.sendCommand, args, context.now);
    if (outcome.fixedReply !== undefined) context.fixedReply = outcome.fixedReply;
    return outcome.response;
  },
  propose_group_reminder: async (context, args) => {
    if (context.fixedReply !== undefined) return { error: "Lượt này đã tạo bản xem trước rồi — không tạo thêm." };
    const outcome = await runProposeReminderTool(context.sendCommand, args, context.now);
    if (outcome.fixedReply !== undefined) context.fixedReply = outcome.fixedReply;
    return outcome.response;
  },
  propose_group_pin: async (context, args) => {
    if (context.fixedReply !== undefined) return { error: "Lượt này đã tạo bản xem trước rồi — không tạo thêm." };
    const outcome = await runProposePinTool(context.sendCommand, context.meetings, args, context.now);
    if (outcome.fixedReply !== undefined) context.fixedReply = outcome.fixedReply;
    return outcome.response;
  },
  propose_meeting_announcement: async (context, args) => {
    if (context.fixedReply !== undefined) return { error: "Lượt này đã tạo bản xem trước rồi — không tạo thêm." };
    const outcome = await runProposeMeetingAnnouncementTool(context.sendCommand, context.meetings, args, context.now);
    if (outcome.fixedReply !== undefined) context.fixedReply = outcome.fixedReply;
    return outcome.response;
  },
  ...Object.fromEntries([...ALERT_TOOL_NAMES].map((name) => [name,
    (context: ToolContext, args: Record<string, unknown>) =>
      runAlertTool(context.alertTools, context.alertAsker, name, args, context.now, context.turnStartedAt ?? Date.now(), context.access)])),
  ...Object.fromEntries([...GROUP_ACTION_TOOL_NAMES].map((name) => [name,
    (context: ToolContext, args: Record<string, unknown>) =>
      runGroupAction(context.groupActions, (context.actionCounter ??= { done: 0 }), name, args, context.now)])),
};

/** Công cụ lõi chạy trong lượt: chỉ khi cài đặt «assistant_core_query_tools» bật (ToolContext.coreQueryTools); trong nhóm thu hẹp thực thể. */
function coreExecutor(name: string): Executor {
  return async (context, args) => {
    const def = findAssistantCoreTool(name);
    if (!def || !context.coreQueryTools) return { error: `Không có công cụ ${name}` };
    return runCoreTool(def, context.access, args, coreToolOptions(context.scopeGroupId));
  };
}

/** Công cụ đề xuất ghi lõi (phase 8, D1): tạo nháp → máy chủ gửi bản xem trước + mã (`fixedReply`); xác nhận chỉ bằng tin «đồng ý» của người hỏi. */
function writeExecutor(name: string): Executor {
  return async (context, args) => {
    if (!context.coreQueryTools) return { error: `Không có công cụ ${name}` };
    if (context.fixedReply !== undefined) return { error: "Lượt này đã có câu trả lời dựng sẵn — không tạo thêm đề xuất." };
    const outcome = await runWriteTool(name, context.access, context.scopeGroupId, args);
    if (outcome.fixedReply !== undefined) context.fixedReply = outcome.fixedReply;
    return outcome.response;
  };
}

const TOOL_REGISTRY: ReadonlyMap<string, Executor> = new Map<string, Executor>([
  ...Object.entries(EXECUTOR_TABLE),
  ...ASSISTANT_WRITE_TOOL_NAMES.map((name): [string, Executor] => [name, writeExecutor(name)]),
  ["describe_entities", coreExecutor("describe_entities")],
  ["query_records", coreExecutor("query_records")],
]);

export function findExecutor(name: string): Executor | undefined {
  return TOOL_REGISTRY.get(name);
}
