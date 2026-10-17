import type http from "node:http";
import type { McpAccessLevel } from "../constants.js";
import type { Db } from "../db/pool.js";
import { touchMcpKeyLastUsed, verifyMcpKey } from "../auth/mcp-api-key-store.js";
import type { Principal } from "../auth/principal.js";
import { createLogger, describeError } from "../logger.js";
import { FailureWindow } from "./mcp-rate-limiter.js";

const log = createLogger("mcp");

// Xác thực Bearer của cổng /mcp: tách tiêu đề, kiểm khóa ở kho khóa (nạp luôn principal của chủ khóa), chặn IP dò khóa.
// Khóa thô KHÔNG bao giờ đi vào log / thông báo lỗi.

/** Kết quả xác thực — được nhét vào `authInfo.extra.access` rồi factory dựng ngữ cảnh từ đó. */
export interface McpAccess {
  principal: Principal;
  keyId: number;
  level: McpAccessLevel;
  clientIp: string;
  /** Xem `VerifiedMcpKey.ownDirectUid`. */
  ownDirectUid: string | null;
}

export type AuthOutcome = { ok: true; access: McpAccess } | { ok: false; status: 401 | 429; message: string };

/** `Authorization: Bearer <khóa>` → khóa; thiếu / sai khuôn / khoảng trắng thừa → null. Phân biệt hoa thường của «Bearer» theo RFC 6750 là không. */
export function parseBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export interface BearerAuthDeps {
  db: Db;
  failures: FailureWindow;
}

export async function authenticateMcpRequest(deps: BearerAuthDeps, request: http.IncomingMessage, clientIp: string): Promise<AuthOutcome> {
  if (deps.failures.isBlocked(clientIp)) return { ok: false, status: 429, message: "Quá nhiều lần sai khóa — thử lại sau ít phút." };
  const token = parseBearerToken(request.headers.authorization);
  const verified = token ? await verifyMcpKey(deps.db, token) : null;
  if (!verified) {
    deps.failures.recordFailure(clientIp);
    return { ok: false, status: 401, message: "Thiếu hoặc sai khóa MCP (khóa hết hạn, đã thu hồi, hoặc tài khoản bị tắt)." };
  }
  // Không chờ ghi «dùng lần cuối» (hàm tự nuốt + log lỗi; .catch chỉ là lưới đỡ cuối)
  touchMcpKeyLastUsed(deps.db, verified.key.id, clientIp).catch((error) => log.warn(`ghi last_used_at: ${describeError(error)}`));
  return { ok: true, access: { principal: verified.principal, keyId: verified.key.id, level: verified.key.accessLevel, clientIp, ownDirectUid: verified.ownDirectUid } };
}
