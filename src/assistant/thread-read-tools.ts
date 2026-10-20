// mcp-guard: legacy(reads) — list_groups / get_group_messages / find_people bằng SQL; phase 6 chuyển sang họ `reads`
import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../constants.js";
import { threadVisibilitySql } from "../data-access/visibility-guards.js";
import type { Db } from "../db/pool.js";
import { CONFIDENTIAL_ERROR, askerContactScope, relaxConfidential, type AskerAccess } from "./infra/asker-access.js";
import { MAX_MESSAGES, MESSAGE_SELECT, formatLines, formatVn, parseTime, type MessageLineRow } from "./message-line-format.js";

// Bốn công cụ đọc theo cuộc / người của trợ lý (list_groups, get_group_messages, find_people, get_conversation_with_person).
// Phạm vi KHÔNG tự viết ở đây: mọi điều kiện «được thấy cuộc» đến từ `threadVisibilitySql` của lõi truy cập dữ liệu với
// ngữ cảnh người hỏi (xem asker-access.ts) — cuộc riêng của người khác, nhóm ngoài phạm vi, nhóm Mật khi chưa cấp cờ đều bị loại.

export interface ThreadToolContext {
  db: Db;
  askerUid: string;
  now: Date;
  access: AskerAccess;
  /** Hỏi trong nhóm: khóa vào nhóm này. */
  scopeGroupId?: number;
}

export async function listGroups(context: ThreadToolContext, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const visible = threadVisibilitySql(context.access, "g");
  const [rows] = await context.db.query<RowDataPacket[]>(
    `SELECT g.id, g.name, g.label, c.name AS company,
            (SELECT COUNT(*) FROM message m WHERE m.group_id = g.id) AS message_count,
            (SELECT MAX(m.sent_at) FROM message m WHERE m.group_id = g.id) AS last_message_at
     FROM zalo_group g LEFT JOIN company c ON c.id = g.company_id
     WHERE g.thread_type = ? AND ${visible.sql}
       AND (? = '' OR g.name LIKE ? OR g.label LIKE ?) AND (? = 0 OR g.id = ?)
     ORDER BY last_message_at DESC LIMIT 50`,
    [ConversationType.Group, ...visible.params, query, `%${query}%`, `%${query}%`, context.scopeGroupId ?? 0, context.scopeGroupId ?? 0],
  );
  return {
    groups: rows.map((row) => ({
      id: row.id,
      name: row.name,
      short_name: row.label,
      company: row.company ?? "",
      message_count: row.message_count,
      last_message: row.last_message_at ? formatVn(row.last_message_at) : "",
    })),
  };
}

export async function getGroupMessages(context: ThreadToolContext, args: Record<string, unknown>) {
  const groupId = context.scopeGroupId ?? Number(args.group_id);
  const to = parseTime(args.to, context.now);
  const from = parseTime(args.from, new Date(to.getTime() - 86_400_000));
  if (!Number.isSafeInteger(groupId) || groupId <= 0) return { error: "Thiếu hoặc sai group_id — gọi list_groups để lấy id đúng." };
  const find = (access: AskerAccess) => {
    const visible = threadVisibilitySql(access, "g");
    return context.db.query<RowDataPacket[]>(
      `SELECT g.id, g.name FROM zalo_group g WHERE g.id = ? AND g.thread_type = ? AND ${visible.sql}`, [groupId, ConversationType.Group, ...visible.params]);
  };
  const [groups] = await find(context.access);
  if (!groups.length) {
    // Thấy được nếu bỏ chặn Mật (vẫn trong phạm vi người hỏi) = bị Mật chặn; không thì như «không có» (không lộ nhóm ngoài phạm vi)
    if (!context.access.includeConfidential) {
      const [hidden] = await find(relaxConfidential(context.access));
      if (hidden.length) return { error: CONFIDENTIAL_ERROR };
    }
    return { error: "Không có nhóm này hoặc nhóm không được lưu tin — gọi list_groups để lấy id đúng." };
  }
  const [rows] = await context.db.query<MessageLineRow[]>(
    `${MESSAGE_SELECT}
     WHERE m.group_id = ? AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL
     ORDER BY m.sent_at DESC LIMIT ?`,
    [groupId, from, to, MAX_MESSAGES],
  );
  rows.reverse();
  const { text, truncated } = formatLines(rows, false);
  return {
    group: groups[0].name,
    from: formatVn(from),
    to: formatVn(to),
    message_count: rows.length,
    truncated: truncated || rows.length >= MAX_MESSAGES,
    messages: text || "(không có tin nào trong khoảng này)",
  };
}

export async function findPeople(context: ThreadToolContext, args: Record<string, unknown>) {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (name.length < 2) return { error: "Tên quá ngắn" };
  const groupVisible = threadVisibilitySql(context.access, "g");
  const memberVisible = threadVisibilitySql(context.access, "g2");
  const scope = askerContactScope(context.access);
  // utf8mb4_unicode_ci không phân biệt dấu: "Lan" khớp "Lân", "hoa" khớp "Hòa"
  const [rows] = await context.db.query<RowDataPacket[]>(
    `SELECT c.zalo_uid, c.display_name, c.zalo_name,
            GROUP_CONCAT(DISTINCT COALESCE(NULLIF(g.label, ''), g.name) SEPARATOR ', ') AS groups_in
     FROM contact c
     LEFT JOIN group_member gm ON gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL
     LEFT JOIN zalo_group g ON g.id = gm.group_id AND g.thread_type = ? AND ${groupVisible.sql}
     WHERE (c.display_name LIKE ? OR c.zalo_name LIKE ?
        OR c.zalo_uid IN (SELECT gm2.zalo_uid FROM group_member gm2 JOIN zalo_group g2 ON g2.id = gm2.group_id
                          WHERE gm2.display_name LIKE ? AND g2.thread_type = ? AND ${memberVisible.sql}))
       ${scope ? `AND ${scope.sql}` : ""}
     GROUP BY c.id
     LIMIT 10`,
    [ConversationType.Group, ...groupVisible.params, `%${name}%`, `%${name}%`, `%${name}%`, ConversationType.Group, ...memberVisible.params, ...(scope?.params ?? [])],
  );
  return {
    people: rows.map((row) => ({
      uid: row.zalo_uid,
      name: row.display_name || row.zalo_name,
      zalo_name: row.zalo_name,
      groups: row.groups_in ?? "",
    })),
  };
}

export async function getConversationWithPerson(context: ThreadToolContext, args: Record<string, unknown>) {
  const personUid = String(args.person_uid ?? "");
  const includeMe = args.include_me !== false;
  const to = parseTime(args.to, context.now);
  const from = parseTime(args.from, new Date(to.getTime() - 7 * 86_400_000));
  if (!personUid) return { error: "Thiếu person_uid — gọi find_people trước." };
  const visible = threadVisibilitySql(context.access, "g");
  // Nhóm: tin của người đó, tin nhắc tên người đó, và (nếu cần) tin người hỏi gửi trong những nhóm mà người đó cũng nhắn trong
  // khoảng này. Riêng: cuộc riêng giữa bot và người đó — CHỈ khi đó là cuộc riêng của chính người hỏi (`visible` đã loại cuộc
  // riêng người khác; vá H1), còn lại người hỏi hỏi về người khác thì chỉ có tin trong nhóm.
  const [rows] = await context.db.query<MessageLineRow[]>(
    `${MESSAGE_SELECT}
     WHERE m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL AND ${visible.sql}
       AND (
         (g.thread_type = ? AND (
            m.sender_uid = ?
            OR JSON_CONTAINS(COALESCE(m.mentions, JSON_ARRAY()), JSON_OBJECT('uid', ?))
            OR (? AND m.sender_uid = ? AND m.group_id IN (
                  SELECT DISTINCT m2.group_id FROM message m2
                  WHERE m2.sender_uid = ? AND m2.sent_at >= ? AND m2.sent_at < ?))))
         OR (g.thread_type = ? AND g.zalo_group_id = ?)
       )
     ORDER BY m.sent_at DESC LIMIT ?`,
    [from, to, ...visible.params, ConversationType.Group, personUid, personUid, includeMe ? 1 : 0, context.askerUid, personUid, from, to,
     ConversationType.Direct, personUid, MAX_MESSAGES],
  );
  rows.reverse();
  const { text, truncated } = formatLines(rows, true);
  return {
    from: formatVn(from),
    to: formatVn(to),
    message_count: rows.length,
    truncated: truncated || rows.length >= MAX_MESSAGES,
    messages: text || "(không có trao đổi nào trong khoảng này)",
  };
}
