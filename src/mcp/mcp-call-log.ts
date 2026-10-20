import crypto from "node:crypto";
import type { McpCallSource, McpCallStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { maskPersonalData } from "../privacy/personal-data.js";

// Ghi một dòng mcp_call_log cho MỖI lời gọi công cụ (kể cả lỗi / bị chặn / quá nhịp). Không lưu nội dung trả về —
// chỉ băm tham số + bản xem trước đã che dữ liệu cá nhân. Ghi không chặn lời gọi chính và không bao giờ ném lỗi.

const log = createLogger("mcp");
const PREVIEW_MAX = 500;
/** Cắt trước khi chạy bộ che (regex) — tham số có thể dài hàng trăm nghìn ký tự (chữ bóc từ tệp). Dư vài trăm để phần bị cắt không làm hụt bản xem trước. */
const PREVIEW_PRE_MASK_MAX = 2000;

export interface McpCallLogEntry {
  userId: number | null;
  /** Liên hệ Zalo đang nhắn bot (lượt trợ lý) — người không có tài khoản web vẫn truy được về ai. */
  contactId?: number | null;
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

/**
 * Trường chữ DÀI / nhạy cảm theo công cụ — nhật ký chỉ giữ độ dài, không bao giờ nội dung (thân tin gửi, chữ bóc của tệp). Công cụ nào nhận nội dung
 * tin do người dùng viết thì thêm vào đây.
 */
const LENGTH_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  file_text_store: ["text", "summary"],
  send_draft_create: ["body", "question"],
  send_pin_draft_create: ["content", "question"],
  propose_send_message: ["content"],
};

export function redactForPreview(tool: string | undefined, args: unknown): unknown {
  const fields = tool ? LENGTH_ONLY_FIELDS[tool] : undefined;
  if (!fields || !args || typeof args !== "object" || Array.isArray(args)) return args;
  const copy: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const field of fields) if (typeof copy[field] === "string") copy[field] = `[${(copy[field] as string).length} ký tự]`;
  return copy;
}

export function previewArgs(args: unknown, tool?: string): string {
  // Cắt TRƯỚC khi che: bộ che chạy regex, không để nó quét chuỗi vài trăm nghìn ký tự
  return maskPersonalData(stableStringify(redactForPreview(tool, args)).slice(0, PREVIEW_PRE_MASK_MAX)).slice(0, PREVIEW_MAX);
}

/**
 * Mã xác nhận ghi (confirm_write) là bí mật dùng một lần: không để lọt vào nhật ký — kể cả dạng băm (không gian 32^6 dò ngược được) lẫn bản
 * xem trước. Thay bằng chữ cố định trước khi băm / cắt.
 */
/** Công cụ nhận mã xác nhận: cổng ngoài `confirm_write` + lệnh «đồng ý / hủy» của trợ lý (mặt command). */
const CODE_BEARING_TOOLS: ReadonlySet<string> = new Set(["confirm_write", "confirm_draft", "cancel_draft"]);

export function redactCodes(tool: string, args: unknown): unknown {
  if (!CODE_BEARING_TOOLS.has(tool) || !args || typeof args !== "object") return args;
  return { ...(args as Record<string, unknown>), code: "[đã ẩn]" };
}

export async function logMcpCall(db: Db, entry: McpCallLogEntry): Promise<void> {
  const args = redactCodes(entry.tool, entry.args);
  try {
    await db.query(
      `INSERT INTO mcp_call_log (tenant_id, user_id, contact_id, key_id, source, tool, entity, args_hash, args_preview, row_count, result_chars,
                                 duration_ms, status, error_code, client_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.tenantId, entry.userId, entry.contactId ?? null, entry.keyId, entry.source, entry.tool.slice(0, 64), entry.entity ?? null, hashArgs(args),
        previewArgs(args, entry.tool), entry.rowCount, entry.resultChars, Math.round(entry.durationMs), entry.status,
        entry.errorCode ? entry.errorCode.slice(0, 64) : null, entry.clientIp ? entry.clientIp.slice(0, 64) : null]);
  } catch (error) {
    log.error(`không ghi được mcp_call_log (${entry.tool}): ${describeError(error)}`);
  }
}
