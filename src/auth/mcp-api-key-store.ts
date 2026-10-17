import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { McpAccessLevel, UserRole } from "../constants.js";
import type { Db } from "../db/pool.js";
import { generateMcpKey, parseMcpKey } from "./mcp-api-key-format.js";
import { loadUserPrincipal, type Principal } from "./principal.js";

// Kho khóa MCP (bảng mcp_api_key). Chỉ lưu băm SHA-256; khóa thô trả đúng MỘT lần lúc tạo. Quyền khi gọi = quyền HIỆN TẠI của
// chủ khóa (principal nạp lại mỗi lời gọi, đổi vai trò / phạm vi không cần thu hồi khóa); khóa chỉ hạ được mức, không nâng.

export const MAX_ACTIVE_KEYS_PER_USER = 10;
export const MAX_KEY_DAYS = 3650;
const TOUCH_INTERVAL_SECONDS = 60;
const PREFIX_RETRIES = 3;

export interface McpKeyInfo {
  id: number;
  userId: number;
  name: string;
  prefix: string;
  accessLevel: McpAccessLevel;
  includeConfidential: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface VerifiedMcpKey {
  /** Chủ khóa; `canViewConfidential` đã nhân với cờ của khóa (cả hai cùng bật mới nhận nhóm Mật). */
  principal: Principal;
  key: Pick<McpKeyInfo, "id" | "accessLevel" | "includeConfidential">;
  /** Uid Zalo của danh bạ gắn với chủ khóa (`app_user.contact_id`) — cuộc nhắn riêng DUY NHẤT khóa này được đọc; null = không có, và luôn null khi khóa không có cờ «đọc nhóm Mật». */
  ownDirectUid: string | null;
}

/** Mức tối đa một vai trò được cấp cho khóa: chỉ Quản trị / Quản lý được đọc + ghi. */
export function maxAccessLevelForRole(role: UserRole): McpAccessLevel {
  return role === UserRole.Admin || role === UserRole.Manager ? McpAccessLevel.ReadWrite : McpAccessLevel.Read;
}

const toDate = (value: unknown): Date | null => (value ? new Date(value as string) : null);

function toKeyInfo(row: RowDataPacket): McpKeyInfo {
  return {
    id: Number(row.id), userId: Number(row.user_id), name: String(row.name), prefix: String(row.prefix),
    accessLevel: Number(row.access_level) as McpAccessLevel, includeConfidential: Boolean(row.include_confidential),
    expiresAt: toDate(row.expires_at), lastUsedAt: toDate(row.last_used_at), revokedAt: toDate(row.revoked_at),
    createdAt: new Date(row.created_at as string),
  };
}

const KEY_COLUMNS = "id, user_id, name, prefix, access_level, include_confidential, expires_at, last_used_at, revoked_at, created_at";

export interface CreateMcpKeyInput {
  userId: number;
  name: string;
  accessLevel: McpAccessLevel;
  /** Số ngày hiệu lực; null = không hết hạn. */
  days: number | null;
  includeConfidential: boolean;
}

/** Lỗi nghiệp vụ khi tạo khóa (tên / hạn / mức quyền / đủ số khóa…) — nơi gọi (API) đổi thành 422; Error khác là lỗi hệ thống (500). */
export class McpKeyValidationError extends Error {
  readonly code = "mcp_key_validation";
  constructor(message: string) {
    super(message);
    this.name = "McpKeyValidationError";
  }
}

/** Tạo khóa. Trả khóa thô MỘT lần. Ném McpKeyValidationError tiếng Việt khi sai đầu vào / quá trần / vượt vai trò. */
export async function createMcpKey(db: Db, input: CreateMcpKeyInput): Promise<{ id: number; token: string; prefix: string }> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new McpKeyValidationError("Tên khóa phải từ 1 đến 100 ký tự");
  if (input.days !== null && (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_KEY_DAYS)) {
    throw new McpKeyValidationError(`Số ngày hiệu lực phải là số nguyên từ 1 đến ${MAX_KEY_DAYS}`);
  }
  if (input.accessLevel !== McpAccessLevel.Read && input.accessLevel !== McpAccessLevel.ReadWrite) throw new McpKeyValidationError("Mức quyền khóa không hợp lệ");
  const owner = await loadUserPrincipal(db, input.userId);
  if (!owner) throw new McpKeyValidationError("Người dùng không tồn tại hoặc đã bị tắt");
  if (input.accessLevel > maxAccessLevelForRole(owner.role)) throw new McpKeyValidationError("Vai trò của người này chỉ được tạo khóa chỉ đọc");
  const [active] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM mcp_api_key WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW(3))", [input.userId]);
  if (Number(active[0]?.total) >= MAX_ACTIVE_KEYS_PER_USER) throw new McpKeyValidationError(`Đã đủ ${MAX_ACTIVE_KEYS_PER_USER} khóa đang dùng — thu hồi bớt rồi tạo lại`);

  for (let attempt = 0; attempt < PREFIX_RETRIES; attempt++) {
    const generated = generateMcpKey();
    try {
      const [result] = await db.query<ResultSetHeader>(
        `INSERT INTO mcp_api_key (tenant_id, user_id, name, prefix, token_hash, access_level, include_confidential, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW(3) + INTERVAL ? DAY))`,
        [owner.tenantId, input.userId, name, generated.prefix, generated.tokenHash, input.accessLevel, input.includeConfidential ? 1 : 0, input.days, input.days]);
      return { id: result.insertId, token: generated.token, prefix: generated.prefix };
    } catch (error) {
      // Trùng tiền tố (1 / 62^8) → sinh lại; lỗi khác ném tiếp
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    }
  }
  throw new McpKeyValidationError("Không sinh được khóa duy nhất, thử lại");
}

/** Khóa thô → chủ khóa + thông tin khóa; sai định dạng / không có / thu hồi / hết hạn / chủ bị tắt → null. */
export async function verifyMcpKey(db: Db, token: string): Promise<VerifiedMcpKey | null> {
  const parsed = parseMcpKey(token);
  if (!parsed) return null;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${KEY_COLUMNS} FROM mcp_api_key
     WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW(3))`, [parsed.tokenHash]);
  if (!rows[0]) return null;
  const key = toKeyInfo(rows[0]);
  const owner = await loadUserPrincipal(db, key.userId);
  if (!owner) return null;
  const principal: Principal = { ...owner, canViewConfidential: owner.canViewConfidential === true && key.includeConfidential };
  const [contactRows] = await db.query<RowDataPacket[]>(
    "SELECT c.zalo_uid FROM app_user u JOIN contact c ON c.id = u.contact_id WHERE u.id = ?", [key.userId]);
  // Quyết định chủ 17/10/2026: khóa KHÔNG có «đọc nhóm Mật» thì ẩn cả cuộc nhắn riêng của chủ khóa — câu bot trả lời trong đó có thể
  // chứa nội dung nhóm Mật; chỉ khóa có cờ Mật mới đọc được cuộc riêng này.
  const ownDirectUid = key.includeConfidential && contactRows[0]?.zalo_uid ? String(contactRows[0].zalo_uid) : null;
  return { principal, key: { id: key.id, accessLevel: key.accessLevel, includeConfidential: key.includeConfidential }, ownDirectUid };
}

/** Danh sách khóa (không bao giờ trả băm). `userId` bỏ trống = mọi người (dành cho quản trị). Khóa còn hiệu lực lên trước. */
export async function listMcpKeys(db: Db, userId?: number): Promise<(McpKeyInfo & { ownerName: string })[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT k.id, k.user_id, k.name, k.prefix, k.access_level, k.include_confidential, k.expires_at, k.last_used_at,
            k.revoked_at, k.created_at, COALESCE(NULLIF(u.full_name, ''), u.username, u.email) AS owner_name
     FROM mcp_api_key k JOIN app_user u ON u.id = k.user_id
     ${userId === undefined ? "" : "WHERE k.user_id = ?"}
     ORDER BY k.revoked_at IS NOT NULL, k.id DESC`, userId === undefined ? [] : [userId]);
  return rows.map((row) => ({ ...toKeyInfo(row), ownerName: String(row.owner_name ?? "") }));
}

/** Thu hồi một khóa (idempotent). `onlyUserId` != undefined = chỉ thu hồi được khóa CỦA người đó. Trả true nếu vừa thu hồi. */
export async function revokeMcpKey(db: Db, keyId: number, revokedBy: string, onlyUserId?: number): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE mcp_api_key SET revoked_at = NOW(3), revoked_by = ? WHERE id = ? AND revoked_at IS NULL${onlyUserId === undefined ? "" : " AND user_id = ?"}`,
    onlyUserId === undefined ? [revokedBy.slice(0, 100), keyId] : [revokedBy.slice(0, 100), keyId, onlyUserId]);
  return result.affectedRows > 0;
}

/** Ghi «dùng lần cuối» nhưng chỉ khi lần trước cách > 60 giây (đỡ ghi mỗi lời gọi). Lỗi ghi chỉ log, không làm hỏng lời gọi. */
export async function touchMcpKeyLastUsed(db: Db, keyId: number, clientIp: string | null): Promise<void> {
  try {
    await db.query(
      `UPDATE mcp_api_key SET last_used_at = NOW(3), last_used_ip = ?
       WHERE id = ? AND (last_used_at IS NULL OR last_used_at < NOW(3) - INTERVAL ${TOUCH_INTERVAL_SECONDS} SECOND)`,
      [clientIp ? clientIp.slice(0, 64) : null, keyId]);
  } catch (error) {
    console.error("Không ghi được last_used_at của khóa MCP:", error instanceof Error ? error.message : error);
  }
}
