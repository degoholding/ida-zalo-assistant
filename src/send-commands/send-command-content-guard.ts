import { foldName } from "./send-target-matcher.js";

// Chống tiêm lệnh (phase 9): nội dung gửi đi phải là một đoạn NGUYÊN VĂN của chính tin người ra lệnh ở lượt này (chỉ bỏ qua
// hoa thường + khoảng trắng, GIỮ dấu — «bán» ≠ «bạn», «họp» ≠ «hộp»), và thứ được gửi là ĐOẠN GỐC cắt từ tin đó chứ không phải
// chữ mô hình chép lại. Tên nơi nhận chỉ cần có trong tin (gấp dấu) vì máy chủ tự phân giải ra tên thật. Chữ nằm trong tệp /
// link / tin nhóm mà mô hình đọc được không thể thành tin gửi đi, mô hình cũng không thể tự thêm bớt chữ. Hàm thuần.

/** Lỗi do người ra lệnh nhập sai / công cụ gọi sai — `message` là câu trả lời hiển thị cho người dùng. */
export class SendCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendCommandInputError";
  }
}

const VERBATIM_HINT = "Nội dung phải đúng nguyên văn anh/chị viết — nhắn lại theo mẫu «gửi nhóm A: <nội dung>».";

/** Chữ thường + gộp khoảng trắng (GIỮ dấu), kèm `map[i]` = vị trí trong chuỗi gốc (đã NFC) của ký tự thứ i. */
function collapse(text: string): { value: string; map: number[]; source: string } {
  const source = text.normalize("NFC");
  let value = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (/\s/.test(char)) {
      pendingSpace = value.length > 0;
      continue;
    }
    if (pendingSpace) {
      value += " ";
      map.push(index);
      pendingSpace = false;
    }
    // toLowerCase có thể ra nhiều hơn một ký tự («İ») — mỗi ký tự ra đều trỏ về cùng vị trí gốc
    for (const lower of char.toLowerCase()) {
      value += lower;
      map.push(index);
    }
  }
  return { value, map, source };
}

/** Đoạn gốc trong `question` khớp `body` (bỏ qua hoa thường / khoảng trắng, giữ dấu); null nếu không có. */
export function extractVerbatim(question: string, body: string): string | null {
  const needle = collapse(body).value;
  if (!needle) return "";
  const haystack = collapse(question);
  const at = haystack.value.indexOf(needle);
  if (at < 0) return null;
  const start = haystack.map[at];
  const end = haystack.map[at + needle.length - 1];
  return haystack.source.slice(start, end + 1);
}

/**
 * Kiểm nội dung + tên nơi nhận; trả NỘI DUNG GỐC cắt từ tin người ra lệnh (giữ đúng hoa thường, dấu, xuống dòng họ gõ) — nơi
 * gọi phải gửi chuỗi này, không gửi `body` mô hình đưa vào. Ném SendCommandInputError khi không nguyên văn.
 */
export function assertVerbatim(question: string, body: string, targetNames: string[]): string {
  const verbatim = extractVerbatim(question, body);
  if (verbatim === null) throw new SendCommandInputError(VERBATIM_HINT);
  assertNamesInQuestion(question, targetNames, VERBATIM_HINT);
  return verbatim.trim();
}

/** Mỗi tên nơi nhận phải có trong tin người ra lệnh (gấp dấu) — mô hình không tự thêm nơi nhận lấy từ dữ liệu khác. */
export function assertNamesInQuestion(question: string, targetNames: string[], hint: string): void {
  const haystack = foldName(question);
  for (const name of targetNames) {
    const folded = foldName(name);
    if (!folded || !haystack.includes(folded)) throw new SendCommandInputError(hint);
  }
}
