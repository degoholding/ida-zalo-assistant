import type { RowDataPacket } from "mysql2";
import { maxAccessLevelForRole } from "../../auth/mcp-api-key-store.js";
import { ContactRole, McpAccessLevel, UserRole } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { isAckText } from "../../assistant/assistant-ack-texts.js";
import { isActiveRecipientUid } from "../../recipients/recipient-repository.js";
import { isTicketHandler } from "../../tickets/ticket-service.js";
import type { DataAccessContext } from "../data-access-context.js";

// Chủ thể «liên hệ Zalo» (phase 5, O3): người đang nhắn bot trên Zalo — CÓ HOẶC KHÔNG có tài khoản web. Đứng cạnh `principal` (phạm vi đọc):
// một lượt trợ lý có CẢ HAI. Danh tính chỉ đến từ tin Zalo đã nhận (uid người gửi), không từ tham số công cụ; cổng HTTP không bao giờ đặt nó.
// Luật «ai làm được gì theo quan hệ» (người giao / phụ trách / người báo / người xử lý / sếp) dựa trên các SỰ THẬT ở đây — hỏi DB lười, nhớ trong lượt.

/** Chữ CỦA CHÍNH người hỏi trong lượt này (câu họ vừa nhắn + câu trả lời liền trước của bot với họ) — căn cứ «mã việc / ticket / tin do chính người hỏi nêu» (D-A). */
export interface OwnTurnTexts {
  asker: string;
  previousBotReply: string;
}

/** Danh tính người hỏi suy từ đâu (xem `resolveAskerAccess`); `disabled_account` = có tài khoản web nhưng đã tắt hết → mất đặc quyền suy từ vai trò. */
export type AskerOrigin = "web_user" | "derived_role" | "derived_recipient" | "disabled_account";

export interface ContactActorFacts {
  /** Có trong bảng người xử lý ticket (do quản trị chỉ định) không. */
  isTicketHandler(): Promise<boolean>;
  /** Người xử lý, hoặc có vai trò Danh bạ (và tài khoản web không bị tắt) — xem / thao tác ticket của người khác. */
  isTicketOverseer(): Promise<boolean>;
  /** «Sếp» của việc: có vai trò Danh bạ hoặc là người nhận đang bật; tài khoản web đã tắt thì không. */
  isTaskOverseer(): Promise<boolean>;
  /**
   * D-B: quyền «sếp» / cấu hình chung theo VAI TRÒ WEB. Người có tài khoản web đang bật (`origin = web_user`) chỉ có khi MỌI tài khoản đang bật của họ là
   * Quản trị / Quản lý; người không có tài khoản web (hoặc nguồn khác) giữ nguyên theo vai trò Danh bạ (true).
   */
  webRoleAllowsOversight(): Promise<boolean>;
  /** D-A: chữ của chính người hỏi trong lượt (đọc từ tin hỏi `messageId` + câu bot trả lời liền trước, không nhận từ mô hình). Nhớ trong lượt. */
  ownTurnTexts(): Promise<OwnTurnTexts>;
}

export interface ContactActor {
  contactId: number;
  uid: string;
  name: string;
  contactRole: number;
  contactKind: number;
  origin: AskerOrigin;
  /** Cuộc đang nhắn (tin riêng / nhóm) và tin chứa câu hỏi — việc / ticket mới gắn vào đây. */
  threadId: number | null;
  messageId: number | null;
  botAccountId: number | null;
  /** Hỏi trong nhóm: id nhóm; null = tin riêng. */
  groupId: number | null;
  facts: ContactActorFacts;
}

export interface ContactActorInput {
  contact: { id: number; uid: string; name: string; role: number; kind: number };
  origin: AskerOrigin;
  threadId?: number | null;
  messageId?: number | null;
  botAccountId?: number | null;
  groupId?: number | null;
  /** Ghi đè chữ người hỏi (bài kiểm / mô phỏng không có tin thật); bỏ trống = đọc từ tin `messageId`. */
  askerText?: string | null;
  /** Ghi đè câu trả lời liền trước của bot; bỏ trống = đọc từ cuộc riêng (hỏi trong nhóm thì rỗng). */
  previousBotReply?: string | null;
}

/** Tạo một sự thật lười: chỉ hỏi DB lần đầu, các lần sau trả lại kết quả cũ (kể cả lời hứa đang chờ); lỗi không được nhớ. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = load();
      cached.catch(() => { cached = null; });
    }
    return cached;
  };
}

/** D-B: mọi tài khoản web ĐANG BẬT gắn với liên hệ đều là Quản trị / Quản lý (phạm vi hẹp nhất như `narrowestPrincipal`). Không có tài khoản nào = false. */
async function webAccountsAreManagers(db: Db, contactId: number): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT role FROM app_user WHERE contact_id = ? AND is_active = 1 LIMIT 5", [contactId]);
  return rows.length > 0 && rows.every((row) => maxAccessLevelForRole(Number(row.role) as UserRole) === McpAccessLevel.ReadWrite);
}

/** Chữ tin hỏi (tin `messageId` của cuộc `threadId`); rỗng khi không có tin / không có chữ. */
async function loadQuestionText(db: Db, threadId: number | null, messageId: number | null): Promise<string> {
  if (messageId === null || threadId === null) return "";
  const [rows] = await db.query<RowDataPacket[]>("SELECT text FROM message WHERE id = ? AND group_id = ? LIMIT 1", [messageId, threadId]);
  return String(rows[0]?.text ?? "");
}

/** Câu bot trả lời liền trước người hỏi trong CUỘC RIÊNG (tin gần nhất của phía không phải người hỏi, bỏ câu «chờ em xíu»). */
async function loadPreviousBotReply(db: Db, threadId: number | null, messageId: number | null, askerUid: string): Promise<string> {
  if (threadId === null) return "";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT text FROM message WHERE group_id = ? AND sender_uid <> ? AND text IS NOT NULL AND text <> '' AND recalled_at IS NULL AND (? IS NULL OR id < ?)
     ORDER BY id DESC LIMIT 5`, [threadId, askerUid, messageId, messageId]);
  const reply = rows.find((row) => !isAckText(String(row.text)));
  return reply ? String(reply.text) : "";
}

export function buildContactActor(db: Db, input: ContactActorInput): ContactActor {
  const { contact, origin } = input;
  const handler = lazy(() => isTicketHandler(db, contact.uid));
  const webRoleOk = lazy(async () => origin !== "web_user" || webAccountsAreManagers(db, contact.id));
  const ticketOverseer = lazy(async () => (await handler()) || (contact.role > 0 && origin !== "disabled_account" && await webRoleOk()));
  const taskOverseer = lazy(async () => {
    if (origin === "disabled_account" || !(await webRoleOk())) return false;
    return contact.role !== ContactRole.None ? true : isActiveRecipientUid(db, contact.uid);
  });
  const ownTexts = lazy(async (): Promise<OwnTurnTexts> => ({
    asker: input.askerText ?? await loadQuestionText(db, input.threadId ?? null, input.messageId ?? null),
    previousBotReply: input.previousBotReply ?? (input.groupId ? "" : await loadPreviousBotReply(db, input.threadId ?? null, input.messageId ?? null, contact.uid)),
  }));
  return {
    contactId: contact.id, uid: contact.uid, name: contact.name, contactRole: contact.role, contactKind: contact.kind, origin,
    threadId: input.threadId ?? null, messageId: input.messageId ?? null, botAccountId: input.botAccountId ?? null, groupId: input.groupId ?? null,
    facts: { isTicketHandler: handler, isTicketOverseer: ticketOverseer, isTaskOverseer: taskOverseer, webRoleAllowsOversight: webRoleOk, ownTurnTexts: ownTexts },
  };
}

const memos = new WeakMap<ContactActor, Map<string, Promise<unknown>>>();

/**
 * Nhớ một sự thật RIÊNG của một họ (người nhận cảnh báo, người ra lệnh gửi…) trong đời một lượt: khóa theo chính đối tượng `contactActor`
 * (các bản sao ctx trong lượt dùng chung nó). Không có `contactActor` thì không nhớ — gọi thẳng `load`. Lỗi không được nhớ (lần sau thử lại).
 */
export function actorFactMemo<T>(ctx: Pick<DataAccessContext, "contactActor">, key: string, load: () => Promise<T>): Promise<T> {
  const actor = ctx.contactActor;
  if (!actor) return load();
  let facts = memos.get(actor);
  if (!facts) memos.set(actor, (facts = new Map()));
  const known = facts.get(key);
  if (known) return known as Promise<T>;
  const pending = load();
  facts.set(key, pending);
  pending.catch(() => facts.delete(key));
  return pending;
}
