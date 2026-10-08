import type { RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType } from "../constants.js";
import type { Db } from "../db/pool.js";
import { runListContacts } from "./contact-directory-tool.js";
import { runExportReport, type ExportReport } from "./export-report-tool.js";
import { GROUP_ACTION_TOOL_NAMES, runGroupAction, type GroupActions } from "./group-action-tools.js";
import { runCreateRecapPdf, type CreateRecapPdf } from "./meeting-recap-tool.js";
import { runReadLink, type ReadLink } from "./read-link-tool.js";
import { meetingScopeTag, runCancelMeeting, runCreateMeeting, runListMeetings, type MeetingCreator } from "./meeting-tool.js";
import type { ReadFileResult } from "./file-reader.js";
import { WebSearchUnavailableError, type FunctionDeclaration, type WebSearchResult } from "./gemini-client.js";
import { ALERT_TOOL_NAMES, runAlertTool, type AlertAsker, type AlertToolsDeps } from "./alert-tools.js";
import { runTicketTool, TICKET_TOOL_NAMES } from "../tickets/ticket-tools.js";
import type { TicketCommandContext } from "../tickets/ticket-commands.js";

// Công cụ AI dùng để lấy dữ liệu. Tất cả CHỈ ĐỌC, trừ send_file và export_report — send_file chỉ gửi cho
// chính người đang hỏi, export_report chỉ ghi ra trang tính của công ty / gửi tệp cho chính người hỏi. Không có công cụ nào nhắn cho người khác: nội dung tin nhắn trong dữ liệu
// có thể chứa câu "hãy gửi cho X…", và mô hình không có cách nào làm theo.
//
// Quyền hiện MỞ HẾT (đại ca chốt 01/10/2026): người có vai trò hỏi được mọi nhóm đang bật đọc và
// mọi cuộc riêng. Muốn siết theo công ty thì thêm điều kiện ở đây, mỗi công cụ một chỗ.

const MAX_MESSAGES = 1500;
const MAX_CHARS = 120_000;
const MAX_FILES_PER_TURN = 3;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface ToolContext {
  db: Db;
  askerUid: string;
  /** Tệp mô hình yêu cầu gửi cho người hỏi — gửi SAU câu trả lời. */
  filesToSend: number[];
  now: Date;
  /** Tìm web; không có = trợ lý không được tìm web. Token của lượt tìm cộng vào usage. */
  searchWeb?: (query: string) => Promise<WebSearchResult>;
  usage?: { inputTokens: number; outputTokens: number };
  /** Đọc chữ của một tệp trong kho (file-reader). Không có = bot không có công cụ read_file. */
  readFile?: (attachmentId: number) => Promise<ReadFileResult | { error: string }>;
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
  /** Công cụ cảnh báo (phase 5) — chỉ tin riêng, người hỏi là quản lý / người nhận. */
  alertTools?: AlertToolsDeps;
  alertAsker?: AlertAsker;
  /** Lúc lượt hỏi bắt đầu (đồng hồ thật) — xác nhận đổi cấu hình phải ở lượt SAU lượt đề xuất. */
  turnStartedAt?: number;
  /** Ticket: người hỏi + cuộc đang hỏi (công cụ list_tickets / ticket_action / create_ticket) */
  ticket?: TicketCommandContext;
}

/** Công cụ dùng được khi hỏi trong nhóm — đều bị khóa vào nhóm đó (scopeGroupId). */
// web_search: thông tin CÔNG KHAI (giá vàng, tỷ giá, báo cáo tài chính công ty niêm yết…) — mở cho nhóm 08/10/2026 (đại ca);
// câu tìm vẫn không được chứa dữ liệu nội bộ (luật chung + mô tả công cụ)
export const GROUP_SCOPE_TOOL_NAMES = new Set(["list_groups", "get_group_messages", "search_files", "read_file", "read_link", "export_report", "create_meeting_recap_pdf", "create_summary_pdf", "create_meeting", "list_meetings", "cancel_meeting", "web_search", ...TICKET_TOOL_NAMES, ...GROUP_ACTION_TOOL_NAMES]);

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

function parseTime(raw: unknown, fallback: Date): Date {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? fallback : value;
}

/** Giờ Việt Nam dạng dd/MM HH:mm — mô hình đọc giờ địa phương, không phải UTC. */
const VN_WEEKDAYS = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"];

/**
 * «thứ Tư, 07/10/2026» theo giờ Việt Nam. Đưa sẵn cho mô hình — không có thì mô hình tự đoán thứ và đoán sai (gặp thật
 * 07/10/2026: bot nói «hôm nay thứ Ba» vào thứ Tư).
 */
export function formatVnDay(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${VN_WEEKDAYS[local.getUTCDay()]}, ${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}

export function formatVn(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

interface MessageLineRow extends RowDataPacket {
  sent_at: Date;
  sender_name: string;
  sender_uid: string;
  text: string | null;
  quote_text: string | null;
  file_name: string | null;
  attachment_id: number | null;
  group_name: string;
  thread_type: number;
}

function formatLines(rows: MessageLineRow[], withGroup: boolean): { text: string; truncated: boolean } {
  const lines: string[] = [];
  for (const row of rows) {
    const where = withGroup ? ` (${row.thread_type === ConversationType.Direct ? "nhắn riêng bot" : row.group_name})` : "";
    const quote = row.quote_text ? ` [trả lời: "${row.quote_text.slice(0, 80)}"]` : "";
    const file = row.file_name ? ` [tệp #${row.attachment_id}: ${row.file_name}]` : "";
    const body = (row.text ?? "").replace(/\s+/g, " ").trim();
    lines.push(`[${formatVn(row.sent_at)}]${where} ${row.sender_name || row.sender_uid}:${quote} ${body}${file}`.trim());
  }
  // Quá dài thì giữ phần MỚI nhất — câu hỏi thường về chuyện gần đây
  let total = 0;
  let start = lines.length;
  while (start > 0 && total + lines[start - 1].length + 1 <= MAX_CHARS) {
    start -= 1;
    total += lines[start].length + 1;
  }
  return { text: lines.slice(start).join("\n"), truncated: start > 0 };
}

/** Câu báo khi mô hình chạm vào dữ liệu nhóm Mật (IDA câu 4: nhóm Mật không gửi sang AI). */
const CONFIDENTIAL_ERROR = "Nhóm này để chế độ Mật — bot không đưa nội dung nhóm cho AI. Báo người hỏi xem trực tiếp trong nhóm.";

const MESSAGE_SELECT = `
  SELECT m.sent_at, m.sender_name, m.sender_uid, m.text, m.quote_text, a.file_name, a.id AS attachment_id,
         COALESCE(NULLIF(g.label, ''), g.name) AS group_name, g.thread_type
  FROM message m
  JOIN zalo_group g ON g.id = m.group_id
  LEFT JOIN attachment a ON a.message_id = m.id`;

async function listGroups(context: ToolContext, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const [rows] = await context.db.query<RowDataPacket[]>(
    `SELECT g.id, g.name, g.label, c.name AS company,
            (SELECT COUNT(*) FROM message m WHERE m.group_id = g.id) AS message_count,
            (SELECT MAX(m.sent_at) FROM message m WHERE m.group_id = g.id) AS last_message_at
     FROM zalo_group g LEFT JOIN company c ON c.id = g.company_id
     WHERE g.thread_type = ? AND g.read_messages = 1 AND g.is_confidential = 0
       AND (? = '' OR g.name LIKE ? OR g.label LIKE ?) AND (? = 0 OR g.id = ?)
     ORDER BY last_message_at DESC LIMIT 50`,
    [ConversationType.Group, query, `%${query}%`, `%${query}%`, context.scopeGroupId ?? 0, context.scopeGroupId ?? 0],
  );
  return {
    groups: rows.map((row) => ({
      id: row.id,
      name: row.name,
      short_name: row.label,
      company: row.company ?? "",
      message_count: row.message_count,
      last_message: row.last_message_at ? formatVn(row.last_message_at) : "",
    })),
  };
}

async function getGroupMessages(context: ToolContext, args: Record<string, unknown>) {
  const groupId = context.scopeGroupId ?? Number(args.group_id);
  const to = parseTime(args.to, context.now);
  const from = parseTime(args.from, new Date(to.getTime() - 86_400_000));
  const [groups] = await context.db.query<RowDataPacket[]>(
    "SELECT id, name, is_confidential FROM zalo_group WHERE id = ? AND thread_type = ? AND read_messages = 1",
    [groupId, ConversationType.Group],
  );
  if (!groups.length) return { error: "Không có nhóm này hoặc nhóm không được lưu tin — gọi list_groups để lấy id đúng." };
  if (groups[0].is_confidential) return { error: CONFIDENTIAL_ERROR };
  const [rows] = await context.db.query<MessageLineRow[]>(
    `${MESSAGE_SELECT}
     WHERE m.group_id = ? AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL
     ORDER BY m.sent_at DESC LIMIT ?`,
    [groupId, from, to, MAX_MESSAGES],
  );
  rows.reverse();
  const { text, truncated } = formatLines(rows, false);
  return {
    group: groups[0].name,
    from: formatVn(from),
    to: formatVn(to),
    message_count: rows.length,
    truncated: truncated || rows.length >= MAX_MESSAGES,
    messages: text || "(không có tin nào trong khoảng này)",
  };
}

async function findPeople(context: ToolContext, args: Record<string, unknown>) {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (name.length < 2) return { error: "Tên quá ngắn" };
  // utf8mb4_unicode_ci không phân biệt dấu: "Lan" khớp "Lân", "hoa" khớp "Hòa"
  const [rows] = await context.db.query<RowDataPacket[]>(
    `SELECT c.zalo_uid, c.display_name, c.zalo_name,
            GROUP_CONCAT(DISTINCT COALESCE(NULLIF(g.label, ''), g.name) SEPARATOR ', ') AS groups_in
     FROM contact c
     LEFT JOIN group_member gm ON gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL
     LEFT JOIN zalo_group g ON g.id = gm.group_id AND g.read_messages = 1 AND g.is_confidential = 0
     WHERE c.display_name LIKE ? OR c.zalo_name LIKE ?
        OR c.zalo_uid IN (SELECT zalo_uid FROM group_member WHERE display_name LIKE ?)
     GROUP BY c.id
     LIMIT 10`,
    [`%${name}%`, `%${name}%`, `%${name}%`],
  );
  return {
    people: rows.map((row) => ({
      uid: row.zalo_uid,
      name: row.display_name || row.zalo_name,
      zalo_name: row.zalo_name,
      groups: row.groups_in ?? "",
    })),
  };
}

async function getConversationWithPerson(context: ToolContext, args: Record<string, unknown>) {
  const personUid = String(args.person_uid ?? "");
  const includeMe = args.include_me !== false;
  const to = parseTime(args.to, context.now);
  const from = parseTime(args.from, new Date(to.getTime() - 7 * 86_400_000));
  if (!personUid) return { error: "Thiếu person_uid — gọi find_people trước." };
  // Nhóm: tin của người đó, tin nhắc tên người đó, và (nếu cần) tin người hỏi gửi trong những nhóm
  // mà người đó cũng nhắn trong khoảng này. Riêng: cuộc riêng giữa bot và người đó.
  const [rows] = await context.db.query<MessageLineRow[]>(
    `${MESSAGE_SELECT}
     WHERE m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL AND g.read_messages = 1 AND g.is_confidential = 0
       AND (
         (g.thread_type = ? AND (
            m.sender_uid = ?
            OR JSON_CONTAINS(COALESCE(m.mentions, JSON_ARRAY()), JSON_OBJECT('uid', ?))
            OR (? AND m.sender_uid = ? AND m.group_id IN (
                  SELECT DISTINCT m2.group_id FROM message m2
                  WHERE m2.sender_uid = ? AND m2.sent_at >= ? AND m2.sent_at < ?))))
         OR (g.thread_type = ? AND g.zalo_group_id = ?)
       )
     ORDER BY m.sent_at DESC LIMIT ?`,
    [from, to, ConversationType.Group, personUid, personUid, includeMe ? 1 : 0, context.askerUid, personUid, from, to,
     ConversationType.Direct, personUid, MAX_MESSAGES],
  );
  rows.reverse();
  const { text, truncated } = formatLines(rows, true);
  return {
    from: formatVn(from),
    to: formatVn(to),
    message_count: rows.length,
    truncated: truncated || rows.length >= MAX_MESSAGES,
    messages: text || "(không có trao đổi nào trong khoảng này)",
  };
}

async function searchFiles(context: ToolContext, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const groupId = context.scopeGroupId ?? (Number(args.group_id) || 0);
  const from = parseTime(args.from, new Date(0));
  const to = parseTime(args.to, new Date(context.now.getTime() + 86_400_000));
  // Mỗi từ khóa phải xuất hiện trong tên tệp hoặc chú thích — "bao gia thanh cong" khớp
  // "Báo giá DL Thành Công.xlsx" dù khác thứ tự chữ ở giữa
  const words = query.split(/\s+/).filter((word) => word.length >= 2).slice(0, 6);
  // Không từ khóa = tệp gần đây của CHÍNH người hỏi (họ gửi, hoặc nằm trong cuộc riêng của họ với bot) — để bot liệt kê cho chọn
  // Có từ khóa: khớp tên tệp, chú thích, hoặc CHỮ ĐÃ BÓC từ tệp (attachment_text) — tệp bot từng đọc thì tìm được theo nội dung
  // Trong nhóm, không từ khóa = tệp gần đây của nhóm đó
  const conditions = words.length
    ? words.map(() => "(a.file_name LIKE ? OR m.text LIKE ? OR t.text LIKE ?)").join(" AND ")
    : context.scopeGroupId ? "1 = 1" : `(m.sender_uid = ? OR (g.thread_type = ${ConversationType.Direct} AND g.zalo_group_id = ?))`;
  const conditionParams = words.length
    ? words.flatMap((word) => [`%${word}%`, `%${word}%`, `%${word}%`])
    : context.scopeGroupId ? [] : [context.askerUid, context.askerUid];
  const [rows] = await context.db.query<RowDataPacket[]>(
    `SELECT a.id, a.file_name, a.file_ext, a.status, a.stored_bytes, a.declared_size, m.sent_at, m.sender_name, m.zalo_msg_type,
            COALESCE(NULLIF(g.label, ''), g.name) AS group_name, g.thread_type, t.char_count AS text_chars
     FROM attachment a JOIN message m ON m.id = a.message_id JOIN zalo_group g ON g.id = a.group_id
     LEFT JOIN attachment_text t ON t.attachment_id = a.id
     WHERE ${conditions} AND (? = 0 OR a.group_id = ?) AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL
       AND g.is_confidential = 0
     ORDER BY m.sent_at DESC LIMIT 20`,
    [...conditionParams, groupId, groupId, from, to],
  );
  return {
    files: rows.map((row) => ({
      id: row.id,
      name: row.file_name || `(${row.zalo_msg_type})`,
      group: row.thread_type === ConversationType.Direct ? "nhắn riêng bot" : row.group_name,
      sender: row.sender_name,
      sent: formatVn(row.sent_at),
      size_kb: Math.round(((row.stored_bytes ?? row.declared_size) || 0) / 1024),
      can_send: row.status === AttachmentStatus.Stored,
      can_read: row.status === AttachmentStatus.Stored,
      already_read: row.text_chars !== null && row.text_chars !== undefined,
    })),
  };
}

/** Chữ đưa cho mô hình tối đa ngần này ký tự một lượt — hơn thì cắt và nói rõ. */
const READ_FILE_MAX_CHARS = 60_000;

async function readFile(context: ToolContext, args: Record<string, unknown>) {
  if (!context.readFile) return { error: "Bot chưa bật đọc tệp" };
  const attachmentId = Number(args.attachment_id);
  if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return { error: "Thiếu attachment_id" };
  const [owner] = await context.db.query<RowDataPacket[]>(
    "SELECT a.group_id, g.is_confidential FROM attachment a JOIN zalo_group g ON g.id = a.group_id WHERE a.id = ?", [attachmentId]);
  if (context.scopeGroupId && Number(owner[0]?.group_id) !== context.scopeGroupId) return { error: "Tệp này không thuộc nhóm đang hỏi." };
  if (owner[0]?.is_confidential) return { error: CONFIDENTIAL_ERROR };
  const result = await context.readFile(attachmentId);
  if ("error" in result) return result;
  if (context.usage) {
    context.usage.inputTokens += result.inputTokens;
    context.usage.outputTokens += result.outputTokens;
  }
  context.markHeavy?.(`đọc tệp ${result.fileName}`);
  const truncated = result.text.length > READ_FILE_MAX_CHARS;
  return {
    file: result.fileName,
    how: result.method,
    summary: result.summary,
    char_count: result.charCount,
    truncated,
    content: truncated ? result.text.slice(0, READ_FILE_MAX_CHARS) : result.text,
  };
}

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
      return { error: "Tìm web CHƯA BẬT: khóa Gemini đang ở gói miễn phí, không có hạn mức tìm Google. Báo người hỏi là quản trị cần bật thanh toán cho khóa." };
    }
    throw error;
  }
}

async function sendFile(context: ToolContext, args: Record<string, unknown>) {
  const attachmentId = Number(args.attachment_id);
  if (context.filesToSend.length >= MAX_FILES_PER_TURN) return { error: `Mỗi lần chỉ gửi tối đa ${MAX_FILES_PER_TURN} tệp.` };
  const [rows] = await context.db.query<RowDataPacket[]>(
    "SELECT a.id, a.file_name, a.status, g.is_confidential FROM attachment a JOIN zalo_group g ON g.id = a.group_id WHERE a.id = ?", [attachmentId]);
  const file = rows[0];
  if (!file) return { error: "Không có tệp này." };
  if (file.is_confidential) return { error: CONFIDENTIAL_ERROR };
  if (file.status !== AttachmentStatus.Stored) return { error: "Tệp này chưa có trong kho (link Zalo hết hạn hoặc nhóm không bật lấy file)." };
  if (!context.filesToSend.includes(attachmentId)) context.filesToSend.push(attachmentId);
  return { queued: true, name: file.file_name };
}

const EXECUTORS: Record<string, (context: ToolContext, args: Record<string, unknown>) => Promise<unknown>> = {
  list_groups: listGroups,
  get_group_messages: getGroupMessages,
  find_people: findPeople,
  get_conversation_with_person: getConversationWithPerson,
  search_files: searchFiles,
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
  list_contacts: (context, args) => runListContacts(context.db, args),
  create_meeting_recap_pdf: (context, args) => runCreateRecapPdf(context.createRecapPdf, args, context.now),
  create_summary_pdf: (context, args) => runCreateRecapPdf(context.createRecapPdf, args, context.now, "document"),
  create_meeting: (context, args) =>
    runCreateMeeting(context.meetings, (context.actionCounter ??= { done: 0 }), args, context.now, meetingScopeTag(context.scopeGroupId)),
  list_meetings: (context) => runListMeetings(context.meetings, meetingScopeTag(context.scopeGroupId)),
  cancel_meeting: (context, args) =>
    runCancelMeeting(context.meetings, (context.actionCounter ??= { done: 0 }), args, meetingScopeTag(context.scopeGroupId)),
  ...Object.fromEntries([...TICKET_TOOL_NAMES].map((name) => [name,
    (context: ToolContext, args: Record<string, unknown>) => runTicketTool(context.ticket, name, args, context.now)])),
  ...Object.fromEntries([...ALERT_TOOL_NAMES].map((name) => [name,
    (context: ToolContext, args: Record<string, unknown>) =>
      runAlertTool(context.alertTools, context.alertAsker, name, args, context.now, context.turnStartedAt ?? Date.now())])),
  ...Object.fromEntries([...GROUP_ACTION_TOOL_NAMES].map((name) => [name,
    (context: ToolContext, args: Record<string, unknown>) =>
      runGroupAction(context.groupActions, (context.actionCounter ??= { done: 0 }), name, args, context.now)])),
};

export async function runTool(context: ToolContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const executor = EXECUTORS[name];
  if (!executor) return { error: `Không có công cụ ${name}` };
  if (context.scopeGroupId && !GROUP_SCOPE_TOOL_NAMES.has(name)) return { error: "Hỏi trong nhóm chỉ dùng được dữ liệu của nhóm này." };
  try {
    return (await executor(context, args ?? {})) as Record<string, unknown>;
  } catch (error) {
    return { error: `Công cụ lỗi: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
  }
}
