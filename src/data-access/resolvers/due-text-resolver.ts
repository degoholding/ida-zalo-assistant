import { parseDueArgument, type ParsedDue } from "../../tasks/task-due-parser.js";
import { DataAccessError } from "../data-access-errors.js";

// Phân giải HẠN người dùng gõ («thứ 6», «mai 17h», «20/10», ISO 8601) ra mốc giờ Việt Nam — ở LÕI (T4) để lệnh gõ, công cụ mô hình và MCP ngoài
// (`propose_task_create` / `propose_task_update` với `due_text`) cùng hiểu một cách. Bọc `parseDueArgument` (hàm thuần, không đổi): hạn ngoài
// khoảng hợp lý (quá khứ xa / quá 2 năm) cũng coi là «không hiểu» — không đoán bừa.

export const DUE_UNPARSED_REASON = "due_unparsed";

/** Câu bot trả khi không hiểu hạn — chép nguyên của đường cũ (lệnh việc gõ). */
export const dueUnparsedMessage = (text: string): string =>
  `Em chưa hiểu hạn «${text}». Ghi hạn dạng «mai», «thứ 6», «20/10», «17h thứ 6» giúp em.`;

/** Hạn đã hiểu, hoặc null nếu không hiểu / trống. */
export function resolveDueText(raw: unknown, now: Date): ParsedDue | null {
  return parseDueArgument(raw, now);
}

/** Trống → null (không đặt hạn); có chữ mà không hiểu → `invalid_value` (`reason: due_unparsed`, `message` = câu bot cũ). */
export function requireDueText(raw: string | null | undefined, now: Date): ParsedDue | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const due = resolveDueText(text, now);
  if (!due) throw new DataAccessError("invalid_value", dueUnparsedMessage(text), undefined, { reason: DUE_UNPARSED_REASON });
  return due;
}

/** Như `requireDueText` nhưng hạn là BẮT BUỘC (dời hạn): trống cũng là «không hiểu». */
export function requireDueTextStrict(raw: string | null | undefined, now: Date): ParsedDue {
  const due = requireDueText(raw, now);
  if (!due) throw new DataAccessError("invalid_value", dueUnparsedMessage((raw ?? "").trim()), undefined, { reason: DUE_UNPARSED_REASON });
  return due;
}
