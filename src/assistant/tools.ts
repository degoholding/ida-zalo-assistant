import type { Db } from "../db/pool.js";
import type { ExportReport } from "./export-report-tool.js";
import { GROUP_ACTION_TOOL_NAMES, type GroupActions } from "./group-action-tools.js";
import { recordActionNotes } from "./action-notes.js";
import type { CreateRecapPdf } from "./meeting-recap-tool.js";
import type { RecapDriveRecording } from "./drive-recap-tool.js";
import type { ReadLink } from "./read-link-tool.js";
import type { MeetingCreator } from "./meeting-tool.js";
import type { ReadFileResult } from "./file-reader.js";
import type { AttachmentTextStore } from "../storage/attachment-text-sql-cache.js";
import type { AskerAccess } from "./infra/asker-access.js";
import { MAX_FILES_PER_TURN } from "./file-access-tools.js";
import type { FunctionDeclaration, WebSearchResult } from "./gemini-client.js";
import { resolveExecutor } from "./tool-registry.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import type { AlertAsker, AlertToolsDeps } from "./alert-tools.js";
import { TICKET_TOOL_NAMES } from "../tickets/ticket-tools.js";
import type { TicketCommandContext } from "../tickets/ticket-commands.js";
import type { TaskCommandContext } from "../tasks/task-commands.js";
import { TASK_TOOL_NAMES } from "../tasks/task-tools.js";
import type { BriefChatDeps } from "../briefs/brief-commands.js";
import type { SendChatContext } from "../send-commands/send-command-chat.js";
import type { SuggestToolContext } from "../reply-suggestions/reply-suggestion-tool.js";

// Công cụ AI dùng để lấy dữ liệu. Tất cả CHỈ ĐỌC, trừ send_file và export_report — send_file chỉ gửi cho
// chính người đang hỏi, export_report chỉ ghi ra trang tính của công ty / gửi tệp cho chính người hỏi. Không có công cụ nào nhắn cho người khác: nội dung tin nhắn trong dữ liệu
// có thể chứa câu "hãy gửi cho X…", và mô hình không có cách nào làm theo.
//
// Quyền (phase 6, 17/10/2026): mỗi lượt có MỘT `access` (asker-access.ts) — công cụ đọc không tự viết điều kiện phạm vi mà
// đi qua chốt chặn chung của lõi truy cập dữ liệu. Người hỏi chỉ đọc cuộc riêng của chính mình; nhóm Mật theo cờ người hỏi.

export { attachmentLabel, formatVn, formatVnDay } from "./message-line-format.js";

export interface ToolContext {
  db: Db;
  askerUid: string;
  /** Ngữ cảnh truy cập của người hỏi (phạm vi nhóm + Mật + cuộc riêng của mình) — dựng bằng `resolveAskerAccess`. */
  access: AskerAccess;
  /** Cài đặt «assistant_core_query_tools» bật: lượt này có query_records / describe_entities (công cụ lõi, phase 7). */
  coreQueryTools?: boolean;
  /** Tệp mô hình yêu cầu gửi cho người hỏi — gửi SAU câu trả lời. */
  filesToSend: number[];
  now: Date;
  /** Tìm web; không có = trợ lý không được tìm web. Token của lượt tìm cộng vào usage. */
  searchWeb?: (query: string) => Promise<WebSearchResult>;
  usage?: { inputTokens: number; outputTokens: number };
  /** Đọc chữ của một tệp trong kho (file-reader). Không có = bot không có công cụ read_file. */
  /** `store` = kho chữ do nơi gọi chọn (họ `files` qua MCP); bỏ trống = kho SQL mặc định. */
  readFile?: (attachmentId: number, store?: AttachmentTextStore) => Promise<ReadFileResult | { error: string }>;
  /** Tệp Skip/Failed/Pending còn link Zalo (`source_url`) — người hỏi CHỦ ĐỘNG muốn đọc (read_file) thì đưa lại hàng
   * tải rồi CHỜ ít lâu trong lượt hỏi này. Không có = không tự tải lại, báo luôn «chưa có trong kho» như trước. */
  requestFileDownload?: (attachmentId: number) => Promise<"stored" | "pending" | "failed">;
  /** Báo cho vòng hỏi đáp: dữ liệu vừa kéo về nặng → lượt trả lời nên đi bản mô hình nặng. */
  markHeavy?: (reason: string) => void;
  /** Xuất báo cáo ra Google Sheets / Excel. Không có = trợ lý không có công cụ export_report. */
  exportReport?: ExportReport;
  /** Xuất PDF recap cuộc họp (mẫu công ty). Không có = không có công cụ create_meeting_recap_pdf. */
  createRecapPdf?: CreateRecapPdf;
  /** Đọc nội dung link (Google Sheets / Docs / trang web). Không có = không có công cụ read_link. */
  readLink?: ReadLink;
  /** Câu hỏi của lượt này — read_link chỉ đọc link có trong câu hỏi hoặc trong tin nhắn đã lưu. */
  question?: string;
  /**
   * Hỏi TRONG NHÓM (mọi thành viên đọc câu trả lời): chỉ được đọc dữ liệu của nhóm này. Chặn ở đây — không chỉ ở
   * danh sách công cụ — để mô hình có truyền id nhóm khác / gọi công cụ khác cũng không lấy được.
   */
  scopeGroupId?: number;
  /** Việc làm trên Zalo trong nhóm đang hỏi (nhắc hẹn, ghim, bình chọn) — chỉ có khi được gọi trong nhóm. */
  groupActions?: GroupActions;
  /** Số việc hành động đã làm trong lượt (trần MAX_ACTIONS_PER_TURN). */
  actionCounter?: { done: number };
  /** Tạo cuộc họp Google Meet (tài khoản «Kết nối Google»). Không có / chưa kết nối = không có công cụ create_meeting. */
  meetings?: MeetingCreator;
  /** Recap ghi âm trong thư mục Drive khi không có file ghi âm trong chat (phase 6). Không có = ẩn recap_drive_recording. */
  onDemandRecap?: RecapDriveRecording;
  /** Công cụ cảnh báo (phase 5) — chỉ tin riêng, người hỏi là quản lý / người nhận. */
  alertTools?: AlertToolsDeps;
  alertAsker?: AlertAsker;
  /** Lúc lượt hỏi bắt đầu (đồng hồ thật) — xác nhận đổi cấu hình phải ở lượt SAU lượt đề xuất. */
  turnStartedAt?: number;
  /** Ticket: người hỏi + cuộc đang hỏi (công cụ list_tickets / ticket_action / create_ticket) */
  ticket?: TicketCommandContext;
  /** Việc (checklist): người hỏi + cuộc đang hỏi (list_tasks / create_task / task_action / save_recap_tasks) */
  task?: TaskCommandContext;
  /** Bản tin / báo cáo gọi tay (phase 8, công cụ send_brief) — chỉ gắn khi người hỏi là người nhận, tin riêng. */
  brief?: BriefChatDeps;
  briefAsker?: AlertAsker;
  /** Lệnh gửi tin (phase 9, công cụ propose_send_message) — chỉ gắn khi tin riêng, người hỏi được phép ra lệnh gửi. */
  sendCommand?: SendChatContext;
  /** Công cụ đặt câu trả lời CỦA CẢ LƯỢT (bản xem trước lệnh gửi do máy chủ dựng) — nơi gọi trả nó thay chữ của mô hình. */
  fixedReply?: string;
  /**
   * Việc ĐÃ làm thật trong lượt (chữ do máy chủ dựng, vd cuộc họp Meet vừa tạo kèm link). Có `fixedReply` thì chữ mô hình bị bỏ, nên
   * nơi gọi ghép các dòng này lên trước bản xem trước — không thì người hỏi không thấy link họp và dễ bảo tạo lại (trùng cuộc họp).
   */
  actionNotes?: string[];
  /** Gợi ý trả lời (phase 10, công cụ suggest_replies) — chỉ gắn ở tin riêng. Không có = công cụ báo không dùng được. */
  replySuggestion?: SuggestToolContext;
  /** Phiên MCP của lượt (chỉ có khi `assistant_mcp_families` bật ít nhất một họ) — bộ định tuyến + executor họ tự rẽ nhánh bằng `mcp.familyEnabled`. */
  mcp?: AssistantMcpTurn;
  /** Các tin gửi riêng SAU `fixedReply` (mỗi bản nháp trả lời một tin, chép là gửi được) — nơi gọi gửi lần lượt. */
  followUps?: string[];
}

/** Công cụ dùng được khi hỏi trong nhóm — đều bị khóa vào nhóm đó (scopeGroupId). */
// web_search: thông tin CÔNG KHAI (giá vàng, tỷ giá, báo cáo tài chính công ty niêm yết…) — mở cho nhóm 08/10/2026 (đại ca);
// câu tìm vẫn không được chứa dữ liệu nội bộ (luật chung + mô tả công cụ)
export const GROUP_SCOPE_TOOL_NAMES = new Set(["list_groups", "get_group_messages", "search_messages", "describe_entities", "query_records", "search_files", "read_file", "read_link", "export_report", "create_meeting_recap_pdf", "create_summary_pdf", "create_meeting", "list_meetings", "cancel_meeting", "recap_drive_recording", "web_search", ...TICKET_TOOL_NAMES, ...TASK_TOOL_NAMES, ...GROUP_ACTION_TOOL_NAMES]);

export const WEB_SEARCH_DECLARATION: FunctionDeclaration = {
  name: "web_search",
  description:
    "Tìm thông tin trên Internet (Google): giá thị trường, tin tức, văn bản pháp luật, thông tin công ty/sản phẩm bên ngoài. " +
    "Trả về câu trả lời tóm tắt kèm nguồn. Câu tìm KHÔNG được chứa nội dung tin nhắn nội bộ hay tên khách hàng.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Câu cần tìm, tiếng Việt hoặc tiếng Anh" } },
    required: ["query"],
  },
};

export const READ_FILE_DECLARATION: FunctionDeclaration = {
  name: "read_file",
  description:
    "Đọc NỘI DUNG một tệp đã lưu (id lấy từ search_files, hoặc tệp người hỏi vừa gửi): xlsx, docx, pdf, txt, csv, GHI ÂM mp3 / m4a (trả bản gỡ băng + tóm tắt) và ẢNH (hóa đơn, " +
    "báo giá chụp màn hình…). Trả về chữ trong tệp để tóm tắt, trả lời câu hỏi về tệp, hoặc so sánh. Tệp quá 5 MB thì không đọc.",
  parameters: {
    type: "object",
    properties: { attachment_id: { type: "integer", description: "id tệp lấy từ search_files" } },
    required: ["attachment_id"],
  },
};

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_groups",
    description: "Liệt kê các nhóm Zalo bot đang lưu tin (id, tên, tên gọi ngắn, số tin, tin gần nhất). Dùng để tìm id nhóm theo tên.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Một phần tên nhóm hoặc tên gọi ngắn; bỏ trống để lấy tất cả" } },
    },
  },
  {
    name: "get_group_messages",
    description: "Lấy toàn bộ tin của MỘT nhóm trong khoảng thời gian, để tóm tắt nhóm. Mỗi dòng: [ngày giờ] Người gửi: nội dung.",
    parameters: {
      type: "object",
      properties: {
        group_id: { type: "integer", description: "id nhóm lấy từ list_groups" },
        from: { type: "string", description: "Bắt đầu, ISO 8601 có múi giờ, vd 2026-10-01T00:00:00+07:00" },
        to: { type: "string", description: "Kết thúc, ISO 8601 có múi giờ" },
      },
      required: ["group_id", "from", "to"],
    },
  },
  {
    name: "find_people",
    description: "Tìm người trong Danh bạ theo tên (không cần dấu). Trả về mã Zalo (uid) và các nhóm người đó đang ở.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Tên hoặc một phần tên, vd 'Lan', 'chi Hoa'" } },
      required: ["name"],
    },
  },
  {
    name: "get_conversation_with_person",
    description:
      "Lấy những gì đã trao đổi với MỘT người trong khoảng thời gian: tin người đó gửi, tin nhắc tên người đó, " +
      "tin của người hỏi trong các nhóm có người đó, và tin riêng giữa người đó với bot. Dùng cho câu 'tôi đã bàn gì với chị A'.",
    parameters: {
      type: "object",
      properties: {
        person_uid: { type: "string", description: "uid lấy từ find_people" },
        from: { type: "string", description: "Bắt đầu, ISO 8601 có múi giờ" },
        to: { type: "string", description: "Kết thúc, ISO 8601 có múi giờ" },
        include_me: { type: "boolean", description: "Có lấy cả tin của người hỏi không (mặc định có)" },
      },
      required: ["person_uid", "from", "to"],
    },
  },
  {
    name: "search_files",
    description: "Tìm tệp/ảnh đã gửi trong các nhóm và tin riêng theo tên tệp hoặc chú thích (không cần dấu).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Từ khóa trong tên tệp hoặc nội dung tệp đã đọc, vd 'bao gia Thanh Cong'. ĐỂ TRỐNG = liệt kê tệp gần đây của người hỏi (tệp họ gửi, hoặc trong cuộc riêng với bot) — dùng khi người hỏi nói «file này» mà chưa rõ tệp nào" },
        group_id: { type: "integer", description: "Chỉ tìm trong nhóm này (tùy chọn)" },
        from: { type: "string", description: "Từ ngày, ISO 8601 (tùy chọn)" },
        to: { type: "string", description: "Đến ngày, ISO 8601 (tùy chọn)" },
      },
      required: ["query"],
    },
  },
  {
    name: "send_file",
    description: `Gửi một tệp ĐÃ LƯU (id lấy từ search_files) cho chính người đang hỏi, sau câu trả lời. Tối đa ${MAX_FILES_PER_TURN} tệp mỗi lần hỏi. Chỉ dùng khi người hỏi muốn nhận tệp.`,
    parameters: {
      type: "object",
      properties: { attachment_id: { type: "integer" } },
      required: ["attachment_id"],
    },
  },
];

export async function runTool(context: ToolContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Bảng `Map` (tool-registry.ts): tên như `constructor` / `__proto__` không rơi vào prototype (M6 review)
  const executor = resolveExecutor(context, name);
  if (!executor) return { error: `Không có công cụ ${name}` };
  if (context.scopeGroupId && !GROUP_SCOPE_TOOL_NAMES.has(name)) return { error: "Hỏi trong nhóm chỉ dùng được dữ liệu của nhóm này." };
  try {
    const result = (await executor(context, args ?? {})) as Record<string, unknown>;
    recordActionNotes(context, name, args ?? {}, result); // việc thật vừa làm → dòng do máy chủ dựng (xem action-notes.ts)
    return result;
  } catch (error) {
    return { error: `Công cụ lỗi: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
  }
}
