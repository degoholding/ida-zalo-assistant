import crypto from "node:crypto";
import type http from "node:http";
import type { RowDataPacket } from "mysql2";
import { loadMcpKeyAccess } from "../auth/mcp-api-key-store.js";
import { AttachmentStatus, McpCallSource } from "../constants.js";
import { buildDataAccessContext } from "../data-access/data-access-context.js";
import { DataAccessError } from "../data-access/data-access-errors.js";
import { assertAttachmentReadable } from "../data-access/visibility-guards.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { FileStorage } from "../storage/file-storage.js";
import { pipeStreamToResponse } from "../web/pipe-stream-to-response.js";

// Link tải tệp gốc ký sẵn, hạn ngắn, cho công cụ MCP `get_file` khi tệp quá lớn để nhúng vào kết quả (27/10/2026).
// Link đi qua CHÍNH bot (không phải link R2 ký sẵn) nên không lộ khóa / tên bucket và chạy được cả khi tệp còn ở đĩa.
// Chữ ký HMAC (SESSION_ENCRYPTION_KEY) gói id tệp + id khóa MCP + hạn; lúc tải dựng LẠI quyền của khóa (còn sống, chủ còn được dùng
// MCP) rồi kiểm lại phạm vi nhóm / Mật của tệp như lúc gọi công cụ (review 27/10). Chỉ phục vụ khi bật MCP_FILE_RAW.

export const MCP_FILE_PATH_PREFIX = "/mcp-files/";
export const FILE_LINK_TTL_SECONDS = 300;
const log = createLogger("mcp-files");

const signature = (attachmentId: number, keyId: number, expires: number, secret: string): string =>
  crypto.createHmac("sha256", secret).update(`mcp-file:${attachmentId}.${keyId}.${expires}`).digest("base64url").slice(0, 32);

export function signFileLink(base: string, attachmentId: number, keyId: number, secret: string, nowMs = Date.now()): string {
  const expires = Math.floor(nowMs / 1000) + FILE_LINK_TTL_SECONDS;
  return `${base}${MCP_FILE_PATH_PREFIX}${attachmentId}?k=${keyId}&e=${expires}&s=${signature(attachmentId, keyId, expires, secret)}`;
}

/** Đường + tham số → (id tệp, id khóa) nếu chữ ký đúng và còn hạn; sai / hết hạn → null. Hàm thuần. */
export function verifyFileLink(path: string, params: URLSearchParams, secret: string, nowMs = Date.now()): { attachmentId: number; keyId: number } | null {
  const match = /^\/mcp-files\/(\d{1,15})$/.exec(path);
  const keyId = Number(params.get("k"));
  const expires = Number(params.get("e"));
  const given = params.get("s") ?? "";
  if (!match || !Number.isSafeInteger(keyId) || keyId <= 0 || !Number.isSafeInteger(expires) || expires * 1000 < nowMs) return null;
  const attachmentId = Number(match[1]);
  const expected = signature(attachmentId, keyId, expires, secret);
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  if (givenBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(givenBytes, expectedBytes)) return null;
  return { attachmentId, keyId };
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "tep";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || "tep")}`;
}

/** Phục vụ GET /mcp-files/<id>?k=&e=&s=. true = đường này của link tệp và đã trả lời. */
export async function serveMcpFileLink(
  deps: { db: Db; storage: FileStorage; secret: string; maskPersonalData: boolean }, path: string, url: URL, method: string, response: http.ServerResponse,
): Promise<boolean> {
  if (!path.startsWith(MCP_FILE_PATH_PREFIX)) return false;
  const deny = (status: number, message: string) => {
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end(message);
    return true;
  };
  if (method !== "GET") return deny(405, "Chỉ nhận GET");
  const link = verifyFileLink(path, url.searchParams, deps.secret);
  if (!link) return deny(403, "Link tải đã hết hạn hoặc không hợp lệ — gọi lại công cụ get_file để lấy link mới.");
  const verified = await loadMcpKeyAccess(deps.db, link.keyId);
  if (!verified) return deny(403, "Khóa / kết nối MCP không còn hiệu lực.");
  const ctx = buildDataAccessContext({
    db: deps.db, principal: verified.principal, maskPersonal: deps.maskPersonalData, source: McpCallSource.Http, keyId: link.keyId,
    ownDirectThreadsOnly: true, ownDirectUid: verified.ownDirectUid,
  });
  try {
    await assertAttachmentReadable(ctx, link.attachmentId);
  } catch (error) {
    if (error instanceof DataAccessError) return deny(404, "Không có tệp này.");
    throw error;
  }
  const [rows] = await deps.db.query<RowDataPacket[]>(
    "SELECT file_name, storage_key, status FROM attachment WHERE id = ?", [link.attachmentId]);
  const row = rows[0];
  if (!row || Number(row.status) !== AttachmentStatus.Stored || !row.storage_key) return deny(404, "Tệp không còn trong kho.");
  try {
    const stream = await deps.storage.read(String(row.storage_key));
    await pipeStreamToResponse(stream, response, {
      "Content-Type": "application/octet-stream", "Content-Disposition": contentDisposition(String(row.file_name ?? "")),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    });
  } catch (error) {
    log.warn(`tải tệp ${link.attachmentId} lỗi: ${describeError(error)}`);
    if (!response.headersSent) return deny(502, "Không đọc được tệp trong kho.");
    response.destroy();
  }
  return true;
}
