import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType, JobKind, TicketEventKind, TicketStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { enqueueJob } from "../jobs/job-queue.js";

// Ticket qua bot (08/10/2026, đại ca chốt: việc chung của IDA, chỉ trong bot, không nối ERP). Một chỗ cho mọi thao tác —
// lệnh gõ trên Zalo (src/assistant/chat-commands.ts) và màn Ticket trên web (src/web/api/tickets-api.ts) đều gọi vào đây,
// nên ai làm ở đâu thì người kia cũng được báo như nhau. Tin báo đi qua hàng đợi (JobKind.ContactMessage) — tiến trình
// app giữ phiên Zalo gửi.

/** Ảnh người gửi gửi TRƯỚC lời báo trong khoảng này được gắn vào ticket. */
const ATTACH_WINDOW_MS = 15 * 60_000;
const MAX_ATTACHMENTS = 10;
const TITLE_MAX = 120;

export interface TicketDeps {
  db: Db;
  /** Ảnh nhóm chưa bật lấy tệp (Skipped) / tải lỗi: đưa lại hàng tải về kho */
  requestDownload?: (attachmentIds: number[]) => void;
  /** Có việc mới trong hàng đợi — đánh thức bộ chạy việc */
  wakeJobs?: () => void;
}

export interface TicketActor {
  name: string;
  /** Người trên Zalo (người xử lý / người gửi); null = làm trên web */
  contactId: number | null;
  via: "zalo" | "web";
}

export interface TicketRow {
  id: number;
  code: string;
  status: TicketStatus;
  title: string;
  body: string;
  requester_contact_id: number | null;
  requester_uid: string;
  requester_name: string;
  source_thread_id: number | null;
  handler_contact_id: number | null;
  handler_name: string;
  resolution: string;
  created_at: Date;
}

export interface ContactMessagePayload {
  /** Nhắn vào một cuộc có sẵn (riêng / nhóm) — hoặc nhắn riêng một người theo mã Zalo */
  threadId?: number;
  zaloUid?: string;
  name?: string;
  text?: string;
  attachmentIds?: number[];
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  [TicketStatus.New]: "mới, chờ người nhận",
  [TicketStatus.InProgress]: "đang xử lý",
  [TicketStatus.Done]: "đã xong",
  [TicketStatus.Cancelled]: "đã hủy",
};

export const formatTicketCode = (id: number) => `T-${String(id).padStart(4, "0")}`;
const shortCode = (ticket: Pick<TicketRow, "id">) => `T-${ticket.id}`;
const isOpen = (status: TicketStatus) => status === TicketStatus.New || status === TicketStatus.InProgress;

const TICKET_COLUMNS = `id, code, status, title, COALESCE(body, '') AS body, requester_contact_id, requester_uid, requester_name,
  source_thread_id, handler_contact_id, handler_name, COALESCE(resolution, '') AS resolution, created_at`;

function toTicket(row: RowDataPacket): TicketRow {
  return {
    ...(row as TicketRow), id: Number(row.id), status: Number(row.status) as TicketStatus,
    requester_contact_id: row.requester_contact_id === null ? null : Number(row.requester_contact_id),
    source_thread_id: row.source_thread_id === null ? null : Number(row.source_thread_id),
    handler_contact_id: row.handler_contact_id === null ? null : Number(row.handler_contact_id),
  };
}

export async function findTicket(db: Db, id: number, tenantId = 1): Promise<TicketRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${TICKET_COLUMNS} FROM ticket WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return rows[0] ? toTicket(rows[0]) : null;
}

export interface TicketHandler {
  contactId: number;
  zaloUid: string;
  name: string;
}

export async function listTicketHandlers(db: Db, tenantId = 1): Promise<TicketHandler[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.id, c.zalo_uid, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name
     FROM ticket_handler h JOIN contact c ON c.id = h.contact_id WHERE h.tenant_id = ? ORDER BY name`, [tenantId]);
  return rows.map((row) => ({ contactId: Number(row.id), zaloUid: String(row.zalo_uid), name: String(row.name ?? "") }));
}

export async function isTicketHandler(db: Db, zaloUid: string, tenantId = 1): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM ticket_handler h JOIN contact c ON c.id = h.contact_id WHERE h.tenant_id = ? AND c.zalo_uid = ? LIMIT 1", [tenantId, zaloUid]);
  return rows.length > 0;
}

/** Tin riêng / tin vào một cuộc — xếp hàng đợi. Lỗi gửi thì hàng đợi thử lại; báo trễ quá 6 giờ thì thôi. */
async function enqueueMessage(deps: TicketDeps, payload: ContactMessagePayload, dedupeKey: string, delayMs = 0): Promise<void> {
  const target = payload.threadId ? `thread:${payload.threadId}` : `uid:${payload.zaloUid}`;
  await enqueueJob(deps.db, {
    kind: JobKind.ContactMessage, payload, dedupeKey, serialKey: `contact:${target}`,
    runAfter: delayMs ? new Date(Date.now() + delayMs) : undefined, expiresInMs: 6 * 60 * 60_000, maxAttempts: 4,
  });
  deps.wakeJobs?.();
}

async function recordEvent(db: Db, ticketId: number, kind: TicketEventKind, actor: TicketActor, note = ""): Promise<void> {
  await db.query("INSERT INTO ticket_event (ticket_id, kind, actor_name, via, note) VALUES (?, ?, ?, ?, ?)",
    [ticketId, kind, actor.name.slice(0, 255), actor.via, note || null]);
}

/**
 * Ảnh / tệp người gửi vừa gửi trong cùng cuộc (trong 15 phút, tới tin báo) chưa thuộc ticket nào: gắn vào ticket.
 * Tệp chưa có trong kho (nhóm chưa bật lấy tệp, tải lỗi) thì đưa lại hàng tải.
 */
async function attachRecentFiles(deps: TicketDeps, ticketId: number, threadId: number | null, senderUid: string,
  uptoMessageId: number | null, now: Date): Promise<number[]> {
  if (!threadId) return [];
  const [rows] = await deps.db.query<RowDataPacket[]>(
    `SELECT a.id, a.status FROM attachment a JOIN message m ON m.id = a.message_id
     WHERE m.group_id = ? AND m.sender_uid = ? AND m.sent_at >= ? AND m.recalled_at IS NULL ${uptoMessageId ? "AND m.id <= ?" : ""}
       AND NOT EXISTS (SELECT 1 FROM ticket_attachment ta WHERE ta.attachment_id = a.id)
     ORDER BY m.id DESC LIMIT ?`,
    [threadId, senderUid, new Date(now.getTime() - ATTACH_WINDOW_MS), ...(uptoMessageId ? [uptoMessageId] : []), MAX_ATTACHMENTS]);
  if (!rows.length) return [];
  const ids = rows.map((row) => Number(row.id)).reverse();
  await deps.db.query("INSERT IGNORE INTO ticket_attachment (ticket_id, attachment_id) VALUES ?", [ids.map((id) => [ticketId, id])]);
  const toFetch = rows.filter((row) => [AttachmentStatus.Skipped, AttachmentStatus.Failed].includes(Number(row.status))).map((row) => Number(row.id));
  if (toFetch.length) {
    await deps.db.query("UPDATE attachment SET status = ?, attempts = 0, last_error = '' WHERE id IN (?) AND status IN (?, ?)",
      [AttachmentStatus.Pending, toFetch, AttachmentStatus.Skipped, AttachmentStatus.Failed]);
    deps.requestDownload?.(toFetch);
  }
  return ids;
}

async function threadLabel(db: Db, threadId: number | null): Promise<string> {
  if (!threadId) return "";
  const [rows] = await db.query<RowDataPacket[]>("SELECT thread_type, COALESCE(NULLIF(label, ''), name) AS name FROM zalo_group WHERE id = ?", [threadId]);
  if (!rows[0]) return "";
  return Number(rows[0].thread_type) === ConversationType.Group ? `nhóm «${rows[0].name}»` : "tin riêng";
}

/** Báo những người xử lý (trừ người đang làm thao tác). Ảnh gửi sau chữ, đợi 30 giây cho ảnh kịp tải về kho. */
async function notifyHandlers(deps: TicketDeps, ticket: TicketRow, text: string, tag: string, options: { exceptContactId?: number | null; attachmentIds?: number[]; onlyContactId?: number | null } = {}) {
  const handlers = (await listTicketHandlers(deps.db)).filter((handler) =>
    handler.contactId !== options.exceptContactId && (!options.onlyContactId || handler.contactId === options.onlyContactId));
  for (const handler of handlers) {
    await enqueueMessage(deps, { zaloUid: handler.zaloUid, name: handler.name, text }, `ticket:${ticket.id}:${tag}:${handler.contactId}`);
    if (options.attachmentIds?.length) {
      await enqueueMessage(deps, { zaloUid: handler.zaloUid, name: handler.name, attachmentIds: options.attachmentIds },
        `ticket:${ticket.id}:${tag}:files:${handler.contactId}`, 30_000);
    }
  }
  return handlers.length;
}

/** Báo người gửi ở đúng chỗ họ đã báo (tin riêng → tin riêng; nhóm → nhóm, gọi tên). */
async function notifyRequester(deps: TicketDeps, ticket: TicketRow, text: string, tag: string): Promise<void> {
  if (ticket.source_thread_id) {
    const [rows] = await deps.db.query<RowDataPacket[]>("SELECT thread_type FROM zalo_group WHERE id = ?", [ticket.source_thread_id]);
    const inGroup = Number(rows[0]?.thread_type) === ConversationType.Group;
    await enqueueMessage(deps, { threadId: ticket.source_thread_id, text: inGroup ? `${ticket.requester_name} ơi, ${text}` : text },
      `ticket:${ticket.id}:${tag}:requester`);
    return;
  }
  await enqueueMessage(deps, { zaloUid: ticket.requester_uid, name: ticket.requester_name, text }, `ticket:${ticket.id}:${tag}:requester`);
}

function splitTitle(text: string): { title: string; body: string } {
  const clean = text.trim();
  const firstLine = clean.split(/\r?\n/)[0].trim();
  const title = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : firstLine;
  return { title: title || "(không tiêu đề)", body: clean };
}

export interface CreateTicketInput {
  requesterContactId: number | null;
  requesterUid: string;
  requesterName: string;
  sourceThreadId: number | null;
  sourceMessageId: number | null;
  botAccountId: number | null;
  text: string;
  now?: Date;
}

export interface CreateTicketResult {
  ticket: TicketRow;
  attachmentCount: number;
  handlerCount: number;
}

export async function createTicket(deps: TicketDeps, input: CreateTicketInput): Promise<CreateTicketResult> {
  const now = input.now ?? new Date();
  const { title, body } = splitTitle(input.text);
  const [result] = await deps.db.query<ResultSetHeader>(
    `INSERT INTO ticket (code, title, body, requester_contact_id, requester_uid, requester_name, source_thread_id, source_message_id, bot_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`~${crypto.randomBytes(8).toString("hex")}`, title, body, input.requesterContactId, input.requesterUid,
      input.requesterName.slice(0, 255), input.sourceThreadId, input.sourceMessageId, input.botAccountId]);
  const id = result.insertId;
  await deps.db.query("UPDATE ticket SET code = ? WHERE id = ?", [formatTicketCode(id), id]);
  const requester: TicketActor = { name: input.requesterName, contactId: input.requesterContactId, via: "zalo" };
  await recordEvent(deps.db, id, TicketEventKind.Created, requester);
  const attachmentIds = await attachRecentFiles(deps, id, input.sourceThreadId, input.requesterUid, input.sourceMessageId, now);
  const ticket = (await findTicket(deps.db, id))!;
  const where = await threadLabel(deps.db, input.sourceThreadId);
  const text = [
    `TICKET MỚI ${ticket.code}`,
    `Người báo: ${ticket.requester_name}${where ? ` (${where})` : ""}`,
    `Nội dung: ${body.slice(0, 1500)}`,
    ...(attachmentIds.length ? [`Ảnh / tệp kèm: ${attachmentIds.length} (gửi ngay sau tin này)`] : []),
    `Nhắn «nhận ${shortCode(ticket)}» để nhận xử lý, «xong ${shortCode(ticket)} <ghi chú>» khi xong.`,
  ].join("\n");
  const handlerCount = await notifyHandlers(deps, ticket, text, "new", { attachmentIds });
  return { ticket, attachmentCount: attachmentIds.length, handlerCount };
}

export class TicketActionError extends Error {}

export async function acceptTicket(deps: TicketDeps, ticket: TicketRow, actor: TicketActor): Promise<TicketRow> {
  if (!isOpen(ticket.status)) throw new TicketActionError(`${ticket.code} ${TICKET_STATUS_LABELS[ticket.status]} — không nhận được nữa.`);
  if (ticket.status === TicketStatus.InProgress && ticket.handler_contact_id && ticket.handler_contact_id === actor.contactId) {
    throw new TicketActionError(`Anh/chị đã nhận ${ticket.code} rồi.`);
  }
  await deps.db.query("UPDATE ticket SET status = ?, handler_contact_id = ?, handler_name = ?, accepted_at = COALESCE(accepted_at, NOW(3)) WHERE id = ?",
    [TicketStatus.InProgress, actor.contactId, actor.name.slice(0, 255), ticket.id]);
  await recordEvent(deps.db, ticket.id, TicketEventKind.Accepted, actor);
  await notifyRequester(deps, ticket, `ticket ${ticket.code} «${ticket.title}» đã được ${actor.name} nhận, đang xử lý.`, `accept:${Date.now()}`);
  await notifyHandlers(deps, ticket, `${ticket.code} «${ticket.title}» đã được ${actor.name} nhận.`, `accepted:${Date.now()}`, { exceptContactId: actor.contactId });
  return (await findTicket(deps.db, ticket.id))!;
}

/**
 * Đóng ticket (xong). Người xử lý / web đóng → báo người gửi. Người gửi tự báo xong (`byRequester`, vd lỗi tự hết) →
 * báo người đang xử lý (chưa ai nhận thì mọi người xử lý), không báo lại chính người gửi.
 */
export async function finishTicket(deps: TicketDeps, ticket: TicketRow, actor: TicketActor, note: string, byRequester = false): Promise<TicketRow> {
  if (!isOpen(ticket.status)) throw new TicketActionError(`${ticket.code} ${TICKET_STATUS_LABELS[ticket.status]} rồi.`);
  await deps.db.query(
    `UPDATE ticket SET status = ?, resolution = ?, closed_at = NOW(3),
       handler_contact_id = COALESCE(handler_contact_id, ?), handler_name = IF(handler_name = '', ?, handler_name),
       accepted_at = COALESCE(accepted_at, NOW(3)) WHERE id = ?`,
    [TicketStatus.Done, note || (byRequester ? "Người gửi báo đã xong" : null), byRequester ? null : actor.contactId,
      byRequester ? "" : actor.name.slice(0, 255), ticket.id]);
  await recordEvent(deps.db, ticket.id, TicketEventKind.Done, actor, note);
  if (byRequester) {
    await notifyHandlers(deps, ticket, `${ticket.code} «${ticket.title}» đã được người gửi (${actor.name}) báo xong${note ? `: ${note}` : "."}`,
      `done:${Date.now()}`, { onlyContactId: ticket.handler_contact_id });
    return (await findTicket(deps.db, ticket.id))!;
  }
  await notifyRequester(deps, ticket, [
    `ticket ${ticket.code} «${ticket.title}» đã xử lý xong (${actor.name}).`,
    ...(note ? [`Ghi chú: ${note}`] : []),
    `Còn vấn đề thì nhắn «${shortCode(ticket)}: <nội dung>» để mở lại.`,
  ].join("\n"), `done:${Date.now()}`);
  return (await findTicket(deps.db, ticket.id))!;
}

export async function cancelTicket(deps: TicketDeps, ticket: TicketRow, actor: TicketActor, note: string, byRequester: boolean): Promise<TicketRow> {
  if (!isOpen(ticket.status)) throw new TicketActionError(`${ticket.code} ${TICKET_STATUS_LABELS[ticket.status]} rồi.`);
  await deps.db.query("UPDATE ticket SET status = ?, closed_at = NOW(3), resolution = COALESCE(?, resolution) WHERE id = ?",
    [TicketStatus.Cancelled, note || null, ticket.id]);
  await recordEvent(deps.db, ticket.id, TicketEventKind.Cancelled, actor, note);
  const text = `${ticket.code} «${ticket.title}» đã bị hủy bởi ${actor.name}${note ? `: ${note}` : "."}`;
  if (byRequester) await notifyHandlers(deps, ticket, text, `cancel:${Date.now()}`, { onlyContactId: ticket.handler_contact_id });
  else await notifyRequester(deps, ticket, `ticket ${text}`, `cancel:${Date.now()}`);
  return (await findTicket(deps.db, ticket.id))!;
}

export async function reopenTicket(deps: TicketDeps, ticket: TicketRow, actor: TicketActor, note: string): Promise<TicketRow> {
  if (isOpen(ticket.status)) throw new TicketActionError(`${ticket.code} đang mở.`);
  const status = ticket.handler_contact_id || ticket.handler_name ? TicketStatus.InProgress : TicketStatus.New;
  await deps.db.query("UPDATE ticket SET status = ?, closed_at = NULL WHERE id = ?", [status, ticket.id]);
  await recordEvent(deps.db, ticket.id, TicketEventKind.Reopened, actor, note);
  return (await findTicket(deps.db, ticket.id))!;
}

/**
 * Bổ sung nội dung. Người gửi bổ sung → báo người đang xử lý (chưa ai nhận thì mọi người xử lý); ticket đã xong / hủy thì
 * MỞ LẠI. Người xử lý / web bổ sung → báo người gửi.
 */
export async function addTicketNote(deps: TicketDeps, ticket: TicketRow, actor: TicketActor, note: string,
  options: { fromRequester: boolean; threadId?: number | null; messageId?: number | null; now?: Date }): Promise<{ ticket: TicketRow; reopened: boolean; attachmentCount: number }> {
  let current = ticket;
  let reopened = false;
  if (options.fromRequester && !isOpen(ticket.status)) {
    current = await reopenTicket(deps, ticket, actor, "người gửi bổ sung");
    reopened = true;
  }
  await recordEvent(deps.db, ticket.id, TicketEventKind.Note, actor, note);
  const attachmentIds = options.fromRequester
    ? await attachRecentFiles(deps, ticket.id, options.threadId ?? null, ticket.requester_uid, options.messageId ?? null, options.now ?? new Date())
    : [];
  const tag = `note:${Date.now()}`;
  if (options.fromRequester) {
    const text = [`${ticket.code} «${ticket.title}»${reopened ? " được MỞ LẠI" : ""} — ${actor.name} bổ sung: ${note}`,
      ...(attachmentIds.length ? [`Kèm ${attachmentIds.length} ảnh / tệp.`] : [])].join("\n");
    await notifyHandlers(deps, current, text, tag, { onlyContactId: current.handler_contact_id, attachmentIds });
  } else {
    await notifyRequester(deps, current, `ticket ${ticket.code}: ${actor.name} nhắn — ${note}`, tag);
  }
  return { ticket: current, reopened, attachmentCount: attachmentIds.length };
}

/** Ticket của một người gửi (mới nhất trước). */
export async function listRequesterTickets(db: Db, requesterUid: string, limit = 10): Promise<TicketRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TICKET_COLUMNS} FROM ticket WHERE tenant_id = 1 AND requester_uid = ? ORDER BY id DESC LIMIT ?`, [requesterUid, limit]);
  return rows.map(toTicket);
}

/** Ticket đang mở (cho người xử lý): mới trước, rồi đang xử lý. */
export async function listOpenTickets(db: Db, limit = 20): Promise<TicketRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TICKET_COLUMNS} FROM ticket WHERE tenant_id = 1 AND status IN (?, ?) ORDER BY status, id LIMIT ?`,
    [TicketStatus.New, TicketStatus.InProgress, limit]);
  return rows.map(toTicket);
}

const VN_TIME = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false });

/** Một dòng tóm tắt ticket cho tin Zalo. */
export function describeTicketLine(ticket: TicketRow): string {
  const who = ticket.status === TicketStatus.InProgress && ticket.handler_name ? ` — ${ticket.handler_name}` : "";
  return `${ticket.code} [${TICKET_STATUS_LABELS[ticket.status]}${who}] ${ticket.title} (${VN_TIME.format(new Date(ticket.created_at))})`;
}

/** Chi tiết một ticket cho tin Zalo. */
export function describeTicket(ticket: TicketRow): string {
  return [
    `${ticket.code}: ${ticket.title}`,
    `Trạng thái: ${TICKET_STATUS_LABELS[ticket.status]}${ticket.handler_name ? ` — người xử lý: ${ticket.handler_name}` : ""}`,
    `Người báo: ${ticket.requester_name}, lúc ${VN_TIME.format(new Date(ticket.created_at))}`,
    ...(ticket.resolution ? [`Ghi chú xử lý: ${ticket.resolution}`] : []),
  ].join("\n");
}
