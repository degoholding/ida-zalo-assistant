import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../../constants.js";
import { findTask, type TaskRow } from "../../tasks/task-repository.js";
import { findTicket, type TicketRow } from "../../tickets/ticket-service.js";
import { assertContactVisible } from "../../web/api/scope.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { groupVisibilitySql, sourceThreadVisibilitySql } from "../visibility-guards.js";

// «Đích ghi này người gọi thấy được không» — dùng đúng chốt chặn của đường ĐỌC (phạm vi nhóm + Mật), ngoài phạm vi = `not_found`.

const notFound = (what: string) => new DataAccessError("not_found", `Không tìm thấy ${what}.`);

async function visible(ctx: DataAccessContext, table: "task" | "ticket", id: number): Promise<boolean> {
  const part = sourceThreadVisibilitySql(ctx, "t.source_thread_id", "g");
  const [rows] = await ctx.db.query<RowDataPacket[]>(
    `SELECT 1 FROM ${table} t LEFT JOIN zalo_group g ON g.id = t.source_thread_id WHERE t.id = ? AND t.tenant_id = ?${part ? ` AND ${part.sql}` : ""} LIMIT 1`,
    [id, ctx.principal.tenantId, ...(part?.params ?? [])]);
  return Boolean(rows[0]);
}

export async function loadVisibleTask(ctx: DataAccessContext, id: number): Promise<TaskRow> {
  const task = (await visible(ctx, "task", id)) ? await findTask(ctx.db, id, ctx.principal.tenantId) : null;
  if (!task) throw notFound("việc này");
  return task;
}

export async function loadVisibleTicket(ctx: DataAccessContext, id: number): Promise<TicketRow> {
  const ticket = (await visible(ctx, "ticket", id)) ? await findTicket(ctx.db, id, ctx.principal.tenantId) : null;
  if (!ticket) throw notFound("ticket này");
  return ticket;
}

/** Người trong Danh bạ phải ở một nhóm trong phạm vi (luật web). */
export async function assertContactTarget(ctx: DataAccessContext, id: number): Promise<void> {
  try {
    await assertContactVisible(ctx.db, ctx.principal, { id });
  } catch {
    throw notFound("người này trong Danh bạ");
  }
}

export interface VisibleGroupRow {
  id: number;
  name: string;
  label: string;
  company_id: number | null;
}

/** Nhóm Zalo (không phải cuộc riêng) trong phạm vi, nhóm Mật chỉ khi ctx được Mật. */
export async function loadVisibleGroup(ctx: DataAccessContext, id: number): Promise<VisibleGroupRow> {
  const part = groupVisibilitySql(ctx, "g.id", "g.is_confidential");
  const [rows] = await ctx.db.query<RowDataPacket[]>(
    `SELECT g.id, g.name, COALESCE(g.label, '') AS label, g.company_id FROM zalo_group g WHERE g.id = ? AND g.thread_type = ? AND ${part.sql} LIMIT 1`,
    [id, ConversationType.Group, ...part.params]);
  const row = rows[0];
  if (!row) throw notFound("nhóm này");
  return { id: Number(row.id), name: String(row.name ?? ""), label: String(row.label), company_id: row.company_id === null ? null : Number(row.company_id) };
}
