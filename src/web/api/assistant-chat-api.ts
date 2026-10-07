import type { RowDataPacket } from "mysql2";
import { AssistantTurnStatus, ContactRole, MessageKind } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { findContactByUid, type ContactRow } from "../../sync/contact-repository.js";
import { directKey, ensureThread, type GroupRow } from "../../sync/group-repository.js";
import { reportFileExtension } from "../../reports/report-exporter.js";
import { recordOutgoingMessage } from "../../sync/message-ingest.js";
import { ApiError, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";

// Khung «Hỏi trợ lý» trên web: quản trị hỏi trợ lý AI dưới tên một người có vai trò, không cần Zalo. Đi đúng
// đường AssistantService như tin Zalo thật (cùng cài đặt, công cụ, giới hạn, nhật ký assistant_turn). Mỗi người
// hỏi một cuộc riêng mã `web-<uid>` để trợ lý đọc lại câu trước — cuộc này không gửi ra Zalo được (sync-service).

export const WEB_CHAT_ID_PREFIX = "web-";
const MAX_QUESTION_CHARS = 2000;
const HISTORY_LIMIT = 100;
const ASSISTANT_NAME = "Trợ lý AI";
const ASSISTANT_UID = "web-assistant";

interface ChatMessageRow extends RowDataPacket {
  id: number;
  sender_uid: string;
  text: string | null;
  sent_at: Date;
  attachment_id: number | null;
  file_name: string | null;
}

function toChatMessage(row: ChatMessageRow, askerUid: string) {
  return {
    id: row.id,
    role: row.sender_uid === askerUid ? "user" : "assistant",
    text: row.attachment_id ? "" : row.text ?? "",
    sent_at: row.sent_at,
    file: row.attachment_id ? { attachment_id: row.attachment_id, file_name: row.file_name ?? "" } : null,
  };
}

async function loadAsker(db: Db, rawContactId: unknown): Promise<ContactRow> {
  const contactId = Number(rawContactId);
  if (!Number.isSafeInteger(contactId) || contactId <= 0) throw new ApiError(422, "validation_error", "Chưa chọn người hỏi");
  const [rows] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM contact WHERE id = ?", [contactId]);
  const contact = rows[0] ? await findContactByUid(db, String(rows[0].zalo_uid)) : null;
  if (!contact) throw new ApiError(404, "not_found", "Không có người này trong Danh bạ");
  if (contact.role === ContactRole.None) {
    throw new ApiError(422, "validation_error", "Người này chưa có vai trò — cấp Quản lý / Trưởng phòng ở Danh bạ thì mới hỏi được");
  }
  return contact;
}

/** Cuộc «Hỏi trợ lý» của một người (tạo nếu chưa có), gắn tài khoản bot đầu tiên — nhật ký assistant_turn cần bot. */
async function ensureWebThread(db: Db, contact: ContactRow): Promise<{ thread: GroupRow; botAccountId: number }> {
  const [bots] = await db.query<RowDataPacket[]>("SELECT id FROM bot_account ORDER BY is_active DESC, id LIMIT 1");
  if (!bots[0]) throw new ApiError(409, "no_bot_account", "Chưa có tài khoản bot nào — quét QR một tài khoản (hoặc chạy npm run seed:demo) trước");
  const botAccountId = Number(bots[0].id);
  const name = `Hỏi trợ lý · ${contact.display_name || contact.zalo_name}`;
  const { group: thread } = await ensureThread(db, directKey(botAccountId, `${WEB_CHAT_ID_PREFIX}${contact.zalo_uid}`),
    { readMessages: true, captureFiles: false }, name);
  return { thread, botAccountId };
}

async function loadMessages(db: Db, threadId: number, askerUid: string, afterId = 0) {
  const [rows] = await db.query<ChatMessageRow[]>(
    `SELECT m.id, m.sender_uid, m.text, m.sent_at, a.id AS attachment_id, a.file_name
     FROM message m LEFT JOIN attachment a ON a.message_id = m.id
     WHERE m.group_id = ? AND m.id > ? ORDER BY m.id DESC LIMIT ?`,
    [threadId, afterId, HISTORY_LIMIT],
  );
  return rows.reverse().map((row) => toChatMessage(row, askerUid));
}

const messageId = (kind: string) => `${WEB_CHAT_ID_PREFIX}${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const assistantChatRoutes: ApiRoute[] = [
  // Người hỏi được: ai có vai trò trong Danh bạ — kèm trạng thái trợ lý để giao diện báo sớm khi đang tắt
  ["GET", /^\/api\/assistant-chat\/askers$/, async ({ response, service }) => {
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT id, COALESCE(NULLIF(display_name, ''), zalo_name) AS name, role FROM contact
       WHERE role > ? ORDER BY role DESC, name`, [ContactRole.None]);
    sendOk(response, { assistant_on: Boolean(service.assistant), askers: rows });
  }],

  ["GET", /^\/api\/assistant-chat\/messages$/, async ({ response, url, service }) => {
    const contact = await loadAsker(service.db, url.searchParams.get("contact_id"));
    const { thread } = await ensureWebThread(service.db, contact);
    sendOk(response, await loadMessages(service.db, thread.id, contact.zalo_uid));
  }],

  ["POST", /^\/api\/assistant-chat\/messages$/, async ({ request, response, service }) => {
    const body = await readJson(request);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) throw new ApiError(422, "validation_error", "Chưa có câu hỏi");
    if (question.length > MAX_QUESTION_CHARS) throw new ApiError(422, "validation_error", `Câu hỏi tối đa ${MAX_QUESTION_CHARS} ký tự`);
    const assistant = service.assistant;
    if (!assistant) throw new ApiError(409, "assistant_off", "Trợ lý AI đang tắt — đặt khóa Gemini hoặc OpenAI (khớp mô hình chính) ở màn Cài đặt");
    const contact = await loadAsker(service.db, body.contact_id);
    const { thread, botAccountId } = await ensureWebThread(service.db, contact);
    const db = service.db;
    const asker = { uid: contact.zalo_uid, name: contact.display_name || contact.zalo_name };
    const bot = { uid: ASSISTANT_UID, name: ASSISTANT_NAME };

    const questionMessageId = await recordOutgoingMessage(db, thread, asker, messageId("q"), question, { source: "web" });
    const reply = await assistant.answer({ botAccountId, contact, threadId: thread.id, questionMessageId, question });
    if (reply.text) await recordOutgoingMessage(db, thread, bot, messageId("a"), reply.text, { source: "web" });
    for (const file of reply.reportFiles ?? []) {
      await recordOutgoingMessage(db, thread, bot, messageId("f"), file.fileName, {
        source: "web", kind: MessageKind.File, file: { name: file.fileName, ext: reportFileExtension(file.fileName), storageKey: file.storageKey, bytes: file.bytes },
      });
    }
    // Trả mọi tin từ câu hỏi trở đi (câu hỏi, câu trả lời, tệp) — giao diện nối vào khung chat
    const messages = await loadMessages(db, thread.id, contact.zalo_uid, (questionMessageId ?? 1) - 1);
    sendOk(response, { status: AssistantTurnStatus[reply.status], messages }, reply.text ? "Đã trả lời" : "Trợ lý không trả lời");
  }],
];
