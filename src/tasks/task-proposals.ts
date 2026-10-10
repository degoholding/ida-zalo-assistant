import type { RowDataPacket } from "mysql2";
import { buildAlertModelClient, systemTokensToday } from "../alerts/ai-review.js";
import type { ModelClient } from "../assistant/gemini-client.js";
import type { AppConfig } from "../config.js";
import { ContactKind, ConversationType, MessageKind, TaskSource } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import { quietDelayMs } from "../schedule/quiet-delay.js";
import { enqueueContactMessage } from "../messaging/contact-message.js";
import { maskPersonalData } from "../privacy/personal-data.js";
import { cleanPersonName, pickContactMatch, searchContactsByName } from "../sync/contact-search.js";
import { parseDueArgument } from "./task-due-parser.js";
import { formatDue } from "./task-format.js";
import {
  composeProposalMessage, formatSentForPrompt, looksLikeAssignment, parseExtractAnswer, TASK_EXTRACT_PROMPT,
} from "./task-proposal-parse.js";
import { shortTaskCode, type TaskParty, type TaskRow } from "./task-repository.js";
import { createTask } from "./task-service.js";

// AI tự bắt câu GIAO VIỆC trong nhóm (phase 7, IDA câu 22: «bot đề xuất việc từ tin, chủ xác nhận») — worker 5 phút / lần.
// Lượt RIÊNG, không ghép vào lượt AI bắt tin khẩn (ai-review.ts): lượt đó bỏ qua tin đã dính từ khóa («công nợ», «hóa đơn»…)
// mà câu giao việc hay nằm đúng trong những tin ấy; sửa lượt đó dễ làm lệch phân loại khẩn. Tiết kiệm token: chỉ tin của
// NHÂN SỰ / người có vai trò, có dấu hiệu giao việc (@nhắc, «nhờ», «giao», «hạn», «trước thứ…») mới đưa AI.
// Đề xuất → việc «chờ xác nhận», nhắn riêng NGƯỜI NÓI câu đó (giờ yên lặng thì hoãn tới đầu giờ làm): «ok V-12» mới vào
// checklist (báo người làm, nhắc theo hạn). Mỗi tin chỉ một đề xuất (khóa «ai:<id tin>:1») — tin giao nhiều việc thì lấy việc đầu.
// Nhóm Mật không bao giờ đưa AI; chữ đưa đi đã che SĐT / STK / CCCD; token tính vào trần ngày của hệ thống.

const log = createLogger("task-extract");
const CURSOR = "task_extract";
const LOOKBACK_MS = 2 * 60 * 60_000;
const SCAN_LIMIT = 300;
const MAX_ITEMS = 40;
const MIN_TEXT = 12;

interface Candidate {
  id: number;
  groupId: number;
  groupName: string;
  sender: TaskParty;
  text: string;
  sentAt: Date;
  mentionUids: string[];
}

function mentionUids(raw: unknown): string[] {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list.map((item) => String((item as { uid?: unknown }).uid ?? "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function loadCandidates(db: Db, now: Date): Promise<{ items: Candidate[]; newCursor: number; botUids: Set<string> }> {
  const [cursorRows] = await db.query<RowDataPacket[]>("SELECT last_message_id FROM alert_cursor WHERE name = ?", [CURSOR]);
  const cursor = Number(cursorRows[0]?.last_message_id ?? 0);
  const [bots] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL");
  const botUids = new Set(bots.map((row) => String(row.zalo_uid)));
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.group_id, COALESCE(NULLIF(g.label, ''), g.name) AS group_name, m.sender_uid, m.sender_name, m.text, m.sent_at,
            m.mentions, c.id AS contact_id, c.kind, c.role
     FROM message m JOIN zalo_group g ON g.id = m.group_id LEFT JOIN contact c ON c.zalo_uid = m.sender_uid
     WHERE g.thread_type = ? AND g.read_messages = 1 AND g.is_confidential = 0 AND m.recalled_at IS NULL AND m.kind IN (?, ?)
       AND m.id > ? AND m.sent_at > ? AND CHAR_LENGTH(m.text) >= ?
       AND NOT EXISTS (SELECT 1 FROM task t WHERE t.source_message_id = m.id)
     ORDER BY m.id LIMIT ?`,
    [ConversationType.Group, MessageKind.Text, MessageKind.Link, cursor, new Date(now.getTime() - LOOKBACK_MS), MIN_TEXT, SCAN_LIMIT]);
  const scannedTo = rows.reduce((max, row) => Math.max(max, Number(row.id)), cursor);
  const items = rows.flatMap((row): Candidate[] => {
    const uid = String(row.sender_uid);
    const staff = Number(row.kind) === ContactKind.Staff || Number(row.role) > 0;
    if (botUids.has(uid) || !staff || row.contact_id === null) return [];
    const mentions = mentionUids(row.mentions).filter((mention) => mention !== uid && !botUids.has(mention));
    const text = String(row.text ?? "");
    if (!looksLikeAssignment(text, mentions.length > 0)) return [];
    return [{
      id: Number(row.id), groupId: Number(row.group_id), groupName: String(row.group_name ?? ""), text, sentAt: new Date(row.sent_at), mentionUids: mentions,
      sender: { contactId: Number(row.contact_id), uid, name: String(row.sender_name ?? "") },
    }];
  });
  // Lô bị cắt (> MAX_ITEMS tin đáng xét): con trỏ dừng ngay trước tin đầu tiên chưa xét — lượt sau xét tiếp, không bỏ sót
  const newCursor = items.length > MAX_ITEMS ? items[MAX_ITEMS].id - 1 : scannedTo;
  return { items: items.slice(0, MAX_ITEMS), newCursor, botUids };
}

/** Người được giao: đúng MỘT người được @nhắc trong tin → người đó; không thì tìm theo tên AI đọc ra (ưu tiên trong nhóm). */
async function resolveProposedAssignee(db: Db, item: Candidate, personName: string): Promise<TaskParty | null> {
  if (item.mentionUids.length === 1) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT c.id, c.zalo_uid, COALESCE(NULLIF(gm.display_name, ''), NULLIF(c.display_name, ''), c.zalo_name) AS name
       FROM contact c LEFT JOIN group_member gm ON gm.zalo_uid = c.zalo_uid AND gm.group_id = ? WHERE c.zalo_uid = ? LIMIT 1`,
      [item.groupId, item.mentionUids[0]]);
    if (rows[0]) return { contactId: Number(rows[0].id), uid: String(rows[0].zalo_uid), name: String(rows[0].name ?? personName) };
  }
  const name = cleanPersonName(personName);
  if (!name) return null;
  const picked = pickContactMatch(await searchContactsByName(db, name, { groupId: item.groupId }));
  return picked ? { contactId: picked.id, uid: picked.uid, name: picked.name } : { contactId: null, uid: null, name };
}

const saveCursor = (db: Db, id: number) => db.query(
  "INSERT INTO alert_cursor (name, last_message_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_message_id = GREATEST(last_message_id, VALUES(last_message_id))",
  [CURSOR, id]);

export interface ExtractResult {
  reviewed: number;
  proposed: number;
  skipped: string;
}

/** Một lượt bắt câu giao việc. `client` = null thì tự dựng từ bảng Khóa AI (truyền vào để thử). */
export async function runTaskExtraction(db: Db, config: AppConfig, calendar: WorkCalendar | null, now = new Date(), client?: ModelClient | null): Promise<ExtractResult> {
  if (!config.alerts.aiEnabled) return { reviewed: 0, proposed: 0, skipped: "AI xét tin đang tắt" };
  const { items, newCursor } = await loadCandidates(db, now);
  if (!items.length) {
    await saveCursor(db, newCursor);
    return { reviewed: 0, proposed: 0, skipped: "" };
  }
  if (await systemTokensToday(db, now) >= config.assistant.dailyTokenCap) return { reviewed: 0, proposed: 0, skipped: "chạm trần token ngày" };
  const model = client === undefined ? await buildAlertModelClient(db, config) : client;
  if (!model) return { reviewed: 0, proposed: 0, skipped: "chưa có khóa AI" };

  const lines = items.map((item) => `#${item.id} [${item.groupName}] (${formatSentForPrompt(item.sentAt)}) ${item.sender.name}: ` +
    maskPersonalData(item.text).replace(/\s+/g, " ").slice(0, 400));
  const started = Date.now();
  const result = await model.generate({ system: TASK_EXTRACT_PROMPT, contents: [{ role: "user", parts: [{ text: lines.join("\n") }] }], tools: [], forceText: true });
  await db.query(
    "INSERT INTO system_ai_usage (purpose, model, item_count, input_tokens, output_tokens, duration_ms) VALUES ('task-extract', ?, ?, ?, ?, ?)",
    [String((model as { lastModel?: string }).lastModel ?? "").slice(0, 80), items.length, result.inputTokens, result.outputTokens, Date.now() - started]);

  const byId = new Map(items.map((item) => [item.id, item]));
  const created: { task: TaskRow; item: Candidate }[] = [];
  for (const found of parseExtractAnswer(result.content.parts.map((part) => part.text ?? "").join(""))) {
    const item = byId.get(found.id);
    if (!item || created.some((entry) => entry.item.id === item.id)) continue;
    const assignee = await resolveProposedAssignee(db, item, found.person);
    // Tự giao cho mình («để em làm») không phải giao việc
    if (assignee?.uid && assignee.uid === item.sender.uid) continue;
    const due = parseDueArgument(found.due, item.sentAt);
    const task = await createTask({ db }, {
      title: found.task, assignee, assigner: item.sender, source: TaskSource.AiReview, sourceThreadId: item.groupId, sourceMessageId: item.id,
      due: due ? { at: due.at, hasTime: due.hasTime } : null, proposed: true, dedupeKey: `ai:${item.id}:1`, via: "system",
    });
    if (task) created.push({ task, item });
  }
  // Một tin riêng / người nói câu giao việc, gộp mọi đề xuất của họ trong lượt này
  const bySender = new Map<string, { task: TaskRow; item: Candidate }[]>();
  for (const entry of created) bySender.set(entry.item.sender.uid!, [...(bySender.get(entry.item.sender.uid!) ?? []), entry]);
  for (const [uid, entries] of bySender) {
    const proposalLines = entries.map(({ task, item }) =>
      `- ${shortTaskCode(task)} [${item.groupName}] ${task.assignee?.name || "(chưa rõ người làm)"} — ${task.title} — hạn ${formatDue(task.due_at, task.due_has_time, now)}`);
    await enqueueContactMessage({ db }, { zaloUid: uid, name: entries[0].item.sender.name, text: composeProposalMessage(proposalLines, shortTaskCode(entries[0].task)) },
      `taskpropose:${entries.map(({ task }) => task.id).join(",")}`, quietDelayMs(calendar, now));
  }
  await saveCursor(db, newCursor);
  if (created.length) log.info(`đề xuất ${created.length} việc từ ${items.length} tin`);
  return { reviewed: items.length, proposed: created.length, skipped: "" };
}
