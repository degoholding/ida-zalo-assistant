import { ContactRole } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { isActiveRecipientUid } from "../../recipients/recipient-repository.js";
import { isTicketHandler } from "../../tickets/ticket-service.js";
import type { DataAccessContext } from "../data-access-context.js";

// Chủ thể «liên hệ Zalo» (phase 5, O3): người đang nhắn bot trên Zalo — CÓ HOẶC KHÔNG có tài khoản web. Đứng cạnh `principal` (phạm vi đọc):
// một lượt trợ lý có CẢ HAI. Danh tính chỉ đến từ tin Zalo đã nhận (uid người gửi), không từ tham số công cụ; cổng HTTP không bao giờ đặt nó.
// Luật «ai làm được gì theo quan hệ» (người giao / phụ trách / người báo / người xử lý / sếp) dựa trên các SỰ THẬT ở đây — hỏi DB lười, nhớ trong lượt.

/** Danh tính người hỏi suy từ đâu (xem `resolveAskerAccess`); `disabled_account` = có tài khoản web nhưng đã tắt hết → mất đặc quyền suy từ vai trò. */
export type AskerOrigin = "web_user" | "derived_role" | "derived_recipient" | "disabled_account";

export interface ContactActorFacts {
  /** Có trong bảng người xử lý ticket (do quản trị chỉ định) không. */
  isTicketHandler(): Promise<boolean>;
  /** Người xử lý, hoặc có vai trò Danh bạ (và tài khoản web không bị tắt) — xem / thao tác ticket của người khác. */
  isTicketOverseer(): Promise<boolean>;
  /** «Sếp» của việc: có vai trò Danh bạ hoặc là người nhận đang bật; tài khoản web đã tắt thì không. */
  isTaskOverseer(): Promise<boolean>;
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

export function buildContactActor(db: Db, input: ContactActorInput): ContactActor {
  const { contact, origin } = input;
  const handler = lazy(() => isTicketHandler(db, contact.uid));
  const ticketOverseer = lazy(async () => (await handler()) || (contact.role > 0 && origin !== "disabled_account"));
  const taskOverseer = lazy(async () => {
    if (origin === "disabled_account") return false;
    return contact.role !== ContactRole.None ? true : isActiveRecipientUid(db, contact.uid);
  });
  return {
    contactId: contact.id, uid: contact.uid, name: contact.name, contactRole: contact.role, contactKind: contact.kind, origin,
    threadId: input.threadId ?? null, messageId: input.messageId ?? null, botAccountId: input.botAccountId ?? null, groupId: input.groupId ?? null,
    facts: { isTicketHandler: handler, isTicketOverseer: ticketOverseer, isTaskOverseer: taskOverseer },
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
