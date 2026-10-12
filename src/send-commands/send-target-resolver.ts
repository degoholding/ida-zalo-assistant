import type { RowDataPacket } from "mysql2";
import { resolveAlertAsker } from "../assistant/alert-tools.js";
import { ContactKind, ConversationType, GroupKind, SendTargetKind, type FriendRequestStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { cleanPersonName, searchContactsByName } from "../sync/contact-search.js";
import {
  isAllowedGroupTarget, isAllowedPersonTarget, isFakeZaloId, type SendGroupCandidate, type SendGroupScope, type SendPersonCandidate,
} from "./send-command-permissions.js";
import type { SendRequester, SendTargetRow } from "./send-command-types.js";
import { describeChoices, pickTarget, type PickResult, type TargetCandidate } from "./send-target-matcher.js";

// Nạp ứng viên nơi nhận từ DB rồi áp luật quyền (send-command-permissions.ts) + chọn đúng một nơi (send-target-matcher.ts).
// Dùng ở cả ba bước: lúc nháp, lúc xác nhận, lúc giao (vai trò / loại nhóm / phạm vi có thể đổi trong lúc chờ hẹn).

const CANDIDATE_LIMIT = 8;
const GROUP_PREFIX = /^(?:nhóm|nhom|group)\s+/iu;

/** Người ra lệnh theo mã Zalo, null nếu không còn là người nhận đang bật và cũng không có vai trò. */
export async function loadSendRequester(db: Db, uid: string): Promise<SendRequester | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT zalo_uid, display_name, zalo_name, role FROM contact WHERE zalo_uid = ? LIMIT 1", [uid]);
  return rows[0] ? resolveAlertAsker(db, rows[0] as Parameters<typeof resolveAlertAsker>[1]) : null;
}

/** Nhóm người ra lệnh đã CHỌN ở màn Người nhận (`recipient_group`) — «mọi nhóm» không tính cho nhóm Mật. */
export async function loadGroupScope(db: Db, recipientId: number | null): Promise<SendGroupScope> {
  if (!recipientId) return { selectedGroupIds: [] };
  const [rows] = await db.query<RowDataPacket[]>("SELECT group_id FROM recipient_group WHERE recipient_id = ? LIMIT 500", [recipientId]);
  return { selectedGroupIds: rows.map((row) => Number(row.group_id)) };
}

/** `forReminder`: lệnh nhắc hẹn — màn Hội thoại trên web không tạo được nhắc hẹn, nên chỉ cách khác (gọi bot ngay trong nhóm). */
function explainGroupRefusal(group: SendGroupCandidate, forReminder: boolean): string {
  if (group.threadType !== ConversationType.Group) return "không phải nhóm";
  if (group.groupKind !== GroupKind.Internal) {
    return forReminder ? "là nhóm khách — nhắc hẹn từ tin riêng chỉ tạo cho nhóm nội bộ" : "là nhóm khách — gửi từ màn Hội thoại trên web";
  }
  if (isFakeZaloId(group.zaloGroupId)) return "là nhóm mẫu, không có thật bên Zalo";
  if (!group.botStillInGroup) return "bot không còn ở trong nhóm";
  return `là nhóm Mật — chỉ người nhận đã chọn đúng nhóm này mới ${forReminder ? "tạo nhắc hẹn" : "gửi"} được`;
}

function explainPersonRefusal(person: SendPersonCandidate): string {
  if (person.isBotAccount) return "là tài khoản bot";
  if (person.kind !== ContactKind.Staff) return "không phải nhân sự nội bộ — gửi từ màn Hội thoại trên web";
  if (isFakeZaloId(person.zaloUid)) return "là người mẫu, không có thật bên Zalo";
  return "bot chưa có cuộc riêng hoặc chưa là bạn Zalo với người này";
}

const GROUP_SELECT = `SELECT g.id, g.zalo_group_id, g.name, g.label, g.thread_type, g.group_kind, g.is_confidential,
  EXISTS (SELECT 1 FROM bot_group bg WHERE bg.group_id = g.id AND bg.left_at IS NULL) AS bot_in_group
  FROM zalo_group g`;

function toGroupCandidate(row: RowDataPacket, scope: SendGroupScope, forReminder = false): TargetCandidate {
  const group: SendGroupCandidate = {
    id: Number(row.id), threadType: Number(row.thread_type), groupKind: Number(row.group_kind), isConfidential: Number(row.is_confidential) === 1,
    botStillInGroup: Number(row.bot_in_group) === 1, zaloGroupId: String(row.zalo_group_id),
  };
  const allowed = isAllowedGroupTarget(group, scope);
  const displayName = String(row.label || row.name || "");
  return {
    target: { kind: SendTargetKind.Group, key: `g:${group.id}`, threadId: group.id, zaloUid: null, displayName },
    names: [String(row.label ?? ""), String(row.name ?? "")], allowed, reason: allowed ? "" : explainGroupRefusal(group, forReminder), secret: group.isConfidential,
  };
}

async function loadGroupCandidates(db: Db, query: string, scope: SendGroupScope, forReminder = false): Promise<TargetCandidate[]> {
  if (!query) return [];
  const like = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    `${GROUP_SELECT} WHERE g.thread_type = ? AND (g.name LIKE ? OR g.label LIKE ?)
     ORDER BY (g.name = ? OR g.label = ?) DESC, g.name LIMIT ?`,
    [ConversationType.Group, like, like, query, query, CANDIDATE_LIMIT]);
  return rows.map((row) => toGroupCandidate(row, scope, forReminder));
}

interface PersonFacts {
  threadByUid: Map<string, number>;
  friendByUid: Map<string, FriendRequestStatus>;
  /** Mã Zalo của chính các tài khoản bot — không là nơi nhận */
  botUids: Set<string>;
}

async function loadPersonFacts(db: Db, uids: string[]): Promise<PersonFacts> {
  const facts: PersonFacts = { threadByUid: new Map(), friendByUid: new Map(), botUids: new Set() };
  if (!uids.length) return facts;
  const [threads] = await db.query<RowDataPacket[]>(
    "SELECT id, zalo_group_id FROM zalo_group WHERE thread_type = ? AND zalo_group_id IN (?) ORDER BY last_message_at DESC LIMIT 200",
    [ConversationType.Direct, uids]);
  for (const row of threads) if (!facts.threadByUid.has(String(row.zalo_group_id))) facts.threadByUid.set(String(row.zalo_group_id), Number(row.id));
  const [friends] = await db.query<RowDataPacket[]>(
    "SELECT zalo_uid, status FROM friend_request WHERE zalo_uid IN (?) ORDER BY requested_at DESC LIMIT 200", [uids]);
  for (const row of friends) if (!facts.friendByUid.has(String(row.zalo_uid))) facts.friendByUid.set(String(row.zalo_uid), Number(row.status));
  const [bots] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM bot_account WHERE zalo_uid IN (?) LIMIT 200", [uids]);
  for (const row of bots) facts.botUids.add(String(row.zalo_uid));
  return facts;
}

function toPersonCandidate(contact: { uid: string; name: string; kind: number }, facts: PersonFacts): TargetCandidate {
  const threadId = facts.threadByUid.get(contact.uid) ?? null;
  const person: SendPersonCandidate = {
    kind: contact.kind, zaloUid: contact.uid, isBotAccount: facts.botUids.has(contact.uid), hasDirectThread: threadId !== null,
    friendStatus: facts.friendByUid.get(contact.uid) ?? null,
  };
  const allowed = isAllowedPersonTarget(person);
  return {
    // Có cuộc riêng thì giao theo threadId, chưa có thì theo mã Zalo (đúng hình ContactMessagePayload)
    target: { kind: SendTargetKind.Person, key: `u:${contact.uid}`, threadId, zaloUid: threadId ? null : contact.uid, displayName: contact.name },
    names: [contact.name], allowed, reason: allowed ? "" : explainPersonRefusal(person), secret: false,
  };
}

async function loadPersonCandidates(db: Db, rawName: string): Promise<TargetCandidate[]> {
  // Thử cả tên nguyên lẫn tên đã bỏ xưng hô («Anh Thư» là tên thật)
  const queries = [...new Set([rawName, cleanPersonName(rawName)].filter(Boolean))];
  const found = new Map<string, { uid: string; name: string; kind: number }>();
  for (const query of queries) {
    for (const match of await searchContactsByName(db, query, { limit: CANDIDATE_LIMIT })) found.set(match.uid, match);
  }
  const facts = await loadPersonFacts(db, [...found.keys()]);
  return [...found.values()].map((contact) => toPersonCandidate(contact, facts));
}

export type ResolveOutcome = { ok: true; candidate: TargetCandidate } | { ok: false; problem: string };

function toOutcome(name: string, picked: PickResult, doing = "Không gửi được tới"): ResolveOutcome {
  switch (picked.kind) {
    case "ok": return { ok: true, candidate: picked.candidate };
    case "ambiguous": return { ok: false, problem: describeChoices(name, picked.choices) };
    case "notAllowed": return { ok: false, problem: `${doing} «${name}»: ${picked.reason}.` };
    default: return { ok: false, problem: `Em không thấy nơi nhận nào tên «${name}» (nhóm nội bộ hoặc nhân sự).` };
  }
}

/** Một tên → đúng một nơi hợp lệ, hoặc câu giải thích (không thấy / mơ hồ / không được phép). */
export async function resolveTargetName(db: Db, rawName: string, scope: SendGroupScope): Promise<ResolveOutcome> {
  const name = rawName.normalize("NFC").trim();
  const wantsGroup = GROUP_PREFIX.test(name);
  const groups = await loadGroupCandidates(db, name.replace(GROUP_PREFIX, "").trim(), scope);
  const people = wantsGroup ? [] : await loadPersonCandidates(db, name);
  return toOutcome(name, pickTarget(name, [...groups, ...people]));
}

/**
 * Một tên → đúng một NHÓM hợp lệ (nhắc hẹn Zalo chỉ tạo cho nhóm). Không có nhóm nào khớp mà tên lại trỏ tới một người thì
 * từ chối rõ «nhắc hẹn chỉ tạo cho nhóm», không đoán sang nhóm khác.
 */
export async function resolveGroupName(db: Db, rawName: string, scope: SendGroupScope): Promise<ResolveOutcome> {
  const name = rawName.normalize("NFC").trim();
  const groups = await loadGroupCandidates(db, name.replace(GROUP_PREFIX, "").trim(), scope, true);
  const picked = pickTarget(name, groups);
  if (picked.kind !== "notFound") return toOutcome(name, picked, "Không tạo được nhắc hẹn cho");
  if (!GROUP_PREFIX.test(name) && (await loadPersonCandidates(db, name)).length) {
    return { ok: false, problem: `«${name}» là một người, không phải nhóm — nhắc hẹn chỉ tạo cho nhóm.` };
  }
  return { ok: false, problem: `Em không thấy nhóm nội bộ nào tên «${name}».` };
}

/** Kiểm lại một nơi nhận đã lưu còn hợp lệ không (lúc xác nhận / giao). null = còn hợp lệ, ngược lại là lý do. */
export async function checkTargetStillAllowed(
  db: Db, target: Pick<SendTargetRow, "kind" | "key" | "threadId">, scope: SendGroupScope, forReminder = false,
): Promise<string | null> {
  if (target.kind === SendTargetKind.Group) {
    const [rows] = await db.query<RowDataPacket[]>(`${GROUP_SELECT} WHERE g.id = ? LIMIT 1`, [target.threadId]);
    if (!rows[0]) return "nhóm không còn trong hệ thống";
    const candidate = toGroupCandidate(rows[0], scope, forReminder);
    return candidate.allowed ? null : candidate.reason;
  }
  const uid = target.key.slice(2);
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT zalo_uid, COALESCE(NULLIF(display_name, ''), zalo_name) AS name, kind FROM contact WHERE zalo_uid = ? LIMIT 1", [uid]);
  if (!rows[0]) return "người nhận không còn trong danh bạ";
  const candidate = toPersonCandidate({ uid, name: String(rows[0].name ?? ""), kind: Number(rows[0].kind) }, await loadPersonFacts(db, [uid]));
  return candidate.allowed ? null : candidate.reason;
}

/** Phân giải cả danh sách tên: gom MỌI lỗi (không nháp nửa vời); bỏ nơi trùng. */
export async function resolveTargetNames(
  db: Db, names: string[], scope: SendGroupScope, resolveOne: typeof resolveTargetName = resolveTargetName,
): Promise<{ targets: TargetCandidate[]; problems: string[] }> {
  const targets = new Map<string, TargetCandidate>();
  const problems: string[] = [];
  for (const name of names) {
    const outcome = await resolveOne(db, name, scope);
    if (outcome.ok) targets.set(outcome.candidate.target.key, outcome.candidate);
    else problems.push(outcome.problem);
  }
  return { targets: [...targets.values()], problems };
}
