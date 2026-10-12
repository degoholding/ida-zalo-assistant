import { SendActionKind, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";
import { vnLocalTime } from "../schedule/work-calendar.js";
import { CONFIRM_TTL_MS } from "./send-command-limits.js";
import type { SendCommandRow, SendTargetRow } from "./send-command-types.js";

// Chữ bot trả cho lệnh gửi (phase 9): bản xem trước do MÁY CHỦ dựng từ dữ liệu đã lưu, báo kết quả, danh sách lệnh. Hàm thuần.
// Công cụ AI trả nguyên văn bản xem trước làm câu trả lời — mô hình không diễn đạt lại được.

const PREVIEW_BODY_MAX = 1500;
const WEEKDAYS = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** «08:00 T3 13/10» (giờ VN). */
export function formatSendTime(at: Date): string {
  const local = vnLocalTime(at);
  const hour = String(Math.floor(local.minuteOfDay / 60)).padStart(2, "0");
  const minute = String(local.minuteOfDay % 60).padStart(2, "0");
  const [, month, day] = local.date.split("-");
  return `${hour}:${minute} ${WEEKDAYS[local.weekday]} ${day}/${month}`;
}

/** Mã hiển thị «G-12». */
export const formatCommandCode = (id: number): string => `G-${id}`;

/** Nơi nhận trong bản xem trước (đã phân giải, chưa ghi DB hoặc đã ghi). */
export interface PreviewTarget {
  kind: SendTargetKind;
  displayName: string;
  /** Nhóm Mật nội bộ */
  secret: boolean;
}

export interface PreviewInput {
  id: number;
  scheduledAt: Date | null;
  offHoursNote: string;
  body: string;
  attachmentNames: string[];
  targets: PreviewTarget[];
}

function clipBody(body: string): string {
  if (body.length <= PREVIEW_BODY_MAX) return body;
  return `${body.slice(0, PREVIEW_BODY_MAX)}\n(… còn ${body.length - PREVIEW_BODY_MAX} ký tự)`;
}

function describeTarget(target: PreviewTarget): string {
  return target.kind === SendTargetKind.Group
    ? `Nhóm «${target.displayName}» (nội bộ${target.secret ? ", Mật" : ""})`
    : `Anh/chị ${target.displayName} (nhân sự)`;
}

export function formatPreview(input: PreviewInput): string {
  const files = input.attachmentNames;
  return [
    `XEM TRƯỚC LỆNH GỬI ${formatCommandCode(input.id)}`,
    `Gửi tới ${input.targets.length} nơi:`,
    ...input.targets.map((target, index) => `${index + 1}. ${describeTarget(target)}`),
    `Giờ gửi: ${input.scheduledAt ? formatSendTime(input.scheduledAt) : "ngay sau khi đồng ý"}`,
    ...(input.offHoursNote ? [`Lưu ý: ${input.offHoursNote}`] : []),
    ...(files.length ? [`Tệp kèm: ${files.length} (${files.join(", ")})`] : []),
    `Nội dung: ${input.body ? `«${clipBody(input.body)}»` : "(chỉ gửi tệp)"}`,
    `Nhắn «đồng ý» trong ${CONFIRM_TTL_MS / 60_000} phút để gửi, «hủy» để bỏ.`,
  ].join("\n");
}

const TARGET_STATUS_TEXT: Partial<Record<SendTargetStatus, string>> = {
  [SendTargetStatus.Sent]: "đã gửi",
  [SendTargetStatus.Cancelled]: "đã hủy",
  [SendTargetStatus.Pending]: "chưa gửi",
  [SendTargetStatus.Queued]: "chưa gửi",
};

function describeTargetRow(target: SendTargetRow): string {
  return target.kind === SendTargetKind.Group ? `nhóm «${target.displayName}»` : `anh/chị ${target.displayName}`;
}

/** Báo kết quả về người ra lệnh khi mọi nơi đã xong (thành công hoặc lỗi). */
export function formatResultReport(command: Pick<SendCommandRow, "id">, targets: SendTargetRow[]): string {
  const sent = targets.filter((target) => target.status === SendTargetStatus.Sent).length;
  const failed = targets.some((target) => target.status === SendTargetStatus.Failed);
  return [
    `KẾT QUẢ LỆNH ${formatCommandCode(command.id)}: ${sent}/${targets.length} nơi thành công`,
    ...targets.map((target, index) => {
      const text = target.status === SendTargetStatus.Failed ? `LỖI — ${target.error || "không rõ lý do"}` : (TARGET_STATUS_TEXT[target.status] ?? "chưa rõ");
      return `${index + 1}. ${describeTargetRow(target)}: ${text}`;
    }),
    ...(failed ? ["Gửi lại nơi lỗi ở màn Gửi tin trên web."] : []),
  ].join("\n");
}

const COMMAND_STATUS_TEXT: Record<SendCommandStatus, string> = {
  [SendCommandStatus.Draft]: "chờ đồng ý",
  [SendCommandStatus.Scheduled]: "đang hẹn",
  [SendCommandStatus.Sending]: "đang gửi",
  [SendCommandStatus.Done]: "đã xong",
  [SendCommandStatus.Cancelled]: "đã hủy",
  [SendCommandStatus.Expired]: "quá hạn đồng ý",
};

export const describeCommandStatus = (status: SendCommandStatus): string => COMMAND_STATUS_TEXT[status] ?? "không rõ";

export interface RequesterListItem {
  command: SendCommandRow;
  targetCount: number;
}

function listLine({ command, targetCount }: RequesterListItem): string {
  const reminder = command.actionKind === SendActionKind.Reminder;
  const at = reminder ? command.reminderAt : command.scheduledAt;
  const when = `${reminder ? " · nhắc hẹn" : ""}${at ? ` · ${formatSendTime(at)}` : ""}`;
  const snippet = command.body.replace(/\s+/g, " ").slice(0, 40);
  return `- ${formatCommandCode(command.id)} · ${describeCommandStatus(command.status)}${when} · ${targetCount} nơi · «${snippet}${command.body.length > 40 ? "…" : ""}»`;
}

/** Câu «lệnh gửi»: lệnh đang hẹn (hủy bằng «hủy G-12») + vài lệnh gần nhất. */
export function formatRequesterList(scheduled: RequesterListItem[], recent: RequesterListItem[]): string {
  if (!scheduled.length && !recent.length) return "Anh/chị chưa có lệnh gửi nào.";
  return [
    ...(scheduled.length ? ["LỆNH ĐANG HẸN (nhắn «hủy G-<số>» để hủy):", ...scheduled.map(listLine)] : ["Không có lệnh nào đang hẹn."]),
    ...(recent.length ? ["GẦN ĐÂY:", ...recent.map(listLine)] : []),
  ].join("\n");
}
