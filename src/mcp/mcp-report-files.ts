import crypto from "node:crypto";
import type http from "node:http";
import { loadMcpKeyAccess } from "../auth/mcp-api-key-store.js";
import type { Principal } from "../auth/principal.js";
import { McpCallSource, McpCallStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { McpCallLogEntry } from "./mcp-call-log.js";

// Tệp báo cáo của công cụ MCP export_report (phase 13.4, 28/10/2026): cất TẠM trong bộ nhớ tiến trình (có trần số tệp + tổng dung lượng, hết
// hạn 10 phút) rồi trả link tải ký HMAC đi qua chính bot — cùng cách với link tệp gốc /mcp-files (không lộ R2, không cần phiên đăng nhập).
// Lúc tải: chữ ký đúng + còn hạn, tệp còn trong bộ đệm, khóa MCP còn sống (chưa thu hồi / hết hạn, chủ còn được dùng MCP) và QUYỀN của khóa
// không đổi so với lúc xuất (vai trò, phạm vi nhóm, cờ Mật, cuộc riêng, công tắc che dữ liệu) — đổi gì thì từ chối, AI gọi lại export_report.
// Bot chạy một tiến trình web nên bộ đệm trong bộ nhớ là đủ; khởi động lại thì link cũ hết hiệu lực (báo AI xuất lại).

export const MCP_REPORT_PATH_PREFIX = "/mcp-reports/";
export const REPORT_LINK_TTL_SECONDS = 600;
/** Trần MỘT tệp xuất. */
export const REPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const STORE_MAX_FILES = 50;
const STORE_MAX_BYTES = 64 * 1024 * 1024;
const log = createLogger("mcp-reports");

export interface StoredReport {
  keyId: number;
  /** Dấu quyền lúc xuất — xem `accessFingerprint`. */
  fingerprint: string;
  fileName: string;
  contentType: string;
  data: Buffer;
  rowCount: number;
  expiresAtMs: number;
}

/** Dấu vân tay những gì quyết định dữ liệu trong báo cáo: người, vai trò, phạm vi nhóm, cờ Mật, cuộc riêng của chính mình, công tắc che. */
export function accessFingerprint(principal: Principal, ownDirectUid: string | null, maskPersonal: boolean): string {
  const groups = principal.groupIds === null ? "*" : [...principal.groupIds].sort((a, b) => a - b).join(",");
  return [principal.userId ?? 0, principal.role, principal.canViewConfidential === true, groups, ownDirectUid ?? "", maskPersonal].join("|");
}

/** Bộ đệm tệp báo cáo có hạn: hết hạn tự bỏ; vượt trần số tệp / dung lượng thì bỏ tệp cũ nhất trước. */
export class ReportFileStore {
  private readonly entries = new Map<string, StoredReport>();
  private totalBytes = 0;

  constructor(private readonly limits: { maxFiles: number; maxBytes: number } = { maxFiles: STORE_MAX_FILES, maxBytes: STORE_MAX_BYTES }) {}

  put(report: StoredReport, nowMs = Date.now()): string {
    this.sweep(nowMs);
    while (this.entries.size >= this.limits.maxFiles || (this.entries.size > 0 && this.totalBytes + report.data.length > this.limits.maxBytes)) {
      const oldest = this.entries.keys().next().value as string;
      this.remove(oldest);
    }
    const token = crypto.randomBytes(18).toString("base64url");
    this.entries.set(token, report);
    this.totalBytes += report.data.length;
    return token;
  }

  get(token: string, nowMs = Date.now()): StoredReport | null {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAtMs <= nowMs) {
      this.remove(token);
      return null;
    }
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private sweep(nowMs: number): void {
    for (const [token, entry] of this.entries) if (entry.expiresAtMs <= nowMs) this.remove(token);
  }

  private remove(token: string): void {
    const entry = this.entries.get(token);
    if (!entry) return;
    this.entries.delete(token);
    this.totalBytes -= entry.data.length;
  }
}

/** Bộ đệm dùng chung của tiến trình (cổng /mcp ghi, đường /mcp-reports đọc). */
export const sharedReportFiles = new ReportFileStore();

const signature = (token: string, keyId: number, expires: number, secret: string): string =>
  crypto.createHmac("sha256", secret).update(`mcp-report:${token}.${keyId}.${expires}`).digest("base64url").slice(0, 32);

export function signReportLink(base: string, token: string, keyId: number, expiresAtMs: number, secret: string): string {
  const expires = Math.floor(expiresAtMs / 1000);
  return `${base}${MCP_REPORT_PATH_PREFIX}${token}?k=${keyId}&e=${expires}&s=${signature(token, keyId, expires, secret)}`;
}

/** Đường + tham số → (mã tệp, id khóa) nếu chữ ký đúng và còn hạn; sai / hết hạn → null. Hàm thuần. */
export function verifyReportLink(path: string, params: URLSearchParams, secret: string, nowMs = Date.now()): { token: string; keyId: number } | null {
  const match = /^\/mcp-reports\/([A-Za-z0-9_-]{16,64})$/.exec(path);
  const keyId = Number(params.get("k"));
  const expires = Number(params.get("e"));
  const given = params.get("s") ?? "";
  if (!match || !Number.isSafeInteger(keyId) || keyId <= 0 || !Number.isSafeInteger(expires) || expires * 1000 < nowMs) return null;
  const expected = signature(match[1], keyId, expires, secret);
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  if (givenBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(givenBytes, expectedBytes)) return null;
  return { token: match[1], keyId };
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "bao-cao";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || "bao-cao")}`;
}

export interface ReportLinkDeps {
  db: Db;
  secret: string;
  maskPersonalData: boolean;
  store?: ReportFileStore;
  /** Ghi một dòng mcp_call_log cho lượt tải (tool export_report_download). */
  logCall?: (entry: McpCallLogEntry) => Promise<void>;
  clientIp?: string | null;
}

/** Phục vụ GET /mcp-reports/<mã>?k=&e=&s=. true = đường này của link báo cáo và đã trả lời. */
export async function serveMcpReportLink(deps: ReportLinkDeps, path: string, url: URL, method: string, response: http.ServerResponse): Promise<boolean> {
  if (!path.startsWith(MCP_REPORT_PATH_PREFIX)) return false;
  const deny = (status: number, message: string) => {
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end(message);
    return true;
  };
  if (method !== "GET") return deny(405, "Chỉ nhận GET");
  const link = verifyReportLink(path, url.searchParams, deps.secret);
  if (!link) return deny(403, "Link tải đã hết hạn hoặc không hợp lệ — gọi lại công cụ export_report để lấy link mới.");
  const store = deps.store ?? sharedReportFiles;
  const entry = store.get(link.token);
  if (!entry || entry.keyId !== link.keyId) return deny(404, "Tệp báo cáo không còn (đã hết hạn hoặc máy chủ vừa khởi động lại) — gọi lại export_report.");
  const verified = await loadMcpKeyAccess(deps.db, link.keyId);
  if (!verified) return deny(403, "Khóa / kết nối MCP không còn hiệu lực.");
  if (accessFingerprint(verified.principal, verified.ownDirectUid, deps.maskPersonalData) !== entry.fingerprint) {
    return deny(403, "Quyền của khóa đã thay đổi từ lúc xuất — gọi lại export_report.");
  }
  response.writeHead(200, {
    "Content-Type": entry.contentType, "Content-Length": String(entry.data.length), "Content-Disposition": contentDisposition(entry.fileName),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  });
  response.end(entry.data);
  if (deps.logCall) {
    const principal = verified.principal;
    await deps.logCall({
      userId: principal.userId, tenantId: principal.tenantId, keyId: link.keyId, source: McpCallSource.Http, tool: "export_report_download",
      args: { file: entry.fileName }, rowCount: entry.rowCount, resultChars: entry.data.length, durationMs: 0, status: McpCallStatus.Ok,
      clientIp: deps.clientIp ?? null,
    }).catch((error) => log.warn(`ghi nhật ký tải báo cáo: ${describeError(error)}`));
  }
  return true;
}
