import type { Db } from "../../db/pool.js";
import { cleanPersonName, describeContactChoices, pickContactMatch, searchContactsByName, type ContactMatch } from "../../sync/contact-search.js";
import type { SqlPart } from "../../web/api/list-query.js";
import { DataAccessError } from "../data-access-errors.js";

// Phân giải TÊN NGƯỜI (người dùng gõ «Minh», «anh Nam») ra đúng một liên hệ trong Danh bạ — cho công cụ giao việc / người xử lý / VIP... Cùng
// kết quả với `resolveAssignee` của lệnh việc gõ: bỏ xưng hô, ưu tiên thành viên của nhóm đang nói, rồi khớp đúng tên. Mặc định KHÔNG lọc theo
// phạm vi Danh bạ (giữ hành vi cũ); MCP ngoài truyền `scope` (`contactScopeSql`) để chỉ thấy người trong phạm vi.

export interface PersonResolveOptions {
  /** Ưu tiên (và khớp cả tên hiển thị trong) nhóm này — nhóm đang hỏi, hoặc cuộc đang nhắn khi ở tin riêng. */
  groupId?: number | null;
  /** Điều kiện phạm vi trên bảng `contact` (bí danh `c`). */
  scope?: SqlPart | null;
  limit?: number;
}

export type PersonResolution =
  | { kind: "one"; name: string; contact: ContactMatch }
  | { kind: "many"; name: string; choices: ContactMatch[] }
  | { kind: "none"; name: string };

export async function resolvePersonName(db: Db, rawName: string, options: PersonResolveOptions = {}): Promise<PersonResolution> {
  const name = cleanPersonName(rawName);
  const matches = await searchContactsByName(db, name, { groupId: options.groupId, scope: options.scope, limit: options.limit });
  if (!matches.length) return { kind: "none", name };
  const picked = pickContactMatch(matches);
  return picked ? { kind: "one", name, contact: picked } : { kind: "many", name, choices: matches };
}

/** Đúng một người, hoặc lỗi lõi: `not_found` (không ai) / `ambiguous` (kèm `choices`; câu mô tả cũ ở `message` để lớp lệnh dùng lại). */
export async function requireOnePerson(db: Db, rawName: string, retryHint: string, options: PersonResolveOptions = {}): Promise<ContactMatch> {
  const result = await resolvePersonName(db, rawName, options);
  if (result.kind === "one") return result.contact;
  if (result.kind === "none") throw new DataAccessError("not_found", `Em không tìm thấy ai tên «${result.name}» trong Danh bạ. Anh/chị nhắn lại «${retryHint}» với tên đầy đủ giúp em.`);
  throw new DataAccessError("ambiguous", describeContactChoices(result.choices, result.name, retryHint), undefined,
    { choices: result.choices.map((choice) => ({ id: choice.id, name: choice.name, kind: choice.kind })) });
}
