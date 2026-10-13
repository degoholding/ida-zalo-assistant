import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { ReplyTemplateStatus, type ReplyTone } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { ReplyTemplate, ReplyTemplateInput } from "./reply-suggestion-types.js";

// Truy cập bảng reply_template (phase 10 — N2). Mọi câu UPDATE đổi trạng thái đều kèm điều kiện «trạng thái cũ» để hai người
// bấm cùng lúc không ghi đè nhau — nơi gọi kiểm `affectedRows`.

const COLUMNS = `id, tenant_id, name, situation, keywords, body, tone, status, author_user_id, author_name, reviewer_user_id,
  reviewer_name, review_note, submitted_at, reviewed_at, created_at, updated_at`;

export function splitKeywords(raw: string): string[] {
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function toTemplate(row: RowDataPacket): ReplyTemplate {
  return {
    id: Number(row.id), tenantId: Number(row.tenant_id), name: String(row.name), situation: String(row.situation ?? ""),
    keywords: splitKeywords(String(row.keywords ?? "")), body: String(row.body), tone: Number(row.tone) as ReplyTone,
    status: Number(row.status) as ReplyTemplateStatus,
    authorUserId: row.author_user_id === null ? null : Number(row.author_user_id), authorName: String(row.author_name ?? ""),
    reviewerUserId: row.reviewer_user_id === null ? null : Number(row.reviewer_user_id), reviewerName: String(row.reviewer_name ?? ""),
    reviewNote: String(row.review_note ?? ""), submittedAt: row.submitted_at ?? null, reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Mẫu ĐÃ DUYỆT của một tenant — nguồn DUY NHẤT bot được dùng. */
export async function listApprovedTemplates(db: Db, tenantId: number): Promise<ReplyTemplate[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM reply_template WHERE tenant_id = ? AND status = ? ORDER BY name`, [tenantId, ReplyTemplateStatus.Approved]);
  return rows.map(toTemplate);
}

export async function findTemplate(db: Db, tenantId: number, id: number): Promise<ReplyTemplate | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM reply_template WHERE tenant_id = ? AND id = ?`, [tenantId, id]);
  return rows.length ? toTemplate(rows[0]) : null;
}

export async function insertTemplate(
  db: Db, tenantId: number, input: ReplyTemplateInput, status: ReplyTemplateStatus, author: { userId: number | null; name: string },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO reply_template (tenant_id, name, situation, keywords, body, tone, status, author_user_id, author_name, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, input.name, input.situation, input.keywords.join(", "), input.body, input.tone, status, author.userId, author.name.slice(0, 150),
      status === ReplyTemplateStatus.PendingReview ? new Date() : null]);
  return result.insertId;
}

/** Sửa nội dung + đưa về trạng thái mới (xóa ghi chú trả lại, đặt lại mốc gửi duyệt). `expected` = trạng thái đọc lúc kiểm quyền. */
export async function updateTemplate(
  db: Db, tenantId: number, id: number, input: ReplyTemplateInput, expected: ReplyTemplateStatus, next: ReplyTemplateStatus,
): Promise<number> {
  // Giữ «Đã duyệt» (người duyệt tự sửa) thì không xóa dấu vết duyệt; ngược lại về chờ duyệt: xóa kết quả duyệt cũ
  const keepApproval = expected === ReplyTemplateStatus.Approved && next === ReplyTemplateStatus.Approved;
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE reply_template SET name = ?, situation = ?, keywords = ?, body = ?, tone = ?, status = ?
       ${keepApproval ? "" : ", review_note = '', reviewer_user_id = NULL, reviewer_name = '', reviewed_at = NULL, submitted_at = NOW(3)"}
     WHERE tenant_id = ? AND id = ? AND status = ?`,
    [input.name, input.situation, input.keywords.join(", "), input.body, input.tone, next, tenantId, id, expected]);
  return result.affectedRows;
}

export interface StatusPatch {
  reviewer?: { userId: number | null; name: string };
  reviewNote?: string;
  /** true = đặt mốc gửi duyệt = bây giờ (Nháp → Chờ duyệt). */
  submitted?: boolean;
}

/** Đổi trạng thái có điều kiện trạng thái cũ; trả `affectedRows` (0 = đã có người đổi trước). */
export async function setTemplateStatus(
  db: Db, tenantId: number, id: number, expected: ReplyTemplateStatus, next: ReplyTemplateStatus, patch: StatusPatch = {},
): Promise<number> {
  const sets = ["status = ?"];
  const params: unknown[] = [next];
  if (patch.submitted) sets.push("submitted_at = NOW(3)", "review_note = ''");
  if (patch.reviewer) {
    sets.push("reviewer_user_id = ?", "reviewer_name = ?", "reviewed_at = NOW(3)");
    params.push(patch.reviewer.userId, patch.reviewer.name.slice(0, 150));
  }
  if (patch.reviewNote !== undefined) {
    sets.push("review_note = ?");
    params.push(patch.reviewNote);
  }
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE reply_template SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ? AND status = ?`, [...params, tenantId, id, expected]);
  return result.affectedRows;
}
