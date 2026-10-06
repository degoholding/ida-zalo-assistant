// Nhận biết tin nhóm GỌI bot: @nhắc đúng tài khoản bot, hoặc có từ khóa gọi (cài đặt «Từ khóa gọi bot trong nhóm»,
// mặc định «bot», «bot ơi», «trợ lý ơi», «@bot»). Khớp không phân biệt hoa thường / dấu («bot oi» = «bot ơi»), phải là
// nguyên cụm / nguyên chữ («robot», «chatbot» không tính), ở BẤT KỲ chỗ nào trong tin (chốt 06/10/2026: «tin có chữ bot
// là gọi bot»). Phần gọi ở ĐẦU tin (kể cả sau câu chào «hey bot») được bỏ khỏi câu hỏi; nằm giữa / cuối tin thì giữ
// nguyên cả câu để mô hình hiểu đúng ý. Từ khóa dài xét trước («bot ơi …» bỏ cả «bot ơi»). Hàm thuần.

import { ContactKind, ContactRole } from "../constants.js";

export interface GroupTriggerInput {
  text: string;
  mentions: { uid: string; pos: number; len: number }[] | null;
  botUid: string;
  keywords: string[];
  /** Người viết tin được trích dẫn (nếu tin này là «Trả lời» một tin khác). */
  quotedUid?: string;
}

/**
 * Ai gọi được bot trong nhóm (chốt 06/10/2026: «nội bộ gọi được, khách hàng thì bot không chạy»): người có vai trò
 * (Quản lý / Trưởng phòng) luôn được; còn lại chỉ NHÂN SỰ, khi bật cài đặt «Trong nhóm: nhân sự gọi được bot». Khách
 * hàng và người chưa phân loại không bao giờ gọi được — bot im lặng, không trả lời.
 */
export function canCallBotInGroup(contact: { role: number; kind: number }, staffMayCall: boolean): boolean {
  if (contact.role !== ContactRole.None) return true;
  return staffMayCall && contact.kind === ContactKind.Staff;
}

/** Câu khi người gọi bot mà chưa hỏi gì («bot ơi») — để trợ lý chào và nói mình làm được gì. */
export const EMPTY_CALL_QUESTION = "Chào em";

/**
 * Bỏ dấu + chữ thường TỪNG KÝ TỰ, giữ nguyên độ dài để vị trí khớp trên bản chuẩn hóa dùng được cho chuỗi gốc.
 * Ký tự dấu rời (chuỗi đã tách dấu sẵn) thành khoảng trắng — vẫn giữ độ dài.
 */
export function foldForMatch(text: string): string {
  return Array.from(text, (char) => {
    const folded = char.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    return folded.length === 1 ? folded : folded.length === 0 ? " " : folded[0];
  }).join("");
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Câu chào ngắn được phép đứng trước từ khóa một chữ: «hey bot», «ê bot», «chào bot» (đã bỏ dấu). */
const GREETING_PREFIX = "(?:hey|hi|hello|e|alo|nay|chao)[\\s,!.]+";

function stripMentions(text: string, mentions: GroupTriggerInput["mentions"], botUid: string): { text: string; mentioned: boolean } {
  const own = (mentions ?? []).filter((mention) => mention.uid === botUid && mention.len > 0 && mention.pos >= 0);
  if (!own.length) return { text, mentioned: false };
  let result = text;
  // Cắt từ cuối lên để vị trí các đoạn phía trước không lệch
  for (const mention of [...own].sort((a, b) => b.pos - a.pos)) {
    result = `${result.slice(0, mention.pos)} ${result.slice(mention.pos + mention.len).replace(/^[\s,:;!.\-–—]+/, "")}`;
  }
  return { text: result, mentioned: true };
}

/** Câu hỏi đã bỏ phần gọi bot; null = tin này không gọi bot. */
export function detectGroupTrigger(input: GroupTriggerInput): { question: string; via: "mention" | "keyword" | "reply" } | null {
  const { text, mentioned } = stripMentions(input.text, input.mentions, input.botUid);
  let question = text;
  // Bấm «Trả lời» vào tin của bot rồi hỏi tiếp cũng là gọi bot — hỏi nối tiếp không phải gõ lại «bot»
  const replied = Boolean(input.quotedUid) && input.quotedUid === input.botUid;
  let via: "mention" | "keyword" | "reply" | null = mentioned ? "mention" : replied ? "reply" : null;
  const folded = foldForMatch(text);
  const keys = input.keywords.map((keyword) => foldForMatch(keyword.trim())).filter((key) => key.trim().length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    // Nguyên cụm: trước / sau không được là chữ hoặc số
    const pattern = escapeRegExp(key);
    const atStart = new RegExp(`^([\\s,.:;!?\\-–—]*(?:${GREETING_PREFIX})?)(${pattern})(?=$|[^a-z0-9])`).exec(folded);
    const anywhere = atStart ?? new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9])`).exec(folded);
    if (!anywhere) continue;
    if (atStart) {
      // Gọi ở đầu tin: bỏ phần gọi (+ câu chào, + dấu câu ngay sau) — «hey bot, tóm tắt» → «tóm tắt»
      question = text.slice(atStart[1].length + key.length).replace(/^[\s,:;!.\-–—]+/, "");
    } else if (/\s/.test(key)) {
      // Cụm nhiều chữ giữa câu («cho anh hỏi, trợ lý ơi: …»): bỏ cụm gọi cho câu gọn
      const start = anywhere.index + anywhere[1].length;
      question = `${text.slice(0, start)} ${text.slice(start + key.length).replace(/^[\s,:;!.\-–—]+/, "")}`;
    }
    // Một chữ («bot») giữa / cuối câu: giữ nguyên câu — bỏ đi dễ làm câu cụt nghĩa («nói chuyện với … đi»)
    via ??= "keyword";
    break;
  }
  if (!via) return null;
  const cleaned = question.replace(/\s+/g, " ").replace(/^[\s,.:;!?\-–—]+|[\s,:;\-–—]+$/g, "").trim();
  return { question: cleaned || EMPTY_CALL_QUESTION, via };
}
