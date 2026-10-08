import type { RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType, TicketStatus } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import {
  acceptTicket, addTicketNote, cancelTicket, findTicket, finishTicket, reopenTicket, TicketActionError, type TicketActor,
} from "../../tickets/ticket-service.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import { buildContentDisposition, describeFileDownload } from "./file-download.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// Màn Ticket (08/10/2026): danh sách + chi tiết ticket báo qua bot, thao tác nhận / xong / hủy / mở lại / nhắn người gửi
// (gọi chung src/tickets/ticket-service.ts — bot báo người gửi y như làm trên Zalo), và danh sách người xử lý.

const NOTE_MAX = 2000;

export const TICKET_LIST_SPEC: ListSpec = {
  fields: {
    status: { sql: "t.status", type: "number" },
    requester_name: { sql: "t.requester_name", type: "text" },
    handler_name: { sql: "t.handler_name", type: "text" },
    created_at: { sql: "t.created_at", type: "date" },
  },
  sorts: { created_at: "t.created_at", status: "t.status", code: "t.id", updated_at: "t.updated_at" },
  defaultSort: { by: "created_at", dir: "desc" },
  tieBreaker: "t.id",
  search: { param: "q", columns: ["t.code", "t.title", "t.requester_name", "t.handler_name"] },
};

const TICKET_FROM = "FROM ticket t LEFT JOIN zalo_group g ON g.id = t.source_thread_id";
const TICKET_COLUMNS = `t.id, t.code, t.status, t.title, COALESCE(t.body, '') AS body, t.requester_uid, t.requester_name,
  t.requester_contact_id, t.handler_contact_id, t.handler_name, COALESCE(t.resolution, '') AS resolution, t.source_thread_id,
  g.thread_type AS source_thread_type, COALESCE(NULLIF(g.label, ''), g.name) AS source_thread_name,
  t.created_at, t.updated_at, t.accepted_at, t.closed_at,
  (SELECT COUNT(*) FROM ticket_attachment ta WHERE ta.ticket_id = t.id) AS attachment_count`;

function decorate(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const inGroup = Number(row.source_thread_type) === ConversationType.Group;
    return {
      ...row, status: Number(row.status), attachment_count: Number(row.attachment_count),
      source_kind: row.source_thread_id ? (inGroup ? "group" : "direct") : "",
      source_name: row.source_thread_id ? (inGroup ? String(row.source_thread_name ?? "") : "Tin riêng") : "",
    };
  });
}

export async function getTicketDetail(db: Db, id: number, tenantId: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${TICKET_COLUMNS} ${TICKET_FROM} WHERE t.id = ? AND t.tenant_id = ?`, [id, tenantId]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có ticket này");
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT a.id, a.file_name, a.file_ext, a.status, a.stored_bytes, m.kind AS message_kind
     FROM ticket_attachment ta JOIN attachment a ON a.id = ta.attachment_id LEFT JOIN message m ON m.id = a.message_id
     WHERE ta.ticket_id = ? ORDER BY a.id`, [id]);
  const [events] = await db.query<RowDataPacket[]>(
    "SELECT id, kind, actor_name, via, COALESCE(note, '') AS note, created_at FROM ticket_event WHERE ticket_id = ? ORDER BY id", [id]);
  return {
    ...decorate(rows)[0],
    attachments: files.map((file) => {
      const stored = Number(file.status) === AttachmentStatus.Stored;
      const { fileName, imageType } = describeFileDownload({
        id: Number(file.id), fileName: file.file_name as string | null, fileExt: file.file_ext as string | null,
        messageKind: file.message_kind as number | null, storageKey: "",
      });
      return {
        id: Number(file.id), file_name: fileName, is_image: Boolean(imageType), status: Number(file.status),
        bytes: file.stored_bytes === null ? null : Number(file.stored_bytes),
        // Tải qua đường của ticket (không qua phạm vi nhóm của màn Tệp — ảnh tin riêng vẫn xem được)
        download_url: stored ? `/api/tickets/${id}/files/${Number(file.id)}` : null,
      };
    }),
    events: events.map((event) => ({ ...event, kind: Number(event.kind) })),
  };
}

const ACTIONS = new Set(["accept", "done", "cancel", "reopen", "note"]);

export const ticketRoutes: ApiRoute[] = [
  ["GET", /^\/api\/tickets$/, async ({ response, url, service, principal }) => sendOk(response, await runList(service.db, url.searchParams, TICKET_LIST_SPEC, {
    select: TICKET_COLUMNS, from: TICKET_FROM, baseWhere: { sql: "t.tenant_id = ?", params: [principal.tenantId] }, decorate,
  }))],
  ["GET", /^\/api\/tickets\/(\d+)$/, async ({ response, match, service, principal }) =>
    sendOk(response, await getTicketDetail(service.db, parseId(match[1]), principal.tenantId))],
  ["GET", /^\/api\/tickets\/(\d+)\/files\/(\d+)$/, async ({ response, match, url, service, principal }) => {
    const ticketId = parseId(match[1]);
    const attachmentId = parseId(match[2]);
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT a.storage_key, a.file_name, a.file_ext, m.kind AS message_kind
       FROM ticket t JOIN ticket_attachment ta ON ta.ticket_id = t.id JOIN attachment a ON a.id = ta.attachment_id
       LEFT JOIN message m ON m.id = a.message_id
       WHERE t.id = ? AND t.tenant_id = ? AND a.id = ? AND a.status = ?`, [ticketId, principal.tenantId, attachmentId, AttachmentStatus.Stored]);
    const row = rows[0];
    const key = row?.storage_key as string | undefined;
    if (!row || !key) throw new ApiError(404, "not_found", "Tệp chưa có trong kho");
    const stream = await service.storage.read(key);
    const { fileName, imageType } = describeFileDownload({
      id: attachmentId, fileName: row.file_name as string | null, fileExt: row.file_ext as string | null, messageKind: row.message_kind as number | null, storageKey: key,
    });
    const inline = url.searchParams.get("inline") === "1" && Boolean(imageType);
    response.writeHead(200, {
      "Content-Type": imageType ?? "application/octet-stream",
      "Cache-Control": inline ? "private, max-age=3600" : "no-store",
      "Content-Disposition": buildContentDisposition(fileName, inline),
    });
    stream.pipe(response);
  }],
  // Thao tác trên web: { action: accept | done | cancel | reopen | note, note? } — bot báo người gửi / người xử lý như trên Zalo
  ["POST", /^\/api\/tickets\/(\d+)\/actions$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    const body = await readJson(request);
    const action = String(body.action ?? "");
    if (!ACTIONS.has(action)) throw new ApiError(422, "validation_error", "Thao tác không hợp lệ");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > NOTE_MAX) throw new ApiError(422, "validation_error", `Ghi chú tối đa ${NOTE_MAX} ký tự`);
    if (action === "note" && !note) throw new ApiError(422, "validation_error", "Chưa có nội dung nhắn");
    const ticket = await findTicket(service.db, id, principal.tenantId);
    if (!ticket) throw new ApiError(404, "not_found", "Không có ticket này");
    const actor: TicketActor = { name: principal.fullName || principal.email || "Quản trị", contactId: null, via: "web" };
    const deps = service.tickets;
    try {
      if (action === "accept") await acceptTicket(deps, ticket, actor);
      else if (action === "done") await finishTicket(deps, ticket, actor, note);
      else if (action === "cancel") await cancelTicket(deps, ticket, actor, note, false);
      else if (action === "reopen") await reopenTicket(deps, ticket, actor, note);
      else await addTicketNote(deps, ticket, actor, note, { fromRequester: false });
    } catch (error) {
      if (error instanceof TicketActionError) throw new ApiError(409, "invalid_state", error.message);
      throw error;
    }
    const labels: Record<string, string> = { accept: "Nhận xử lý", done: "Báo xong", cancel: "Hủy", reopen: "Mở lại", note: "Nhắn người gửi" };
    await recordAudit(service.db, { entity: "ticket", entityId: id, action: "update", message: `${labels[action]} ${ticket.code}${note ? `: ${note.slice(0, 200)}` : ""}` });
    sendOk(response, await getTicketDetail(service.db, id, principal.tenantId), `${labels[action]} — đã báo qua Zalo`);
  }],

  // Người xử lý ticket: nhận tin báo ticket mới qua Zalo, gõ «nhận / xong T-12» được
  ["GET", /^\/api\/ticket-handlers$/, async ({ response, service, principal }) => {
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT c.id AS contact_id, c.zalo_uid, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name, c.avatar_url, h.created_at
       FROM ticket_handler h JOIN contact c ON c.id = h.contact_id WHERE h.tenant_id = ? ORDER BY name`, [principal.tenantId]);
    sendOk(response, rows.map((row) => ({ ...row, contact_id: Number(row.contact_id) })));
  }],
  ["POST", /^\/api\/ticket-handlers$/, async ({ request, response, service, principal }) => {
    const body = await readJson(request);
    const contactId = Number(body.contact_id);
    if (!Number.isSafeInteger(contactId) || contactId <= 0) throw new ApiError(422, "validation_error", "Chưa chọn người");
    const [contacts] = await service.db.query<RowDataPacket[]>("SELECT COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM contact WHERE id = ?", [contactId]);
    if (!contacts[0]) throw new ApiError(404, "not_found", "Không có người này trong Danh bạ");
    await service.db.query("INSERT IGNORE INTO ticket_handler (tenant_id, contact_id) VALUES (?, ?)", [principal.tenantId, contactId]);
    await recordAudit(service.db, { entity: "ticket", entityId: 0, action: "update", message: `Thêm người xử lý ticket «${contacts[0].name}»` });
    sendOk(response, { contact_id: contactId }, "Đã thêm người xử lý");
  }],
  ["DELETE", /^\/api\/ticket-handlers\/(\d+)$/, async ({ response, match, service, principal }) => {
    const contactId = parseId(match[1]);
    const [contacts] = await service.db.query<RowDataPacket[]>("SELECT COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM contact WHERE id = ?", [contactId]);
    await service.db.query("DELETE FROM ticket_handler WHERE tenant_id = ? AND contact_id = ?", [principal.tenantId, contactId]);
    await recordAudit(service.db, { entity: "ticket", entityId: 0, action: "update", message: `Bỏ người xử lý ticket «${contacts[0]?.name ?? contactId}»` });
    sendOk(response, { contact_id: contactId }, "Đã bỏ người xử lý");
  }],
];

/** Cho bài kiểm: trạng thái mở. */
export const OPEN_TICKET_STATUSES = [TicketStatus.New, TicketStatus.InProgress];
