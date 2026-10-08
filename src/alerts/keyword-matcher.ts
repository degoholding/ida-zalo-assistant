// So từ khóa KHẨN / QUAN TRỌNG trong một tin (phase 5, IDA câu 6).
//
// Bỏ dấu để so là cách dễ báo nhầm nhất: «gặp» bỏ dấu thành «gap» = «gấp», «gian hàng» = «giận», «chui» = «chửi». Nên:
// - Tin CÓ gõ dấu → so ĐÚNG DẤU, nguyên từ / nguyên cụm («gặp anh» không khớp «gấp»).
// - Tin gõ KHÔNG dấu → cụm nhiều chữ («khieu nai», «tra hang») vẫn khớp thẳng; từ MỘT chữ («gap», «khan») chỉ là ỨNG VIÊN —
//   AI đọc lại xác nhận mới tính.
// - Từ «nghiêm» («la», «liền», «ngay» — IDA thêm, rất hay gặp trong câu thường): luôn chỉ là ứng viên, so đúng dấu,
//   nguyên từ (đại ca chốt 08/10/2026). «la» không khớp «là», «lá», «lại».

export interface KeywordSets {
  urgent: string[];
  important: string[];
  /** Từ chỉ là ứng viên khẩn, cần AI xác nhận. */
  strict: string[];
}

export interface KeywordMatch {
  urgent: string[];
  important: string[];
  /** Ứng viên khẩn cần AI xác nhận (từ nghiêm, hoặc từ khẩn một chữ trong tin không dấu). */
  strict: string[];
}

/** Bỏ dấu, viết thường, mọi ký tự không phải chữ / số thành dấu cách — để so nguyên từ. */
export function foldText(text: string): string {
  return ` ${text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Giữ dấu (dạng NFC), viết thường, tách theo ký tự không phải chữ / số — để so nguyên từ ĐÚNG DẤU. */
export function exactWordText(text: string): string {
  return ` ${text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/** Tin có gõ dấu tiếng Việt không (một ký tự có dấu là đủ). */
export function hasVietnameseMarks(text: string): boolean {
  return /[̀-ͯ]/.test(text.normalize("NFD")) || /[đĐ]/.test(text);
}

/** Danh sách từ khóa trong ô cài đặt («gấp, khẩn, …») → mảng, bỏ trống, bỏ trùng. */
export function parseKeywordList(raw: string): string[] {
  return [...new Set(raw.split(/[,;\n]/).map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0 && item.length <= 60))];
}

const isSingleWord = (word: string) => exactWordText(word).trim().split(" ").length === 1;

export function matchKeywords(text: string, sets: KeywordSets): KeywordMatch {
  const exact = exactWordText(text);
  const withMarks = hasVietnameseMarks(text);
  const folded = withMarks ? "" : foldText(text);
  const inExact = (word: string) => {
    const needle = exactWordText(word);
    return needle.trim().length > 0 && exact.includes(needle);
  };
  const inFolded = (word: string) => {
    const needle = foldText(word);
    return needle.trim().length > 0 && folded.includes(needle);
  };
  const result: KeywordMatch = { urgent: [], important: [], strict: [] };
  for (const [list, target] of [[sets.urgent, "urgent"], [sets.important, "important"]] as const) {
    for (const word of list) {
      if (withMarks) {
        if (inExact(word)) result[target].push(word);
      } else if (inFolded(word)) {
        // Không dấu + một chữ: trùng nghĩa quá nhiều — chỉ là ứng viên khẩn (quan trọng một chữ thì bỏ)
        if (!isSingleWord(word)) result[target].push(word);
        else if (target === "urgent") result.strict.push(word);
      }
    }
  }
  for (const word of sets.strict) if (inExact(word) && !result.strict.includes(word)) result.strict.push(word);
  return result;
}
