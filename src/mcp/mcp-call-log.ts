import crypto from "node:crypto";
import type { McpCallSource, McpCallStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { maskPersonalData } from "../privacy/personal-data.js";

// Ghi một dòng mcp_call_log cho MỖI lời gọi công cụ (kể cả lỗi / bị chặn / quá nhịp). Không lưu nội dung trả về —
// chỉ băm tham số + bản xem trước đã che dữ liệu cá nhân. Ghi không chặn lời gọi chính và không bao giờ ném lỗi.

const log = createLogger("mcp");
const PREVIEW_MAX = 500;

export interface McpCallLogEntry {
  userId: number | null;
  tenantId: number;
  keyId: number | null;
  source: McpCallSource;
  tool: string;
  entity?: string;
  args: unknown;
  rowCount: number;
  resultChars: number;
  durationMs: number;
  status: McpCallStatus;
  errorCode?: string;
  clientIp: string | null;
}

/** JSON có khóa sắp xếp — cùng tham số luôn cùng băm dù client gửi khóa theo thứ tự nào. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashArgs(args: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(args)).digest("hex");
}

export function previewArgs(args: unknown): string {
  return maskPersonalData(stableStringify(args)).slice(0, PREVIEW_MAX);
}

export async function logMcpCall(db: Db, entry: McpCallLogEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO mcp_call_log (tenant_id, user_id, key_id, source, tool, entity, args_hash, args_preview, row_count, result_chars,
                                 duration_ms, status, error_code, client_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.tenantId, entry.userId, entry.keyId, entry.source, entry.tool.slice(0, 64), entry.entity ?? null, hashArgs(entry.args),
        previewArgs(entry.args), entry.rowCount, entry.resultChars, Math.round(entry.durationMs), entry.status,
        entry.errorCode ? entry.errorCode.slice(0, 64) : null, entry.clientIp ? entry.clientIp.slice(0, 64) : null]);
  } catch (error) {
    log.error(`không ghi được mcp_call_log (${entry.tool}): ${describeError(error)}`);
  }
}
