import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, MessageKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { parseZaloContent } from "../zalo/content-parser.js";
import { liveEvents } from "../live-events.js";
import { countDirectMessage, ensureSenderContact, recordDirectMessageContact, type ContactRow } from "./contact-repository.js";
import {
  directKey,
  ensureGroup,
  groupKey,
  ensureThread,
  markBotInGroup,
  type GroupDefaults,
  type GroupRow,
  type ThreadKey,
} from "./group-repository.js";

/**
 * Tin đã bóc khỏi đối tượng zca-js — tách ra để bài kiểm dựng được mà không cần Zalo.
 * zaloGroupId: mã nhóm với tin nhóm; mã Zalo người kia với tin riêng 1-1.
 */
export interface IncomingGroupMessage {
  zaloGroupId: string;
  msgId: string;
  cliMsgId: string;
  msgType: string;
  senderUid: string;
  senderName: string;
  sentAtMs: number;
  content: unknown;
  quote: { globalMsgId: number | string; msg: string } | null;
  mentions: { uid: string; pos: number; len: number }[] | null;
}

export interface IngestDeps {
  db: Db;
  defaults: GroupDefaults;
  /** Mặc định cho cuộc trò chuyện riêng mới — khác nhóm: người ta chủ động nhắn bot nên mặc định lưu. */
  directDefaults?: GroupDefaults;
  /** Gọi khi bot thấy một nhóm lần đầu (đồng bộ thành viên, báo quản lý). */
  onNewGroup?: (group: GroupRow) => void;
  /** Gọi khi có file cần tải về kho. */
  onAttachmentQueued?: (attachmentId: number) => void;
}

export type IngestOutcome = "stored" | "duplicate" | "group_not_read";

export async function ingestGroupMessage(
  deps: IngestDeps,
  botAccountId: number,
  incoming: IncomingGroupMessage,
): Promise<IngestOutcome> {
  const { group, created } = await ensureGroup(deps.db, incoming.zaloGroupId, deps.defaults);
  if (created) {
    // Nhóm đã biết thì việc bot nào đang ở trong do lần quét lúc khởi động + sự kiện nhóm lo,
    // không ghi lại ở mỗi tin cho đỡ một lượt ghi
    await markBotInGroup(deps.db, botAccountId, group.id);
    deps.onNewGroup?.(group);
  }
  // Nhóm chưa bật đọc: không lưu một chữ nào của tin
  if (!group.read_messages) return "group_not_read";

  await ensureSenderContact(deps.db, incoming.senderUid, incoming.senderName);
  const stored = await storeMessage(deps, group, incoming);
  return stored ? "stored" : "duplicate";
}

export interface DirectIngestResult {
  outcome: IngestOutcome;
  thread: GroupRow;
  contact: ContactRow;
  messageId: number | null;
}

/**
 * Tin riêng 1-1 người khác nhắn cho bot. Luôn ghi người đó vào Danh bạ (kể cả khi tắt lưu tin của
 * cuộc này) — để quản trị biết ai đang nhắn bot và cấp vai trò cho họ.
 */
export async function ingestDirectMessage(
  deps: IngestDeps,
  botAccountId: number,
  incoming: IncomingGroupMessage,
): Promise<DirectIngestResult> {
  const sentAt = new Date(incoming.sentAtMs);
  const contact = await recordDirectMessageContact(deps.db, incoming.senderUid, incoming.senderName, sentAt);
  const defaults = deps.directDefaults ?? { readMessages: true, captureFiles: true };
  const { group: thread } = await ensureThread(deps.db, directKey(botAccountId, incoming.zaloGroupId), defaults,
    incoming.senderName);
  if (incoming.senderName && thread.name !== incoming.senderName) {
    // Tên cuộc riêng = tên người kia, đổi theo khi họ đổi tên Zalo
    await deps.db.query("UPDATE zalo_group SET name = ? WHERE id = ?", [incoming.senderName.slice(0, 255), thread.id]);
  }
  if (!thread.read_messages) return { outcome: "group_not_read", thread, contact, messageId: null };
  const messageId = await storeMessage(deps, thread, incoming);
  if (messageId) await countDirectMessage(deps.db, contact.id);
  return { outcome: messageId ? "stored" : "duplicate", thread, contact, messageId };
}

/** Ghi một tin vào cuộc trò chuyện (nhóm hoặc riêng). Trả về id tin, hoặc null nếu là tin trùng. */
async function storeMessage(deps: IngestDeps, group: GroupRow, incoming: IncomingGroupMessage): Promise<number | null> {
  const parsed = parseZaloContent(incoming.msgType, incoming.content);
  const [result] = await deps.db.query<ResultSetHeader>(
    `INSERT IGNORE INTO message
       (group_id, zalo_msg_id, cli_msg_id, zalo_msg_type, kind, sender_uid, sender_name, sent_at,
        text, raw_content, quote_msg_id, quote_text, mentions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id,
      incoming.msgId,
      incoming.cliMsgId.slice(0, 40),
      incoming.msgType.slice(0, 50),
      parsed.kind,
      incoming.senderUid,
      incoming.senderName.slice(0, 255),
      new Date(incoming.sentAtMs),
      parsed.text,
      typeof incoming.content === "string" ? null : JSON.stringify(incoming.content),
      incoming.quote ? String(incoming.quote.globalMsgId) : null,
      incoming.quote?.msg ?? null,
      incoming.mentions?.length ? JSON.stringify(incoming.mentions) : null,
    ],
  );
  // Hai tài khoản bot cùng ở một nhóm, hoặc Zalo gửi lại tin cũ khi nối lại: bỏ qua bản trùng
  if (result.affectedRows === 0) return null;
  await bumpThreadCounters(deps.db, group.id, new Date(incoming.sentAtMs));
  liveEvents.emitMessage({ threadId: group.id, messageId: result.insertId, kind: "new" });

  if (parsed.attachment) {
    const status = group.capture_files ? AttachmentStatus.Pending : AttachmentStatus.Skipped;
    const [attachmentResult] = await deps.db.query<ResultSetHeader>(
      `INSERT INTO attachment (message_id, group_id, file_name, file_ext, declared_size, source_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        result.insertId,
        group.id,
        parsed.attachment.fileName.slice(0, 255),
        parsed.attachment.fileExt.slice(0, 20),
        parsed.attachment.declaredSize,
        parsed.attachment.url,
        status,
      ],
    );
    if (status === AttachmentStatus.Pending) deps.onAttachmentQueued?.(attachmentResult.insertId);
  }
  return result.insertId;
}

/**
 * Người gửi thu hồi tin: xóa nội dung, giữ dòng kèm recalled_at để mạch hội thoại không thủng.
 * Thu hồi là ý muốn rút lời — bot không giữ lại chữ của tin đó.
 */
export async function recallMessage(db: Db, key: ThreadKey, zaloMsgId: string): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE message m JOIN zalo_group g ON g.id = m.group_id
     SET m.text = NULL, m.raw_content = NULL, m.quote_text = NULL, m.recalled_at = CURRENT_TIMESTAMP(3)
     WHERE g.thread_type = ? AND g.zalo_group_id = ? AND g.owner_bot_id = ? AND m.zalo_msg_id = ? AND m.recalled_at IS NULL`,
    [key.threadType, key.zaloThreadId, key.ownerBotId, zaloMsgId],
  );
  if (result.affectedRows > 0) {
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT m.id, m.group_id FROM message m JOIN zalo_group g ON g.id = m.group_id WHERE g.thread_type = ? AND g.zalo_group_id = ? AND g.owner_bot_id = ? AND m.zalo_msg_id = ?",
      [key.threadType, key.zaloThreadId, key.ownerBotId, zaloMsgId]);
    if (rows[0]) liveEvents.emitMessage({ threadId: Number(rows[0].group_id), messageId: Number(rows[0].id), kind: "recalled" });
  }
  return result.affectedRows > 0;
}

export async function recallGroupMessage(db: Db, zaloGroupId: string, zaloMsgId: string): Promise<boolean> {
  return recallMessage(db, groupKey(zaloGroupId), zaloMsgId);
}

/** Bộ đếm trên zalo_group (xem migration 011) — gọi sau MỌI lần ghi tin thành công. */
export async function bumpThreadCounters(db: Db, threadId: number, sentAt: Date): Promise<void> {
  await db.query(
    "UPDATE zalo_group SET message_count = message_count + 1, last_message_at = GREATEST(COALESCE(last_message_at, ?), ?) WHERE id = ?",
    [sentAt, sentAt, threadId],
  );
}

/** Tính lại bộ đếm của một cuộc từ bảng message (sau khi dọn tin quá hạn). */
export async function recountThread(db: Db, threadId: number): Promise<void> {
  await db.query(
    `UPDATE zalo_group g SET g.message_count = (SELECT COUNT(*) FROM message m WHERE m.group_id = g.id),
       g.last_message_at = (SELECT MAX(m.sent_at) FROM message m WHERE m.group_id = g.id) WHERE g.id = ?`,
    [threadId],
  );
}

/** Nguồn của tin bot gửi ra — lưu ở `zalo_msg_type` để màn Hội thoại phân biệt AI trả lời với quản trị gõ tay. */
export const OUTGOING_SOURCE = { assistant: "webchat", admin: "admin" } as const;

/**
 * Ghi tin bot vừa gửi ra Zalo (AI trả lời hoặc quản trị gõ từ web) — listener không nghe tin của chính
 * mình (selfListen tắt), mà màn Hội thoại cần thấy cả hai phía, và trợ lý cần đọc lại câu trả lời trước
 * để hiểu câu hỏi nối tiếp. Trả về id tin, null nếu trùng.
 * Có `file` thì ghi luôn dòng attachment đã ở trong kho (tệp quản trị tải lên).
 */
export async function recordOutgoingMessage(
  db: Db,
  thread: GroupRow,
  bot: { uid: string; name: string },
  zaloMsgId: string,
  text: string,
  options: { source?: string; kind?: MessageKind; file?: { name: string; ext: string; storageKey: string; bytes: number } } = {},
): Promise<number | null> {
  const sentAt = new Date();
  const [result] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO message (group_id, zalo_msg_id, zalo_msg_type, kind, sender_uid, sender_name, sent_at, text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [thread.id, zaloMsgId, options.source ?? OUTGOING_SOURCE.assistant, options.kind ?? MessageKind.Text, bot.uid, bot.name.slice(0, 255), sentAt, text],
  );
  if (result.affectedRows === 0) return null;
  if (options.file) {
    await db.query(
      `INSERT INTO attachment (message_id, group_id, file_name, file_ext, declared_size, source_url, storage_key, stored_bytes, status, stored_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      [result.insertId, thread.id, options.file.name.slice(0, 255), options.file.ext.slice(0, 20), options.file.bytes,
        options.file.storageKey, options.file.bytes, AttachmentStatus.Stored, sentAt],
    );
  }
  await bumpThreadCounters(db, thread.id, sentAt);
  liveEvents.emitMessage({ threadId: thread.id, messageId: result.insertId, kind: "new" });
  return result.insertId;
}
