import type { TaskListScope } from "./task-command-parser.js";

// Dựng CÂU TRẢ LỜI tiếng Việt từ KẾT QUẢ CÓ CẤU TRÚC của công cụ việc (lõi `data-access/tasks/`). Câu trả lời là hợp đồng với người dùng nên chép
// NGUYÊN chuỗi của đường cũ (task-commands-legacy.ts); test vàng so từng ký tự cũ / mới. Hàm thuần — không đụng DB.

export const LIST_LIMIT = 30;

export interface TaskListingResult {
  scope: TaskListScope;
  /** Hỏi trong nhóm (tiêu đề «VIỆC CỦA NHÓM»). */
  in_group: boolean;
  /** Mỗi việc một dòng (`describeTaskLine`), tối đa LIST_LIMIT. */
  lines: string[];
  /** Mã ngắn của việc đầu danh sách («V-12») — dùng trong dòng gợi ý. */
  first_code: string | null;
}

export interface TaskCreatedResult {
  outcome: "created";
  /** Mã ngắn («V-12»). */
  code: string;
  title: string;
  assignee_name: string;
  due_label: string;
  has_due: boolean;
  /** Người phụ trách khác người giao → bot đã báo họ. */
  notified: boolean;
}

export type TaskActOutcome =
  | { outcome: "done"; code: string; notified_name: string | null }
  | { outcome: "noted"; code: string }
  | { outcome: "rescheduled"; code: string; due_label: string }
  | { outcome: "reassigned"; code: string; assignee_name: string }
  | { outcome: "cancelled"; code: string }
  | { outcome: "reopened"; code: string }
  | { outcome: "confirmed"; code: string; notified_name: string | null }
  | { outcome: "rejected"; code: string };

/** «ok hết» / «bỏ hết»: `none` = không có recap nào khớp / không đủ quyền → null (để AI trả lời như câu thường). */
export type TaskRecapDecisionResult =
  | { outcome: "none" }
  | { outcome: "none_left"; confirm: boolean }
  | { outcome: "decided"; confirm: boolean; codes: string[] };

/** Lỗi nghiệp vụ của lõi (đã đổi từ `_meta` lỗi của công cụ). */
export interface TaskToolFailure {
  code: string;
  message: string;
  reason?: string;
}

const NOT_FOUND = (id: number) => `Em không thấy việc V-${id} của anh/chị. Nhắn «việc» để xem danh sách.`;
const NO_RIGHT = "Anh/chị không có quyền làm việc này — chỉ người giao việc hoặc quản lý.";
const NOT_ALLOWED_BY_REASON: Record<string, string | undefined> = {
  staff_only: "Chỉ nhân sự công ty mới giao việc qua bot được.",
  work_done: "Chỉ người phụ trách, người giao hoặc quản lý mới báo xong được.",
  work_note: "Chỉ người phụ trách, người giao hoặc quản lý mới ghi chú được.",
  manage_only: NO_RIGHT,
};

export function listingReply(result: TaskListingResult): string {
  const { scope, lines } = result;
  const titles: Record<TaskListScope, string> = {
    mine: "VIỆC CỦA ANH/CHỊ (đang phụ trách hoặc đã giao)", group: result.in_group ? "VIỆC CỦA NHÓM" : "VIỆC ĐANG LÀM",
    overdue: "VIỆC QUÁ HẠN", proposed: "VIỆC CHỜ XÁC NHẬN",
  };
  if (!lines.length) return scope === "proposed" ? "Không có đề xuất nào chờ xác nhận." : "Không có việc nào.";
  const code = result.first_code;
  const hint = scope === "proposed" ? `Nhắn «ok ${code}» để lưu, «bỏ ${code}» nếu không phải việc.` : `Nhắn «xong ${code}», «dời ${code} <hạn>», «${code}» để xem chi tiết.`;
  const count = lines.length >= LIST_LIMIT ? `${LIST_LIMIT}+, ${LIST_LIMIT} việc gần hạn nhất` : String(lines.length);
  return [`${titles[scope]} (${count})`, ...lines, "", hint].join("\n");
}

export function createdReply(result: TaskCreatedResult): string {
  const notified = result.notified ? `; em đã báo ${result.assignee_name}` : "";
  return `Dạ đã ghi ${result.code}: ${result.title} — ${result.assignee_name} — hạn ${result.due_label}${notified}.` +
    (result.has_due ? "" : ` Chưa có hạn: nhắn «dời ${result.code} <hạn>» để đặt.`);
}

export function actReply(result: TaskActOutcome): string {
  const { code } = result;
  switch (result.outcome) {
    case "done": return `Dạ đã đánh xong ${code}${result.notified_name ? ` và báo ${result.notified_name}` : ""}.`;
    case "noted": return `Dạ em đã ghi chú vào ${code}.`;
    case "rescheduled": return `Dạ đã đổi hạn ${code} thành ${result.due_label}.`;
    case "reassigned": return `Dạ đã giao lại ${code} cho ${result.assignee_name}.`;
    case "cancelled": return `Dạ đã hủy ${code}.`;
    case "reopened": return `Dạ đã mở lại ${code}.`;
    case "confirmed":
      return `Dạ đã lưu ${code} vào checklist${result.notified_name ? ` và báo ${result.notified_name}` : " (chưa có người phụ trách — nhắn «giao lại " + code + " <tên>»)"}.`;
    case "rejected": return `Dạ em đã bỏ đề xuất ${code}.`;
  }
}

/** null = không có gì để trả (lệnh «ok hết» không khớp recap nào → để AI trả lời). */
export function recapDecisionReply(result: TaskRecapDecisionResult): string | null {
  if (result.outcome === "none") return null;
  if (result.outcome === "none_left") return `Không còn đề xuất nào để ${result.confirm ? "lưu" : "bỏ"} (có thể vừa được xử lý).`;
  return result.confirm
    ? `Dạ đã lưu ${result.codes.length} việc vào checklist: ${result.codes.join(", ")}.`
    : `Dạ đã bỏ ${result.codes.length} đề xuất: ${result.codes.join(", ")}.`;
}

/**
 * Câu bot cho một lỗi nghiệp vụ; null = lỗi hệ thống / tham số (nơi gọi ném tiếp hoặc báo lỗi riêng). `taskId` = việc người dùng nhắc.
 * Câu của lỗi phân giải người (không thấy / mơ hồ), không hiểu hạn và chuyển trạng thái sai nằm sẵn trong `message` (lõi dựng đúng chữ cũ).
 */
export function failureReply(failure: TaskToolFailure, taskId: number | null): string | null {
  if (failure.code === "invalid_state" || failure.code === "ambiguous") return failure.message;
  if (failure.code === "not_found" && !failure.reason) return failure.message;
  if (failure.code === "invalid_value" && failure.reason === "due_unparsed") return failure.message;
  if (failure.code !== "not_allowed") return null;
  if (failure.reason === "not_found") return NOT_FOUND(taskId ?? 0);
  return (failure.reason ? NOT_ALLOWED_BY_REASON[failure.reason] : undefined) ?? null;
}
