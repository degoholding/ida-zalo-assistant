import { SendTargetStatus } from "../constants.js";
import { CONFIRM_TTL_MS } from "./send-command-limits.js";
import { formatCommandCode } from "./send-command-preview.js";
import type { SendCommandRow, SendTargetRow } from "./send-command-types.js";

// Chữ bot trả cho lệnh GHIM lên nhóm (action_kind = 3): bản xem trước do MÁY CHỦ dựng + báo kết quả. Hàm thuần.

export interface PinPreviewInput {
  id: number;
  content: string;
  targets: { displayName: string; secret: boolean }[];
}

export function formatPinPreview(input: PinPreviewInput): string {
  return [
    `XEM TRƯỚC GHIM ${formatCommandCode(input.id)}`,
    `Ghim lên ${input.targets.length} nhóm:`,
    ...input.targets.map((target, index) => `${index + 1}. Nhóm «${target.displayName}» (nội bộ${target.secret ? ", Mật" : ""})`),
    `Nội dung ghim: «${input.content}»`,
    `Nhắn «đồng ý» trong ${CONFIRM_TTL_MS / 60_000} phút để ghim, «hủy» để bỏ.`,
  ].join("\n");
}

/** Báo kết quả về người ra lệnh khi mọi nhóm đã xong (thành công hoặc lỗi). */
export function formatPinResultReport(command: Pick<SendCommandRow, "id">, targets: SendTargetRow[]): string {
  const pinned = targets.filter((target) => target.status === SendTargetStatus.Sent).length;
  const failed = targets.some((target) => target.status === SendTargetStatus.Failed);
  return [
    `KẾT QUẢ GHIM ${formatCommandCode(command.id)}: ${pinned}/${targets.length} nhóm thành công`,
    ...targets.map((target, index) => {
      const text = target.status === SendTargetStatus.Failed ? `LỖI — ${target.error || "không rõ lý do"}`
        : target.status === SendTargetStatus.Sent ? "đã ghim" : target.status === SendTargetStatus.Cancelled ? "đã hủy" : "chưa ghim";
      return `${index + 1}. nhóm «${target.displayName}»: ${text}`;
    }),
    ...(failed ? ["Gửi lại nơi lỗi ở màn Gửi tin trên web."] : []),
  ].join("\n");
}
