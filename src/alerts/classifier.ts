import { ContactKind, FlagSource, GroupKind, MessagePriority } from "../constants.js";
import { matchKeywords, type KeywordSets } from "./keyword-matcher.js";

// Phân loại MỘT tin nhóm vừa tới (phase 5, N1) — hàm thuần, chạy ngay lúc nhận tin (vài mili giây, không gọi AI).
// Kết quả: có gắn cờ không, mức ưu tiên, có cần ai trả lời không (đồng hồ chờ), dành cho người nhận nào, có cần AI
// xác nhận không. Luật theo IDA câu 6–8.

export interface ClassifyInput {
  text: string;
  senderUid: string;
  senderKind: ContactKind;
  groupKind: GroupKind;
  /** uid những người bị nhắc tên (@) trong tin */
  mentionUids: string[];
  /** uid người viết tin được trích dẫn (trả lời vào tin của ai) */
  quoteOwnerUid: string | null;
}

export interface ClassifyContext {
  keywords: KeywordSets;
  /** uid Zalo của các người nhận đang bật */
  recipientUids: Set<string>;
  /** uid Zalo của mọi người VIP (của bất kỳ người nhận nào) */
  vipUids: Set<string>;
  /** uid các tài khoản bot — tin của bot không phân loại */
  botUids: Set<string>;
}

export type WaitKind = "normal" | "vip";

export interface ClassifyDecision {
  priority: MessagePriority;
  source: FlagSource;
  reason: string;
  /** Có cần ai trả lời không — có thì đồng hồ chờ chạy */
  wait: WaitKind | null;
  /** Dành riêng cho một người nhận (tin nhắc tên / trả lời đúng người đó) */
  forUid: string | null;
  /** Ứng viên khẩn chờ AI xác nhận */
  pendingAi: boolean;
}

const QUESTION_PATTERN = /\?|\b(không|chưa|sao|nào|bao giờ|bao nhiêu|ở đâu|thế nào|được ko|được không|khi nào)\s*[.!?…]*\s*$/iu;

/** Câu hỏi của khách: có dấu hỏi, hoặc kết bằng từ hỏi thường gặp. */
export function looksLikeQuestion(text: string): boolean {
  return QUESTION_PATTERN.test(text.trim());
}

const quoteList = (words: string[]) => words.map((word) => `«${word}»`).join(", ");

/** null = tin thường, không gắn cờ (AI vẫn có thể đọc lại sau theo lô). */
export function classifyMessage(input: ClassifyInput, context: ClassifyContext): ClassifyDecision | null {
  if (context.botUids.has(input.senderUid) || !input.text.trim()) return null;
  const match = matchKeywords(input.text, context.keywords);
  const reasons: string[] = [];
  let priority = MessagePriority.Normal;
  let source: FlagSource | null = null;
  let wait: WaitKind | null = null;
  let forUid: string | null = null;

  if (match.urgent.length) {
    priority = MessagePriority.Urgent;
    source = FlagSource.Keyword;
    reasons.push(`từ khóa khẩn ${quoteList(match.urgent)}`);
  }
  const fromVip = context.vipUids.has(input.senderUid) && !context.recipientUids.has(input.senderUid);
  if (fromVip) {
    priority = Math.max(priority, MessagePriority.Important);
    source ??= FlagSource.Vip;
    wait = "vip";
    reasons.push("tin của người VIP");
  }
  // Nhắc tên / trả lời vào tin của một người nhận → người đó cần trả lời
  const addressed = [...input.mentionUids, ...(input.quoteOwnerUid ? [input.quoteOwnerUid] : [])]
    .find((uid) => context.recipientUids.has(uid) && uid !== input.senderUid);
  if (addressed) {
    priority = Math.max(priority, MessagePriority.Important);
    source ??= FlagSource.Mention;
    wait ??= "normal";
    forUid = addressed;
    reasons.push("nhắc tên / hỏi thẳng người nhận");
  }
  if (match.important.length) {
    priority = Math.max(priority, MessagePriority.Important);
    source ??= FlagSource.Keyword;
    reasons.push(`từ khóa quan trọng ${quoteList(match.important)}`);
  }
  // Câu hỏi của khách trong nhóm khách hàng chưa ai trả lời (IDA câu 7, ý 3)
  if (input.groupKind === GroupKind.Customer && input.senderKind === ContactKind.Customer && looksLikeQuestion(input.text)) {
    wait ??= "normal";
    source ??= FlagSource.Keyword;
    reasons.push("câu hỏi của khách");
  }
  const pendingAi = match.strict.length > 0 && priority < MessagePriority.Urgent;
  if (pendingAi) reasons.push(`có từ ${quoteList(match.strict)} — chờ AI xác nhận`);
  if (!source && !pendingAi) return null;
  return {
    priority, source: source ?? FlagSource.Keyword, reason: reasons.join("; ").slice(0, 300), wait, forUid, pendingAi,
  };
}
