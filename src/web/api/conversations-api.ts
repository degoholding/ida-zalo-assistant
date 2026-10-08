import { SYSTEM_PRINCIPAL, type Principal } from "../../auth/principal.js";
import { assertThreadVisible, scopedWhere } from "./scope.js";
import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { describeError } from "../../logger.js";
import { OUTGOING_SOURCE } from "../../sync/message-ingest.js";
import { ApiError, parseId, readJson, readRawBody, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { getContactCardByUid, loadBotUids } from "./contacts-api.js";
import { decorateFile } from "./files-api.js";
import { listGroupMembers } from "./groups-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Hội thoại (màn 3 cột kiểu Zalo): danh sách cuộc, dòng tin theo giờ gửi (cuộn ngược), hồ sơ cột phải.
// Chỉ xem — bot trả lời trên Zalo, quản trị không gõ thay ở đây.

const TIMELINE_PAGE_SIZE = 100;
const MAX_TIMELINE_PAGE_SIZE = 300;

export const CONVERSATION_LIST_SPEC: ListSpec = {
  fields: {
    thread_type: { sql: "g.thread_type", type: "number" },
    company_id: { sql: "g.company_id", type: "number" },
    name: { sql: "g.name", type: "text" },
  },
  sorts: { last_message_at: "g.last_message_at IS NULL, g.last_message_at", name: "COALESCE(NULLIF(g.label, ''), g.name)" },
  defaultSort: { by: "last_message_at", dir: "desc" },
  tieBreaker: "g.id",
  search: { param: "q", columns: ["g.name", "g.label"] },
};

// Bộ đếm `message_count` / `last_message_at` nằm sẵn trên zalo_group (migration 011) — không quét bảng message
const CONVERSATION_FROM = "FROM zalo_group g";
const CONVERSATION_COLUMNS = `
  g.id, g.thread_type, g.name, g.label, g.zalo_group_id, g.owner_bot_id, g.company_id, g.message_count, g.last_message_at,
  CASE WHEN g.thread_type = ${ConversationType.Group}
       THEN IF(g.avatar_key IS NULL, NULL, CONCAT('/avatars/g/', g.id))
       ELSE (SELECT IF(c.avatar_key IS NULL, NULL, CONCAT('/avatars/c/', c.zalo_uid)) FROM contact c WHERE c.zalo_uid = g.zalo_group_id)
  END AS avatar_url,
  (SELECT m.text FROM message m WHERE m.group_id = g.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_text,
  (SELECT m.sender_name FROM message m WHERE m.group_id = g.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_sender,
  (SELECT m.sender_uid FROM message m WHERE m.group_id = g.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_sender_uid`;

/** Nhóm chỉ hiện khi đã bật đọc; cuộc riêng luôn hiện. */
const BASE_WHERE = { sql: `g.thread_type = ${ConversationType.Direct} OR g.read_messages = 1`, params: [] as unknown[] };

function decorateThread(bots: Set<string>) {
  return (row: RowDataPacket) => ({
    ...row,
    display_name: String(row.label || row.name || "(chưa rõ tên)"),
    message_count: Number(row.message_count),
    last_from_bot: bots.has(String(row.last_sender_uid ?? "")),
  });
}

export async function listConversations(db: Db, params: URLSearchParams, principal: Principal = SYSTEM_PRINCIPAL) {
  const bots = await loadBotUids(db);
  return runList(db, params, CONVERSATION_LIST_SPEC, {
    select: CONVERSATION_COLUMNS, from: CONVERSATION_FROM, baseWhere: scopedWhere(principal, BASE_WHERE, "g.id"), decorate: (rows) => rows.map(decorateThread(bots)),
  });
}

/** Đầu cuộc + hồ sơ cột phải: `contact` (cuộc riêng) hoặc `group` + thành viên (nhóm). */
export async function getConversation(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${CONVERSATION_COLUMNS} ${CONVERSATION_FROM} WHERE g.id = ?`, [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có cuộc trò chuyện này");
  const bots = await loadBotUids(db);
  const thread = decorateThread(bots)(rows[0]);
  // Tài khoản bot sẽ đứng tên tin quản trị gõ: cuộc riêng → bot chủ cuộc; nhóm → bot còn trong nhóm
  const [botRows] = await db.query<RowDataPacket[]>(
    rows[0].thread_type === ConversationType.Direct
      ? "SELECT COALESCE(NULLIF(display_name, ''), label) AS name FROM bot_account WHERE id = ?"
      : `SELECT COALESCE(NULLIF(b.display_name, ''), b.label) AS name FROM bot_group bg JOIN bot_account b ON b.id = bg.bot_account_id
         WHERE bg.group_id = ? AND bg.left_at IS NULL AND b.is_active = 1 ORDER BY b.id LIMIT 1`,
    [rows[0].thread_type === ConversationType.Direct ? rows[0].owner_bot_id : id]);
  const botName = botRows[0] ? String(botRows[0].name) : null;
  if (rows[0].thread_type === ConversationType.Direct) {
    const contact = await getContactCardByUid(db, String(rows[0].zalo_group_id)).catch(() => null);
    return { ...thread, bot_name: botName, contact, group: null };
  }
  const [groups] = await db.query<RowDataPacket[]>(
    `SELECT g.id, g.name, g.label, g.zalo_group_id, g.group_kind, g.member_count, g.read_messages, g.capture_files, g.retention_days,
            g.company_id, co.name AS company_name, IF(g.avatar_key IS NULL, NULL, CONCAT('/avatars/g/', g.id)) AS avatar_url
     FROM zalo_group g LEFT JOIN company co ON co.id = g.company_id WHERE g.id = ?`, [id]);
  return { ...thread, bot_name: botName, contact: null, group: { ...groups[0], members: await listGroupMembers(db, id) } };
}

const MESSAGE_SELECT = `SELECT m.id, m.sender_uid, m.sender_name, m.sent_at, m.text, m.kind, m.zalo_msg_type, m.quote_text, m.recalled_at,
            a.id AS attachment_id, a.file_name, a.file_ext, a.status AS attachment_status, a.stored_bytes, a.declared_size,
            sc.avatar_key AS sender_avatar_key, sc.id AS sender_contact_id
     FROM message m LEFT JOIN attachment a ON a.message_id = m.id LEFT JOIN contact sc ON sc.zalo_uid = m.sender_uid`;

/** Số nguyên dương từ tham số truy vấn; sai / thiếu = 0. */
function positiveParam(params: URLSearchParams, name: string): number {
  const value = Number(params.get(name));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Tin `messageId` của ĐÚNG cuộc này — không thì 404, khỏi lần ra tin của cuộc ngoài phạm vi qua id. */
async function findAnchor(db: Db, threadId: number, messageId: number): Promise<RowDataPacket> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, sent_at FROM message WHERE id = ? AND group_id = ?", [messageId, threadId]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có tin này trong cuộc — có thể tin đã bị dọn theo hạn giữ");
  return rows[0];
}

/**
 * Tối đa `limit` tin cũ hơn (hoặc mới hơn) tin mốc, cùng mili giây thì so id — hai tin trùng giờ không bị sót ở ranh
 * trang. Lấy dư một dòng để biết CHẮC còn tin nữa không (không đoán theo «đủ trang»). Trả xếp tăng dần theo giờ gửi.
 */
async function loadBeside(db: Db, threadId: number, anchor: RowDataPacket | null, side: "older" | "newer", limit: number, inclusive = false) {
  const older = side === "older";
  const condition = !anchor ? "" : older
    ? `AND (m.sent_at < ? OR (m.sent_at = ? AND m.id ${inclusive ? "<=" : "<"} ?))`
    : "AND (m.sent_at > ? OR (m.sent_at = ? AND m.id > ?))";
  const [rows] = await db.query<RowDataPacket[]>(
    `${MESSAGE_SELECT} WHERE m.group_id = ? ${condition}
     ORDER BY m.sent_at ${older ? "DESC" : "ASC"}, m.id ${older ? "DESC" : "ASC"} LIMIT ?`,
    anchor ? [threadId, anchor.sent_at, anchor.sent_at, anchor.id, limit + 1] : [threadId, limit + 1]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  if (older) page.reverse();
  return { rows: page, more };
}

/**
 * Lấy các dòng tin của một trang (chưa trang trí), xếp theo giờ gửi tăng dần, kèm hai mốc là ID TIN:
 * `older_cursor` (còn tin cũ hơn → `before_id=`) và `newer_cursor` (còn tin mới hơn → `after_id=`). Null = hết phía đó.
 *   - không gì: trang mới nhất (không có `newer_cursor`).
 *   - `before_id=<id tin>`: trang cũ hơn tin đó (cuộn lên).
 *   - `around=<id tin>`: nửa trang trước (kể cả tin đó) + nửa trang sau — mở cuộc đúng chỗ tin đó (màn Tệp «Xem trong hội thoại»).
 *   - `after_id=<id tin>`: trang mới hơn tin đó (cuộn xuống khi đang xem quanh một tin cũ). Trang này LUÔN kèm
 *     `older_cursor` (tin cũ nhất của trang): giao diện nạp lại chuỗi trang từ trang mới nhất rồi lần ngược về trước.
 *   - `before=<ms>`: kiểu cũ theo mốc giờ, còn nhận cho tương thích.
 */
async function loadMessageRows(db: Db, threadId: number, params: URLSearchParams, limit: number) {
  const idOf = (row: RowDataPacket | undefined): number | null => (row ? Number(row.id) : null);
  const aroundId = positiveParam(params, "around");
  if (aroundId) {
    const anchor = await findAnchor(db, threadId, aroundId);
    const olderPart = await loadBeside(db, threadId, anchor, "older", Math.ceil(limit / 2), true);
    const newerPart = await loadBeside(db, threadId, anchor, "newer", Math.max(1, limit - Math.ceil(limit / 2)));
    return {
      rows: [...olderPart.rows, ...newerPart.rows],
      older: olderPart.more ? idOf(olderPart.rows[0]) : null,
      newer: newerPart.more ? idOf(newerPart.rows.at(-1)) : null,
    };
  }
  const afterId = positiveParam(params, "after_id");
  if (afterId) {
    const part = await loadBeside(db, threadId, await findAnchor(db, threadId, afterId), "newer", limit);
    // Trang rỗng chỉ xảy ra khi tin vừa bị dọn giữa hai lần hỏi — khi đó không còn gì để lần ngược
    return { rows: part.rows, older: idOf(part.rows[0]), newer: part.more ? idOf(part.rows.at(-1)) : null };
  }
  const beforeId = positiveParam(params, "before_id");
  if (beforeId) {
    const part = await loadBeside(db, threadId, await findAnchor(db, threadId, beforeId), "older", limit);
    return { rows: part.rows, older: part.more ? idOf(part.rows[0]) : null, newer: null };
  }
  const beforeMs = positiveParam(params, "before");
  if (beforeMs) {
    const [rows] = await db.query<RowDataPacket[]>(
      `${MESSAGE_SELECT} WHERE m.group_id = ? AND m.sent_at < ? ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`, [threadId, new Date(beforeMs), limit + 1]);
    const page = rows.slice(0, limit).reverse();
    return { rows: page, older: rows.length > limit ? idOf(page[0]) : null, newer: null };
  }
  const part = await loadBeside(db, threadId, null, "older", limit);
  return { rows: part.rows, older: part.more ? idOf(part.rows[0]) : null, newer: null };
}

/**
 * Một trang tin của cuộc, xếp theo GIỜ GỬI tăng dần (tin bù về sau vẫn nằm đúng chỗ). Cách chọn trang: xem
 * loadMessageRows (`before_id` / `after_id` / `around`).
 */
export async function listMessages(db: Db, threadId: number, params: URLSearchParams): Promise<Record<string, unknown>> {
  const [threads] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE id = ?", [threadId]);
  if (!threads[0]) throw new ApiError(404, "not_found", "Không có cuộc trò chuyện này");
  const limit = Math.min(MAX_TIMELINE_PAGE_SIZE, Math.max(1, positiveParam(params, "limit") || TIMELINE_PAGE_SIZE));
  const { rows, older, newer } = await loadMessageRows(db, threadId, params, limit);
  const bots = await loadBotUids(db);
  const items = rows.map((row) => {
    const { sender_avatar_key: avatarKey, ...rest } = row;
    const attachment = row.attachment_id
      ? decorateFile({ id: row.attachment_id, status: row.attachment_status, stored_bytes: row.stored_bytes, declared_size: row.declared_size,
          file_name: row.file_name, file_ext: row.file_ext, sender_uid: row.sender_uid } as RowDataPacket)
      : null;
    return {
      ...rest,
      sender_avatar_url: avatarKey ? `/avatars/c/${encodeURIComponent(String(row.sender_uid))}` : null,
      from_bot: bots.has(String(row.sender_uid)),
      // Quản trị gõ tay từ web (khác AI tự trả lời) — màn Hội thoại gắn nhãn nhỏ
      from_admin: row.zalo_msg_type === OUTGOING_SOURCE.admin,
      attachment: attachment && { id: attachment.id, file_name: attachment.file_name, file_ext: attachment.file_ext, status: attachment.status,
        size: attachment.size, download_url: attachment.download_url },
    };
  });
  return { items, older_cursor: older, newer_cursor: newer };
}

const MAX_TEXT_LENGTH = 10_000;

/** Lỗi gửi (bot tắt, Zalo từ chối…) → 502 kèm câu dễ hiểu; lỗi «không có cuộc» → 404. */
async function translateSendError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = describeError(error);
    if (message.startsWith("Không có cuộc")) throw new ApiError(404, "not_found", message);
    throw new ApiError(502, "send_failed", `Gửi không được: ${message}`);
  }
}

export const conversationRoutes: ApiRoute[] = [
  // Quản trị gõ chữ từ màn Hội thoại — đi ra Zalo dưới tên tài khoản bot
  ["POST", /^\/api\/conversations\/(\d+)\/messages$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    assertThreadVisible(principal, id);
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new ApiError(422, "validation_error", "Chưa có nội dung tin");
    if (text.length > MAX_TEXT_LENGTH) throw new ApiError(422, "validation_error", `Tin tối đa ${MAX_TEXT_LENGTH} ký tự`);
    const messageId = await translateSendError(() => service.sendAdminText(id, text));
    sendOk(response, { message_id: messageId }, "Đã gửi");
  }],
  // Tải tệp / ảnh lên rồi bot gửi đi: thân là nhị phân thuần, tên tệp ở header x-file-name (đã encodeURIComponent)
  ["POST", /^\/api\/conversations\/(\d+)\/attachments$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    assertThreadVisible(principal, id);
    const rawName = request.headers["x-file-name"];
    const fileName = decodeURIComponent(String(Array.isArray(rawName) ? rawName[0] : rawName ?? "")).trim();
    if (!fileName) throw new ApiError(422, "validation_error", "Thiếu tên tệp");
    const contentType = String(request.headers["content-type"] ?? "application/octet-stream").split(";")[0].trim();
    const data = await readRawBody(request);
    if (!data.length) throw new ApiError(422, "validation_error", "Tệp rỗng");
    const messageId = await translateSendError(() => service.sendAdminFile(id, data, fileName, contentType));
    sendOk(response, { message_id: messageId }, `Đã gửi tệp ${fileName}`);
  }],
  ["GET", /^\/api\/conversations$/, async ({ response, url, service, principal }) => sendOk(response, await listConversations(service.db, url.searchParams, principal))],
  ["GET", /^\/api\/conversations\/(\d+)$/, async ({ response, match, service, principal }) => {
    const id = parseId(match[1]);
    assertThreadVisible(principal, id);
    sendOk(response, await getConversation(service.db, id));
  }],
  ["GET", /^\/api\/conversations\/(\d+)\/messages$/, async ({ response, match, url, service, principal }) => {
    const id = parseId(match[1]);
    assertThreadVisible(principal, id);
    sendOk(response, await listMessages(service.db, id, url.searchParams));
  }],
];
