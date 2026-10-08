import { TextStyle, type Style } from "zca-js";

// Chữ bot gửi lên Zalo (đại ca 08/10/2026): bỏ ký tự «», phần bên trong in đậm. Câu trả lời / lệnh / báo của bot dùng
// «…» để chỉ đúng câu cần gõ («nhận T-12») — trên Zalo hiện in đậm thay vì dấu ngoặc. Chữ quản trị tự gõ trên web không
// đi qua đây. Cặp «» lồng nhau / thiếu một nửa / xuống dòng giữa chừng thì giữ nguyên.

const QUOTED = /«([^«»\n]{1,200})»/g;

export interface StyledText {
  msg: string;
  styles: Style[];
}

/** Đổi «…» thành đoạn in đậm. Hàm thuần — vị trí tính trên chuỗi đã bỏ dấu ngoặc. */
export function toStyledText(text: string): StyledText {
  let msg = "";
  const styles: Style[] = [];
  let last = 0;
  for (const match of text.matchAll(QUOTED)) {
    msg += text.slice(last, match.index);
    const inner = match[1];
    if (inner.trim()) styles.push({ start: msg.length, len: inner.length, st: TextStyle.Bold });
    msg += inner;
    last = match.index + match[0].length;
  }
  msg += text.slice(last);
  return { msg, styles };
}

/** Nội dung gửi zca-js: có đoạn in đậm thì kèm `styles`. */
export function toStyledContent(text: string): { msg: string; styles?: Style[] } {
  const { msg, styles } = toStyledText(text);
  return styles.length ? { msg, styles } : { msg };
}
