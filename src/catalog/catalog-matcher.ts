import { CatalogKind, CatalogMatchStatus, ContactKind } from "../constants.js";
import type { MatchCandidate, MatchContact, MatchEntryInput, MatchResult } from "./catalog-types.js";
import { matchName } from "./catalog-text.js";

// Khớp một dòng danh mục với Danh bạ Zalo. Hàm thuần, không đụng DB.
//  - SĐT trùng đúng 1 liên hệ chưa gắn mục khác → Matched (SĐT thắng tên).
//  - Tên gấp dấu trùng đúng 1 liên hệ đúng loại, chưa gắn mục khác → Matched.
//  - Còn lại có ứng viên (trùng nhiều người, sai loại, đã gắn mục khác, khớp một phần) → Suggested (≤ 5).
//  - Không ứng viên → Unmatched.

const MAX_CANDIDATES = 5;
const SCORE_EXACT = 1;
const SCORE_PARTIAL = 0.6;
const SCORE_LAST_TOKEN = 0.5;

/** NV ↔ Nhân sự; đại lý ↔ Khách hàng / Chưa phân loại. */
function rightKind(entryKind: CatalogKind, contactKind: number): boolean {
  if (entryKind === CatalogKind.Staff) return contactKind === ContactKind.Staff;
  return contactKind === ContactKind.Customer || contactKind === ContactKind.Unclassified;
}

function toCandidates(scored: Map<number, { contact: MatchContact; score: number }>): MatchCandidate[] {
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.contact.id - b.contact.id)
    .slice(0, MAX_CANDIDATES)
    .map(({ contact, score }) => ({ contactId: contact.id, name: contact.name, score }));
}

/** Điểm khớp một phần giữa hai tên đã gấp dấu (0 = không liên quan). */
function partialScore(entryTokens: string[], contactTokens: string[]): number {
  if (!entryTokens.length || !contactTokens.length) return 0;
  if (entryTokens.length >= 2 && contactTokens.length >= 2) {
    const sameEnds = entryTokens[0] === contactTokens[0] && entryTokens.at(-1) === contactTokens.at(-1);
    const subset = (small: string[], big: string[]): boolean => small.every((token) => big.includes(token));
    return sameEnds || subset(entryTokens, contactTokens) || subset(contactTokens, entryTokens) ? SCORE_PARTIAL : 0;
  }
  // Một bên chỉ có tên gọi (vd «Huy»): trùng từ cuối của bên kia
  const [single, other] = entryTokens.length === 1 ? [entryTokens[0], contactTokens] : [contactTokens[0], entryTokens];
  return other.at(-1) === single ? SCORE_LAST_TOKEN : 0;
}

export function matchCatalogEntry(entry: MatchEntryInput, contacts: MatchContact[], linkedContactIds: ReadonlySet<number>): MatchResult {
  const scored = new Map<number, { contact: MatchContact; score: number }>();

  if (entry.phone) {
    const byPhone = contacts.filter((contact) => contact.phone === entry.phone);
    if (byPhone.length === 1 && !linkedContactIds.has(byPhone[0].id)) {
      return { status: CatalogMatchStatus.Matched, contactId: byPhone[0].id, candidates: [] };
    }
    for (const contact of byPhone) scored.set(contact.id, { contact, score: SCORE_EXACT });
  }

  const name = matchName(entry.name);
  const entryTokens = name ? name.split(" ") : [];
  if (entryTokens.length) {
    const exact: MatchContact[] = [];
    for (const contact of contacts) {
      const contactName = matchName(contact.name);
      if (!contactName) continue;
      if (contactName === name) {
        exact.push(contact);
        scored.set(contact.id, { contact, score: SCORE_EXACT });
        continue;
      }
      const score = partialScore(entryTokens, contactName.split(" "));
      const known = scored.get(contact.id);
      if (score > 0 && (!known || known.score < score)) scored.set(contact.id, { contact, score });
    }
    const sure = exact.length === 1 && rightKind(entry.kind, exact[0].kind) && !linkedContactIds.has(exact[0].id);
    // Đã có ứng viên theo SĐT (trùng nhiều người) thì không tự gắn theo tên
    const phoneAmbiguous = entry.phone !== "" && contacts.some((contact) => contact.phone === entry.phone);
    if (sure && !phoneAmbiguous) return { status: CatalogMatchStatus.Matched, contactId: exact[0].id, candidates: [] };
  }

  const candidates = toCandidates(scored);
  return candidates.length
    ? { status: CatalogMatchStatus.Suggested, candidates }
    : { status: CatalogMatchStatus.Unmatched, candidates: [] };
}
