import type { RowDataPacket } from "mysql2";
import { BotAccountKind, ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import type { FieldSpec, SqlPart } from "./list-query.js";

// Hội thoại theo TÀI KHOẢN Zalo (27/10/2026): một cuộc thuộc tài khoản bot nào. Nhóm ↔ tài khoản ở `bot_group` (còn ở =
// left_at IS NULL; một nhóm có thể nhiều tài khoản), cuộc riêng ở `zalo_group.owner_bot_id`. Dùng cho bộ lọc account_id
// của danh sách và nhãn tài khoản trên từng cuộc.

export interface ThreadAccount {
  id: number;
  name: string;
  kind: number;
  /** "Trợ lý" / "Chỉ thu thập". */
  kind_label: string;
}

export function accountKindLabel(kind: unknown): string {
  return Number(kind) === BotAccountKind.Normal ? "Chỉ thu thập" : "Trợ lý";
}

/** Tách id tài khoản từ tham số lọc (`account_id=3`, `account_id=3,5`, `account_id__in=3,5`) — bỏ giá trị không phải số nguyên dương. */
export function parseAccountIds(values: string[]): number[] {
  const ids = values.flatMap((value) => value.split(",")).map((value) => Number(value.trim())).filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)].slice(0, 200);
}

/** Điều kiện "cuộc thuộc một trong các tài khoản": nhóm có dòng bot_group còn ở, cuộc riêng khớp owner_bot_id. */
export function threadOfAccountsCondition(ids: number[]): SqlPart | null {
  if (!ids.length) return null;
  return {
    sql: `(g.thread_type = ${ConversationType.Direct} AND g.owner_bot_id IN (?))
      OR (g.thread_type = ${ConversationType.Group} AND EXISTS (
        SELECT 1 FROM bot_group bga WHERE bga.group_id = g.id AND bga.left_at IS NULL AND bga.bot_account_id IN (?)))`,
    params: [ids, ids],
  };
}

/** Trường lọc `account_id` cho ListSpec — eq / in đều nhận một hoặc nhiều id; ne / not_in = không thuộc các tài khoản đó. */
export const ACCOUNT_FILTER_FIELD: FieldSpec = {
  type: "number",
  build: (operator, values) => {
    const condition = threadOfAccountsCondition(parseAccountIds(values));
    if (!condition) return null;
    if (operator === "eq" || operator === "in") return condition;
    if (operator === "ne" || operator === "not_in") return { sql: `NOT (${condition.sql})`, params: condition.params };
    return null;
  },
};

/**
 * Tài khoản của cả trang trong MỘT truy vấn (không N+1): nhóm qua bot_group còn ở, cuộc riêng qua owner_bot_id.
 * Trả map id cuộc → danh sách tài khoản (xếp Trợ lý trước, rồi theo id).
 */
export async function loadThreadAccounts(db: Db, threadIds: number[]): Promise<Map<number, ThreadAccount[]>> {
  const result = new Map<number, ThreadAccount[]>();
  if (!threadIds.length) return result;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT bg.group_id AS thread_id, b.id, COALESCE(NULLIF(b.display_name, ''), b.label) AS name, b.kind
       FROM bot_group bg JOIN bot_account b ON b.id = bg.bot_account_id
      WHERE bg.left_at IS NULL AND bg.group_id IN (?)
     UNION ALL
     SELECT g.id AS thread_id, b.id, COALESCE(NULLIF(b.display_name, ''), b.label) AS name, b.kind
       FROM zalo_group g JOIN bot_account b ON b.id = g.owner_bot_id
      WHERE g.thread_type = ${ConversationType.Direct} AND g.id IN (?)
     ORDER BY thread_id, kind, id`,
    [threadIds, threadIds]);
  for (const row of rows) {
    const threadId = Number(row.thread_id);
    const list = result.get(threadId) ?? [];
    if (!list.some((account) => account.id === Number(row.id))) {
      list.push({ id: Number(row.id), name: String(row.name ?? `Bot #${row.id}`), kind: Number(row.kind), kind_label: accountKindLabel(row.kind) });
    }
    result.set(threadId, list);
  }
  return result;
}

/** Ô lọc Tài khoản ở màn Hội thoại: mọi tài khoản bot (kể cả đã tắt, vì tin cũ vẫn còn) — chỉ id, tên, loại. */
export async function listAccountOptions(db: Db): Promise<ThreadAccount[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, COALESCE(NULLIF(display_name, ''), label) AS name, kind, is_active FROM bot_account ORDER BY is_active DESC, kind, id");
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name ?? `Bot #${row.id}`), kind: Number(row.kind), kind_label: accountKindLabel(row.kind) }));
}
