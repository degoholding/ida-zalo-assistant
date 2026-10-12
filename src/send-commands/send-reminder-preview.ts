import { SendTargetStatus } from "../constants.js";
import { REPEAT_LABEL } from "../assistant/group-action-tools.js";
import { CONFIRM_TTL_MS } from "./send-command-limits.js";
import { formatCommandCode, formatSendTime } from "./send-command-preview.js";
import type { ReminderRepeat, SendCommandRow, SendTargetRow } from "./send-command-types.js";

// Chữ bot trả cho lệnh NHẮC HẸN nhóm (action_kind = 2): bản xem trước do MÁY CHỦ dựng + báo kết quả. Hàm thuần.

export interface ReminderPreviewInput {
  id: number;
  title: string;
  reminderAt: Date;
  repeat: ReminderRepeat;
  offHoursNote: string;
  targets: { displayName: string; secret: boolean }[];
}

export const describeRepeat = (repeat: number): string => REPEAT_LABEL[repeat] ?? "không lặp";

export function formatReminderPreview(input: ReminderPreviewInput): string {
  return [
    `XEM TRƯỚC NHẮC HẸN ${formatCommandCode(input.id)}`,
    `Tạo nhắc hẹn Zalo cho ${input.targets.length} nhóm:`,
    ...input.targets.map((target, index) => `${index + 1}. Nhóm «${target.displayName}» (nội bộ${target.secret ? ", Mật" : ""})`),
    `Nhắc lúc: ${formatSendTime(input.reminderAt)}`,
    `Lặp: ${describeRepeat(input.repeat)}`,
    ...(input.offHoursNote ? [`Lưu ý: ${input.offHoursNote}`] : []),
    `Nội dung nhắc: «${input.title}»`,
    `Nhắn «đồng ý» trong ${CONFIRM_TTL_MS / 60_000} phút để tạo, «hủy» để bỏ.`,
  ].join("\n");
}

/** Báo kết quả về người ra lệnh khi mọi nhóm đã xong (thành công hoặc lỗi). */
export function formatReminderResultReport(command: Pick<SendCommandRow, "id">, targets: SendTargetRow[]): string {
  const created = targets.filter((target) => target.status === SendTargetStatus.Sent).length;
  const failed = targets.some((target) => target.status === SendTargetStatus.Failed);
  return [
    `KẾT QUẢ NHẮC HẸN ${formatCommandCode(command.id)}: ${created}/${targets.length} nhóm thành công`,
    ...targets.map((target, index) => {
      const text = target.status === SendTargetStatus.Failed ? `LỖI — ${target.error || "không rõ lý do"}`
        : target.status === SendTargetStatus.Sent ? "đã tạo nhắc hẹn" : target.status === SendTargetStatus.Cancelled ? "đã hủy" : "chưa tạo";
      return `${index + 1}. nhóm «${target.displayName}»: ${text}`;
    }),
    ...(failed ? ["Gửi lại nơi lỗi ở màn Gửi tin trên web."] : []),
  ].join("\n");
}
