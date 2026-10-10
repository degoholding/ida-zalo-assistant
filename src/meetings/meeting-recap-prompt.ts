// Câu lệnh nghe ghi âm cuộc họp MỘT LƯỢT (phase 4, recap tự động từ Drive): mô hình trả THẲNG JSON recap, không gỡ
// băng toàn văn trước — tránh tốn token đầu ra với cuộc họp dài. THUẦN: không gọi mạng / CSDL.

export const MEETING_RECAP_JSON_INSTRUCTION = `Bạn nghe một bản ghi âm cuộc họp công việc (công ty phân bón / thuốc bảo vệ thực vật) rồi soạn THẲNG bản recap.
Chỉ trả về MỘT đối tượng JSON, không chữ nào khác, đúng các khóa sau (bỏ khóa nếu ghi âm không có, KHÔNG bịa):
{
  "title": "<tên cuộc họp nếu có nhắc tới, không thì để trống>",
  "subtitle": "<một dòng mô tả chủ đề / các bên tham gia>",
  "duration": "<thời lượng ước lượng, vd '~45 phút'>",
  "attendees": [{"role": "<vai trò, vd Trưởng nhóm>", "name": "<tên>"}],
  "tldr": ["<3–6 ý quan trọng nhất, có số liệu nếu có>"],
  "sections": [{"heading": "<chủ đề>", "bullets": ["<ý 1>", "<ý 2>"]}],
  "decisions": ["<định hướng / quyết định đã thống nhất>"],
  "tasks": [{"task": "<việc cần làm>", "owner": "<TÊN người được giao, đúng tên đã nghe trong ghi âm>", "due": "<hạn nếu có nói>", "priority": "Cao" | "TB" | "Thấp"}],
  "timeline": [{"when": "<mốc thời gian đã nhắc>", "content": "<nội dung>"}],
  "open_issues": ["<vấn đề còn mở / chưa chốt>"]
}
owner không rõ thì ghi "(chưa rõ)", KHÔNG đoán tên. Chỉ ghi điều có trong ghi âm — không bịa người, hạn, số liệu.`;

const NAME_HINT_MAX = 80;

/** Thêm danh sách tên thành viên nhóm vào câu lệnh — để mô hình viết `owner` khớp đúng tên Zalo thật. */
export function buildRecapInstruction(memberNames: string[]): string {
  if (!memberNames.length) return MEETING_RECAP_JSON_INSTRUCTION;
  const names = memberNames.slice(0, NAME_HINT_MAX).join(", ");
  return `${MEETING_RECAP_JSON_INSTRUCTION}\nTên thành viên trong nhóm (dùng ĐÚNG các tên này cho "owner" khi khớp người đã nghe): ${names}.`;
}

export class RecapJsonParseError extends Error {}

/** Đối tượng JSON đầu tiên trong câu trả lời (chịu bọc ```json ... ``` hoặc chữ thừa trước/sau). Ném khi không đọc được. */
export function parseRecapJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new RecapJsonParseError("Mô hình không trả JSON recap");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new RecapJsonParseError("JSON recap hỏng, không đọc được");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RecapJsonParseError("JSON recap không phải một đối tượng");
  return parsed as Record<string, unknown>;
}
