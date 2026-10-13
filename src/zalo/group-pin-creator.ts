import { BoardType, type API, type NoteDetail } from "zca-js";
import type { ZaloSender } from "./zalo-sender.js";

// Ghim MỘT ghi chú lên nhóm từ job lệnh gửi (ghim từ tin riêng). Đi qua `ZaloSender` — có giãn cách và bị chặn khi bot tắt khẩn
// (BotHaltedError), cùng lời gọi `createNote({ title, pinAct: true })` với `group-assistant-replier.buildActions.createPinnedNote`.

/** Bỏ khác biệt vô hại (xuống dòng Windows, khoảng trắng đầu / cuối) khi so nội dung ghi chú. */
const normalizeNote = (text: string): string => text.normalize("NFC").replace(/\r\n?/g, "\n").trim();

/**
 * `checkExisting` = true ở lượt thử lại / gửi lại: lượt trước có thể đã ghim xong mà lỗi mạng làm mất kết quả, nên liệt kê ghi chú
 * của nhóm — đã có ghi chú cùng nội dung thì thôi, không ghim trùng. Trả mã ghi chú (hoặc của bản có sẵn).
 */
export async function createGroupPin(api: API, sender: ZaloSender, zaloGroupId: string, content: string, checkExisting: boolean): Promise<string> {
  const title = normalizeNote(content);
  if (!title) throw new Error("nội dung ghim trống");
  if (checkExisting) {
    const board = await api.getListBoard({ count: 50 }, zaloGroupId);
    const same = board.items
      .filter((item) => item.boardType === BoardType.Note)
      .map((item) => item.data as NoteDetail)
      .find((note) => normalizeNote(note.params?.title ?? "") === title);
    if (same) return String(same.id);
  }
  const note = await sender.send(() => api.createNote({ title, pinAct: true }, zaloGroupId));
  return String(note.id);
}
