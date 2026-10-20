// Dữ liệu + trợ giúp chung cho test họ `send` qua MCP (phase 12): thế giới thử (nhân vật / nhóm của mục 0 phase 8 + thêm nhóm Kho HN, tài khoản web đã tắt),
// cầu nối cổng đếm lời gọi, ngữ cảnh truy cập của người hỏi, ảnh chụp trạng thái so cũ / mới. Không có đuôi .test.ts nên `npm test` không chạy riêng nó.

import type { RowDataPacket } from "mysql2";
import { resolveAskerAccess, type AskerAccess } from "../src/assistant/infra/asker-access.js";
import type { AssistantMcpBridge } from "../src/assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { ContactRole, UserRole } from "../src/constants.js";
import type { Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import type { SendCommandDeps } from "../src/send-commands/send-command-deps.js";
import type { SendContextRequest } from "../src/send-commands/send-command-context.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { directKey, ensureGroup, ensureThread, markBotInGroup } from "../src/sync/group-repository.js";
import { makeCalendar, resetTables, seedWorld, vn, type Phase8World } from "./phase8-brief-fixtures.js";

export const T = vn("2026-10-12 09:00");
const READ = { readMessages: true, captureFiles: false };
export const G1 = "TEST Sales Miền Tây";
export const PERSONAS = ["u-mi", "u-phong", "u-hang", "u-tuan", "u-huy", "u-tam", "u-sau", "u-dis"] as const;

export class CountingGate extends ConcurrencyGate {
  acquires = 0;
  override acquire(): ReturnType<ConcurrencyGate["acquire"]> {
    this.acquires += 1;
    return super.acquire();
  }
}

export const makeBridge = (gate: ConcurrencyGate, families = "send"): AssistantMcpBridge => ({ families: () => parseMcpFamilies(families), gate });

export interface SendWorld {
  world: Phase8World;
  direct: Map<string, number>;
  deps: SendCommandDeps;
  webThread: number;
  demoThread: number;
}

/** Dựng lại toàn bộ dữ liệu thử: nhóm G1 / G2 / G3 + «Kho HN» (bot còn trong nhóm), cuộc riêng của mọi người, tài khoản web đã tắt của `u-dis`. */
export async function setupSendWorld(db: Db, wakeJobs: () => void = () => undefined): Promise<SendWorld> {
  await resetTables(db);
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of ["send_command_target", "send_command", "mcp_call_log", "mcp_write_draft", "app_user"]) await db.query(`TRUNCATE TABLE ${table}`);
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
  const world = await seedWorld(db);
  for (const groupId of [world.g1, world.g2, world.g3]) await markBotInGroup(db, world.botId, groupId);
  const { group } = await ensureGroup(db, "z-kho-hn", READ);
  await db.query("UPDATE zalo_group SET name = 'Kho HN', group_kind = 2 WHERE id = ?", [group.id]);
  await markBotInGroup(db, world.botId, group.id);
  await db.query("INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES ('u-dis', 'Đã tắt', 2, ?)", [ContactRole.Manager]);
  const [disabled] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = 'u-dis'");
  await db.query("INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES ('dis@x.vn', 'dis', 'dis', ?, ?, 1, 0, 0)",
    [UserRole.Manager, disabled[0].id]);
  const direct = new Map<string, number>();
  for (const uid of PERSONAS) direct.set(uid, (await ensureThread(db, directKey(world.botId, uid), READ, uid)).group.id);
  const fake = async (zaloId: string) => Number(((await db.query<any>("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (2, ?, 'giả', 1)", [zaloId]))[0] as any).insertId);
  return { world, direct, deps: { db, calendar: makeCalendar(), wakeJobs }, webThread: await fake("web-u-mi"), demoThread: await fake("demo-u-mi") };
}

export async function accessFor(db: Db, uid: string, threadId: number, groupScopeId?: number, now: Date = T): Promise<AskerAccess> {
  const contact = (await findContactByUid(db, uid))!;
  return resolveAskerAccess(db, contact, { groupScopeId, maskPersonal: false, now, turn: { threadId, messageId: null, botAccountId: 1 } });
}

export async function requestFor(db: Db, uid: string, threadId: number, question: string, botAccountId: number): Promise<SendContextRequest> {
  return { contact: (await findContactByUid(db, uid))!, threadId, questionMessageId: null, botAccountId, question };
}

const SEND_COLUMNS = "id, source, status, action_kind, requester_contact_id, requester_uid, requester_name, bot_account_id, source_thread_id, source_message_id, body, attachment_ids, scheduled_at, reminder_at, reminder_repeat, off_hours_note, confirm_expires_at, confirmed_at IS NULL AS unconfirmed, cancelled_at IS NULL AS uncancelled, cancelled_by";

/** Trạng thái đáng so giữa đường cũ và đường MCP: lệnh gửi, nơi nhận, việc nền (nội dung), bỏ cột giờ do DB đóng dấu. */
export async function sendSnapshot(db: Db) {
  const q = async (sql: string) => (await db.query<RowDataPacket[]>(sql))[0];
  return {
    commands: await q(`SELECT ${SEND_COLUMNS} FROM send_command ORDER BY id`),
    targets: await q("SELECT command_id, target_kind, target_key, thread_id, zalo_uid, display_name, status, attempt_no, job_id, error FROM send_command_target ORDER BY id"),
    jobs: (await q("SELECT kind, payload, status FROM job ORDER BY id")).map((row) => [row.kind, JSON.stringify(row.payload), row.status]),
  };
}

export async function resetSendState(db: Db): Promise<void> {
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of ["send_command_target", "send_command", "job", "brief_log"]) await db.query(`TRUNCATE TABLE ${table}`);
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
}
