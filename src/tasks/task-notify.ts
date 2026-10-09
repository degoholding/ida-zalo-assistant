import type { RowDataPacket } from "mysql2";
import { ConversationType, GroupKind } from "../constants.js";
import { enqueueContactMessage, type MessageQueueDeps } from "../messaging/contact-message.js";
import { formatDue } from "./task-format.js";
import { shortTaskCode, type TaskParty, type TaskRow } from "./task-repository.js";

// Báo một người về một việc: người đó đang ở NHÓM NỘI BỘ nơi việc được giao (bot còn ở nhóm) → nhắn vào nhóm, gắn thẻ
// «@Tên» (Zalo báo cho họ, cả nhóm thấy việc đã được nhắc); không thì nhắn riêng. Nhóm KHÁCH HÀNG không bao giờ nhận tin
// việc nội bộ (nhắc, quá hạn, ghi chú) — review 09/10/2026. Người chỉ có tên (giao trên web) thì không báo được.

/**
 * Tên của người này trong nhóm (để «@Tên» khớp thẻ nhắc). null nếu cuộc không phải nhóm NỘI BỘ, bot đã rời nhóm, hoặc họ
 * không còn ở nhóm — khi đó nhắn riêng.
 */
async function memberNameInGroup(deps: MessageQueueDeps, threadId: number, uid: string): Promise<string | null> {
  const [rows] = await deps.db.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(gm.display_name, ''), gm.zalo_name) AS name FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
     WHERE gm.group_id = ? AND gm.zalo_uid = ? AND gm.left_at IS NULL AND g.thread_type = ? AND g.group_kind = ?
       AND EXISTS (SELECT 1 FROM bot_group bg WHERE bg.group_id = g.id AND bg.left_at IS NULL)`,
    [threadId, uid, ConversationType.Group, GroupKind.Internal]);
  const name = String(rows[0]?.name ?? "").trim();
  return name.length >= 2 ? name : null;
}

/**
 * Báo `party` về `task`. `tag` phân biệt lần báo (dedupe hàng đợi): cùng việc + tag + người chỉ xếp một lần.
 * Trả false nếu không có đường báo (không mã Zalo).
 */
export async function notifyTaskParty(deps: MessageQueueDeps, task: TaskRow, party: TaskParty | null, text: string, tag: string): Promise<boolean> {
  if (!party?.uid) return false;
  const dedupeKey = `task:${task.id}:${tag}:${party.uid}`;
  if (task.source_thread_id) {
    const tagName = await memberNameInGroup(deps, task.source_thread_id, party.uid);
    if (tagName) {
      await enqueueContactMessage(deps, { threadId: task.source_thread_id, text: `@${tagName} ${text}`, mentionUids: [party.uid] }, dedupeKey);
      return true;
    }
  }
  await enqueueContactMessage(deps, { zaloUid: party.uid, name: party.name, text }, dedupeKey);
  return true;
}

/** Câu báo người phụ trách có việc (mới / vừa giao lại / vừa xác nhận). */
export function newTaskText(task: TaskRow): string {
  return `có việc ${shortTaskCode(task)}: ${task.title} — hạn ${formatDue(task.due_at, task.due_has_time)}. ` +
    `Người giao: ${task.assigner.name || "(không rõ)"}. Xong thì nhắn «xong ${shortTaskCode(task)}».`;
}

/**
 * Báo nhiều việc mới một lượt (lưu cả bảng phân công recap): người ở nhóm nội bộ → MỘT tin vào nhóm tag tất cả; người còn
 * lại → nhắn riêng từng người. `key` chống xếp hai lần.
 */
export async function announceNewTasks(deps: MessageQueueDeps, tasks: TaskRow[], key: string): Promise<void> {
  const inGroup = new Map<number, { lines: string[]; uids: string[] }>();
  for (const task of tasks) {
    const assignee = task.assignee;
    if (!assignee?.uid || assignee.uid === task.assigner.uid) continue;
    const tagName = task.source_thread_id ? await memberNameInGroup(deps, task.source_thread_id, assignee.uid) : null;
    if (!tagName) {
      await notifyTaskParty(deps, task, assignee, newTaskText(task), `batch:${key}`);
      continue;
    }
    const entry = inGroup.get(task.source_thread_id!) ?? { lines: [], uids: [] };
    entry.lines.push(`- @${tagName}: ${shortTaskCode(task)} ${task.title} — hạn ${formatDue(task.due_at, task.due_has_time)}`);
    entry.uids.push(assignee.uid);
    inGroup.set(task.source_thread_id!, entry);
  }
  for (const [threadId, entry] of inGroup) {
    await enqueueContactMessage(deps, {
      threadId, mentionUids: [...new Set(entry.uids)],
      text: ["Việc mới trong checklist (em sẽ nhắc theo hạn):", ...entry.lines, "Xong việc nào thì nhắn «xong V-<số>»."].join("\n"),
    }, `task:batch:${key}:${threadId}`);
  }
}

/** Những bên của việc (người phụ trách, người giao) trừ người đang thao tác — mỗi người một lần. */
export function otherParties(task: TaskRow, actor: { uid: string | null; contactId: number | null }): TaskParty[] {
  const isActor = (party: TaskParty) => (actor.uid && party.uid === actor.uid) || (actor.contactId !== null && party.contactId === actor.contactId);
  const parties = [task.assignee, task.assigner].filter((party): party is TaskParty => Boolean(party?.uid) && !isActor(party!));
  return parties.filter((party, index) => parties.findIndex((other) => other.uid === party.uid) === index);
}
