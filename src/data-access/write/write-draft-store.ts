import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { McpCallSource } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { DataAccessError } from "../data-access-errors.js";

// Kho nháp ghi (bảng mcp_write_draft). Mã xác nhận 6 ký tự chỉ lưu BĂM; nháp gắn người dùng + khóa (hoặc nguồn trợ lý) + băm payload,
// sống 10 phút, dùng MỘT lần (UPDATE có điều kiện). Mọi ca «không tìm thấy» đều như nhau — không dò được mã của người khác.
// Băm của mã và payload là HMAC-SHA256 với khóa dẫn xuất từ SESSION_ENCRYPTION_KEY: lộ bảng nháp cũng không dò ngược được mã 6 ký tự
// (không gian 32^6 chỉ ~1e9, SHA-256 trần dò được trong vài phút) và không tự dựng lại được băm payload để sửa nháp.

export const DRAFT_TTL_MS = 10 * 60_000;
/** Nháp chưa dùng / chưa hết hạn tối đa mỗi (người, nguồn) — máy khách MCP chạy lung tung không chặn được nháp của trợ lý. */
export const MAX_OPEN_DRAFTS_PER_USER = 20;
/** Số nháp tạo trong 1 phút tối đa mỗi (người, khóa) — chặn AI spam đề xuất. */
export const MAX_PROPOSALS_PER_MINUTE = 10;
/** Nháp giống hệt đã «thử» (lỗi giữa chừng) trong khoảng này thì chặn đề xuất lại. */
const ATTEMPT_BLOCK_MS = 60 * 60_000;
/** Giá trị `result_json.status` của một nháp đã dùng. */
export enum DraftOutcome {
  /** Đã tiêu thụ, sắp chạy (nếu tiến trình chết giữa chừng thì dòng ở lại trạng thái này). */
  Attempted = "attempted",
  /** Thực hiện xong. */
  Done = "done",
  /** Bị từ chối TRƯỚC khi ghi gì (kiểm lại quyền / dữ liệu) — an toàn đề xuất lại. */
  Rejected = "rejected",
  /** Lỗi hệ thống sau khi đã bắt đầu — có thể đã ghi một phần. */
  Failed = "failed",
  /** Người dùng hủy. */
  Cancelled = "cancelled",
}
export const CODE_LENGTH = 6;
/** Bỏ 0 O 1 I L — chữ dễ nhầm khi đọc / chép. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateCode(randomInt: (max: number) => number = (max) => crypto.randomInt(max)): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/**
 * Khóa HMAC: dẫn xuất từ SESSION_ENCRYPTION_KEY. Thiếu biến (môi trường thử) thì dùng nhãn cố định — chỉ mất lớp chống dò ngược, các
 * ràng buộc khác (người, nguồn, hạn, dùng một lần) vẫn nguyên.
 */
function hmacKey(): Buffer {
  const secret = process.env.SESSION_ENCRYPTION_KEY ?? "";
  return crypto.createHmac("sha256", secret || "mcp-write-draft-no-secret").update("mcp-write-draft-v1").digest();
}
const hmacHex = (text: string): string => crypto.createHmac("sha256", hmacKey()).update(text).digest("hex");

/** Chuẩn hóa mã người gõ (chữ thường / có khoảng trắng) trước khi băm. */
export const normalizeCode = (code: string): string => code.replace(/[\s-]/g, "").toUpperCase();
export const hashCode = (code: string): string => hmacHex(`code:${normalizeCode(code)}`);

/** JSON có khóa sắp xếp — cùng nội dung cho cùng chuỗi, bất kể thứ tự khóa (MySQL JSON đổi thứ tự khóa khi lưu). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export const hashPayload = (payload: unknown): string => hmacHex(`payload:${canonicalJson(payload)}`);

/** Ràng buộc nháp: ai, qua đâu. */
export interface DraftBinding {
  tenantId: number;
  userId: number;
  keyId: number | null;
  source: McpCallSource;
}

export interface NewDraft extends DraftBinding {
  tool: string;
  targetEntity: string;
  targetId: number | null;
  /** Nội dung đã chuẩn hóa (đầu vào công cụ + dấu trạng thái đích) — băm để khóa. */
  payload: unknown;
  preview: string;
  now: Date;
}

export interface DraftRecord extends DraftBinding {
  id: number;
  tool: string;
  targetEntity: string;
  targetId: number | null;
  payload: unknown;
  payloadHash: string;
  preview: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Tạo nháp: kiểm trần theo người / khóa, sinh mã, lưu băm. Trả mã GỐC (chỉ lộ một lần, ở kết quả `propose_*`). */
export async function createDraft(db: Db, draft: NewDraft): Promise<{ id: number; code: string; expiresAt: Date }> {
  const minuteAgo = new Date(draft.now.getTime() - 60_000);
  const [recent] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM mcp_write_draft WHERE user_id = ? AND key_id <=> ? AND source = ? AND created_at > ?", [draft.userId, draft.keyId, draft.source, minuteAgo]);
  if (Number(recent[0]?.n ?? 0) >= MAX_PROPOSALS_PER_MINUTE) {
    throw new DataAccessError("rate_limited", `Đề xuất ghi quá nhanh (tối đa ${MAX_PROPOSALS_PER_MINUTE} lần / phút) — đợi một lát rồi thử lại.`);
  }
  const [open] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM mcp_write_draft WHERE user_id = ? AND source = ? AND used_at IS NULL AND expires_at > ?", [draft.userId, draft.source, draft.now]);
  if (Number(open[0]?.n ?? 0) >= MAX_OPEN_DRAFTS_PER_USER) {
    throw new DataAccessError("rate_limited", `Đang có ${MAX_OPEN_DRAFTS_PER_USER} nháp chờ xác nhận — xác nhận hoặc đợi hết hạn (10 phút) rồi đề xuất tiếp.`);
  }
  // M2: một nháp GIỐNG HỆT vừa được thực hiện mà lỗi giữa chừng (có thể đã ghi một phần / đã báo Zalo) thì không cho đề xuất lại ngay
  const payloadHash = hashPayload(draft.payload);
  const [attempted] = await db.query<RowDataPacket[]>(
    `SELECT id FROM mcp_write_draft WHERE user_id = ? AND payload_hash = ? AND used_at > ? AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.status')) IN (?, ?) LIMIT 1`,
    [draft.userId, payloadHash, new Date(draft.now.getTime() - ATTEMPT_BLOCK_MS), DraftOutcome.Attempted, DraftOutcome.Failed]);
  if (attempted[0]) {
    throw new DataAccessError("invalid_state", "Thao tác giống hệt vừa được thực hiện nhưng lỗi giữa chừng (có thể đã ghi một phần) — kiểm tra lại bản ghi trước, đừng đề xuất lại ngay kẻo bị trùng.");
  }
  const code = generateCode();
  const expiresAt = new Date(draft.now.getTime() + DRAFT_TTL_MS);
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO mcp_write_draft (tenant_id, user_id, key_id, source, tool, target_entity, target_id, payload_json, payload_hash, preview, code_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [draft.tenantId, draft.userId, draft.keyId, draft.source, draft.tool, draft.targetEntity, draft.targetId, canonicalJson(draft.payload), payloadHash,
      draft.preview.slice(0, 2000), hashCode(code), expiresAt, draft.now]);
  return { id: result.insertId, code, expiresAt };
}

const DRAFT_COLUMNS = "id, tool, target_entity, target_id, payload_json, payload_hash, preview, expires_at, created_at";

function toRecord(binding: DraftBinding, row: RowDataPacket): DraftRecord {
  return {
    ...binding, id: Number(row.id), tool: String(row.tool), targetEntity: String(row.target_entity), targetId: row.target_id === null ? null : Number(row.target_id),
    payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json, payloadHash: String(row.payload_hash),
    preview: String(row.preview), expiresAt: new Date(row.expires_at), createdAt: new Date(row.created_at),
  };
}

/** Nháp còn hiệu lực khớp mã + đúng người + đúng khóa / nguồn; không khớp (sai mã, quá hạn, đã dùng, khóa khác) đều trả null. */
export async function findOpenDraft(db: Db, binding: DraftBinding, code: string, now: Date): Promise<DraftRecord | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${DRAFT_COLUMNS} FROM mcp_write_draft
     WHERE code_hash = ? AND tenant_id = ? AND user_id = ? AND key_id <=> ? AND source = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1`,
    [hashCode(code), binding.tenantId, binding.userId, binding.keyId, binding.source, now]);
  return rows[0] ? toRecord(binding, rows[0]) : null;
}

/** Mọi nháp còn hiệu lực của (người, nguồn, khóa), mới nhất trước — trợ lý dùng để xử lý «đồng ý» / «hủy» ở tin sau. */
export async function listOpenDrafts(db: Db, binding: DraftBinding, now: Date): Promise<DraftRecord[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${DRAFT_COLUMNS} FROM mcp_write_draft
     WHERE tenant_id = ? AND user_id = ? AND key_id <=> ? AND source = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT ?`,
    [binding.tenantId, binding.userId, binding.keyId, binding.source, now, MAX_OPEN_DRAFTS_PER_USER]);
  return rows.map((row) => toRecord(binding, row));
}

/** Hủy một nháp chưa dùng (đánh dấu đã dùng + kết quả «cancelled»). true = vừa hủy. */
export async function cancelDraft(db: Db, id: number, now: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE mcp_write_draft SET used_at = ?, result_json = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?", [now, JSON.stringify({ status: DraftOutcome.Cancelled }), id, now]);
  return result.affectedRows === 1;
}

/** Tiêu thụ nguyên tử: đúng MỘT lời gọi thắng (affectedRows = 1) — hai lần xác nhận song song không chạy đôi. */
export async function claimDraft(db: Db, id: number, now: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("UPDATE mcp_write_draft SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?", [now, id, now]);
  return result.affectedRows === 1;
}

export async function saveDraftResult(db: Db, id: number, result: unknown): Promise<void> {
  await db.query("UPDATE mcp_write_draft SET result_json = ? WHERE id = ?", [JSON.stringify(result), id]);
}

/** Dọn nháp tạo quá `keepDays` ngày (đã dùng hay chưa) — gọi từ việc nền «retention». Xóa từng mẻ nhỏ. */
export async function purgeOldDrafts(db: Db, keepDays: number, now = new Date()): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("DELETE FROM mcp_write_draft WHERE created_at < ? LIMIT 5000", [new Date(now.getTime() - keepDays * 86_400_000)]);
  return result.affectedRows;
}
