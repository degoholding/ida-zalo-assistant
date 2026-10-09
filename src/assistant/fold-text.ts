/**
 * Bỏ dấu GIỮ NGUYÊN độ dài chuỗi (mỗi ký tự → một ký tự) — so khớp lệnh không dấu rồi cắt phần đối số từ câu GỐC đúng vị
 * trí. Dùng chung cho lệnh gõ (chat-commands.ts, tasks/task-command-parser.ts). Hàm thuần.
 */
export function foldKeepLength(text: string): string {
  return text.split("").map((char) => {
    const base = char.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
    return base.length === 1 ? base : char;
  }).join("");
}
