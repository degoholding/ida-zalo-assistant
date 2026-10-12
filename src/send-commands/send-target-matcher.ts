import { SendTargetKind } from "../constants.js";
import { cleanPersonName } from "../sync/contact-search.js";
import type { ResolvedTarget } from "./send-command-types.js";

// Chọn ĐÚNG MỘT nơi nhận cho một tên người gõ (phase 9). Không đoán: mơ hồ → liệt kê, không thấy → báo, không được phép →
// nêu lý do. Hàm thuần — resolver nạp ứng viên từ DB (đã áp luật quyền thành `allowed` + `reason`) rồi gọi vào đây.

export interface TargetCandidate {
  target: ResolvedTarget;
  /** Mọi tên có thể gõ để gọi nơi này (tên nhóm + nhãn, tên hiển thị + tên Zalo) */
  names: string[];
  /** Qua luật quyền (send-command-permissions.ts) chưa */
  allowed: boolean;
  /** Lý do không được phép (hiện cho người gõ) */
  reason: string;
  /** Nhóm Mật nội bộ */
  secret: boolean;
}

export type PickResult =
  | { kind: "ok"; candidate: TargetCandidate }
  | { kind: "ambiguous"; choices: TargetCandidate[] }
  | { kind: "notFound" }
  | { kind: "notAllowed"; reason: string; name: string };

/** Bỏ dấu, chữ thường, gọn khoảng trắng — so khớp tên không phân biệt dấu. */
export function foldName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();
}

const GROUP_PREFIX = /^(?:nhom|group)\s+(.+)$/;
const PERSON_PREFIX = /^(?:anh|chi|em|co|chu|bac|ban|a|c|e)\s+(.+)$/;

/** Nhãn một lựa chọn: «nhóm «Kho HN»» / «anh/chị Minh». */
export function describeCandidate(candidate: TargetCandidate): string {
  const { target } = candidate;
  return target.kind === SendTargetKind.Group ? `nhóm «${target.displayName}»` : `anh/chị ${target.displayName}`;
}

/** Câu hỏi lại khi mơ hồ: «Có 2 nơi khớp «Kho»: 1. nhóm «Kho HN» 2. anh/chị Kho …». */
export function describeChoices(name: string, choices: TargetCandidate[]): string {
  const hasBothKinds = new Set(choices.map((choice) => choice.target.kind)).size > 1;
  const hint = hasBothKinds ? "Anh/chị ghi rõ «nhóm …» hoặc «anh …» giúp em." : "Anh/chị ghi rõ tên đầy đủ giúp em.";
  return [`«${name}» khớp ${choices.length} nơi:`, ...choices.map((choice, index) => `${index + 1}. ${describeCandidate(choice)}`), hint].join("\n");
}

function matchLevel(query: string, names: string[]): 0 | 1 | 2 {
  const folded = names.map(foldName).filter(Boolean);
  if (folded.some((name) => name === query)) return 2;
  return folded.some((name) => name.includes(query)) ? 1 : 0;
}

/** Nhóm (tiền tố «nhóm»), người (xưng hô), hoặc cả hai. Khớp đúng tên thắng khớp một phần; chỉ xét nơi ĐƯỢC PHÉP khi còn lựa chọn. */
export function pickTarget(rawName: string, candidates: TargetCandidate[]): PickResult {
  const name = rawName.normalize("NFC").trim();
  const folded = foldName(name);
  if (!folded) return { kind: "notFound" };
  const groupQuery = folded.match(GROUP_PREFIX)?.[1];
  const personQuery = folded.match(PERSON_PREFIX)?.[1];
  const cleanedPerson = foldName(cleanPersonName(name));

  const scored = candidates.flatMap((candidate) => {
    const isGroup = candidate.target.kind === SendTargetKind.Group;
    // Người: thử cả tên đã bỏ xưng hô lẫn tên nguyên («Anh Thư» là tên thật)
    const queries = isGroup ? (personQuery ? [] : [groupQuery ?? folded]) : (groupQuery ? [] : [...new Set([folded, personQuery ?? cleanedPerson])]);
    const level = Math.max(0, ...queries.map((query) => (query ? matchLevel(query, candidate.names) : 0)));
    return level ? [{ candidate, level }] : [];
  });
  if (!scored.length) return { kind: "notFound" };

  // Khớp đúng tên (kể cả nơi bị cấm) thắng khớp một phần: «Kho» là nhóm khách thì không âm thầm đổi sang «Kho HN»
  const top = Math.max(...scored.map((item) => item.level));
  const pool = scored.filter((item) => item.level === top).map((item) => item.candidate);
  const allowed = pool.filter((candidate) => candidate.allowed);
  if (!allowed.length) return { kind: "notAllowed", reason: pool[0].reason, name };
  if (allowed.length === 1) return { kind: "ok", candidate: allowed[0] };
  return { kind: "ambiguous", choices: allowed.slice(0, 8) };
}
