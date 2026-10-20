// Phase 9 — họ `tasks` qua MCP trong tiến trình. MySQL thật. TEST VÀNG: lệnh việc gõ (đường cũ `runTaskCommandLegacy` so với đường MCP: công cụ mặt
// `assistant_command` + câu dựng từ kết quả có cấu trúc) cho CÙNG câu trả lời từng ký tự và CÙNG trạng thái DB (việc, sự kiện, hàng đợi báo Zalo) trên ma trận
// người hỏi × quan hệ × nhóm nguồn × trạng thái × cuộc đang hỏi × lệnh. Cộng: giao việc (tên một / mơ hồ / không thấy × hạn chữ / ISO / sai), danh sách,
// «ok hết» / «bỏ hết», công cụ mô hình giữ tên + khai báo và GHI NGAY (BC1 bỏ), mô hình không có đường tới công cụ lệnh, MCP ngoài nhận tên / hạn chữ.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p9 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { AssistantService } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import { resolveAskerAccess, type AskerAccess } from "../src/assistant/infra/asker-access.js";
import type { AssistantMcpBridge } from "../src/assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { openMcpTurn } from "../src/assistant/mcp-bridge/open-mcp-turn.js";
import { ContactKind, ContactRole, McpCallSource, MeetingRecordingStatus, TaskStatus, UserRole } from "../src/constants.js";
import { buildDataAccessContext } from "../src/data-access/data-access-context.js";
import { ALL_TOOLS, findTool, toolsFor } from "../src/data-access/read-tool-catalog.js";
import { runTool } from "../src/data-access/tool-runner.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import type { TaskCommand } from "../src/tasks/task-command-parser.js";
import { buildTaskContext, runTaskCommand } from "../src/tasks/task-commands.js";
import { runTaskCommandLegacy } from "../src/tasks/task-commands-legacy.js";
import { TASK_TOOL_NAMES } from "../src/tasks/task-tools.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
// Thứ 3, 20/10/2026, 12:00 giờ VN
const NOW = new Date("2026-10-20T05:00:00Z");
const TABLES = ["mcp_call_log", "mcp_write_draft", "assistant_turn", "task_event", "task", "meeting_recording", "job", "attachment", "message",
  "group_member", "bot_group", "zalo_group", "contact_tag", "contact", "company", "session_event", "bot_account", "user_group_scope", "app_user", "recipient_group", "recipient"];

class CountingGate extends ConcurrencyGate {
  acquires = 0;
  override acquire(): ReturnType<ConcurrencyGate["acquire"]> {
    this.acquires += 1;
    return super.acquire();
  }
}

type Parts = GeminiContent["parts"];
class ScriptedModel implements ModelClient {
  readonly requests: { contents: GeminiContent[]; tools: { name: string }[] }[] = [];
  constructor(private readonly turns: Parts[]) {}
  async generate(request: { contents: GeminiContent[]; tools: { name: string }[] }) {
    this.requests.push({ contents: structuredClone(request.contents), tools: structuredClone(request.tools) });
    const turn = this.turns.shift();
    if (!turn) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: turn }, inputTokens: 10, outputTokens: 5 };
  }
}

interface Persona { uid: string; contactId: number; role: number; kind: number; name: string }
type Location = "dm" | "groupA" | "groupB";
const LOCATIONS: Location[] = ["dm", "groupA", "groupB"];

describe("họ tasks qua MCP (phase 9)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let dmThread = 0;
  let groupA = 0;
  let groupB = 0;
  let secretGroup = 0;
  let personas: Record<string, Persona> = {};
  const bridgeGate = new CountingGate(5, 20_000);
  const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("tasks"), gate: bridgeGate };

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });

  const insertId = async (sql: string, params: unknown[] = []): Promise<number> => ((await db.query<any>(sql, params))[0] as any).insertId as number;
  const rows = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0];

  async function resetTasks(): Promise<void> {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of ["task_event", "task", "meeting_recording", "job"]) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
  }

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await insertId("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const group = (zaloId: string, name: string, type: number, secret = 0) =>
      insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (?, ?, ?, 1, ?)", [type, zaloId, name, secret]);
    dmThread = await group("u-giao", "Tin riêng", 2);
    groupA = await group("g-a", "Kho Cần Thơ", 1);
    groupB = await group("g-b", "Kế toán", 1);
    secretGroup = await group("g-s", "Ban giám đốc", 1, 1);
    const contact = async (key: string, uid: string, name: string, role: number, kind: number): Promise<Persona> =>
      ({ uid, role, kind, name, contactId: await insertId("INSERT INTO contact (zalo_uid, display_name, role, kind) VALUES (?, ?, ?, ?)", [uid, name, role, kind]) });
    personas = {
      assigner: await contact("assigner", "u-giao", "Lan Giao", ContactRole.None, ContactKind.Staff),
      assignee: await contact("assignee", "u-nhan", "Minh Phụ Trách", ContactRole.None, ContactKind.Staff),
      manager: await contact("manager", "u-mgr", "Quản Lý Bình", ContactRole.Manager, ContactKind.Staff),
      recipient: await contact("recipient", "u-rcp", "Người Nhận Hà", ContactRole.None, ContactKind.Staff),
      customer: await contact("customer", "u-cus", "Khách Lạ", ContactRole.None, ContactKind.Customer),
      disabled: await contact("disabled", "u-dis", "Đã Tắt", ContactRole.Manager, ContactKind.Staff),
      web: await contact("web", "u-web", "Web Hùng", ContactRole.DepartmentHead, ContactKind.Staff),
    };
    await db.query("INSERT INTO recipient (contact_id, name, is_active) VALUES (?, 'Hà', 1)", [personas.recipient.contactId]);
    for (const persona of [personas.assigner, personas.assignee]) await db.query("INSERT INTO group_member (group_id, zalo_uid) VALUES (?, ?)", [groupA, persona.uid]);
    const account = (name: string, contactId: number, active: number) => db.query(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, 1, 0, ?)", [`${name}@x.vn`, name, name, UserRole.Manager, contactId, active]);
    await account("dis", personas.disabled.contactId, 0);
    await account("web", personas.web.contactId, 1);
    bridgeGate.acquires = 0;
  });

  const scopeGroupOf = (location: Location): number | undefined => (location === "dm" ? undefined : location === "groupA" ? groupA : groupB);

  async function accessFor(persona: Persona, location: Location): Promise<AskerAccess> {
    const contact = (await findContactByUid(db, persona.uid))!;
    const groupScopeId = scopeGroupOf(location);
    return resolveAskerAccess(db, contact, { groupScopeId, maskPersonal: false, now: NOW, turn: { threadId: groupScopeId ?? dmThread, messageId: null, botAccountId: 1 } });
  }

  /** Chạy cùng một lệnh ở hai đường; trả câu trả lời + số lần lấy chỗ cổng MCP của lần chạy MCP. `reset` đưa DB về trạng thái trước lệnh. */
  async function runBoth(persona: Persona, location: Location, command: TaskCommand, reset: () => Promise<void>) {
    const access = await accessFor(persona, location);
    const groupId = scopeGroupOf(location);
    const base = { contact: { id: persona.contactId, uid: persona.uid, name: persona.name, role: persona.role, kind: persona.kind }, threadId: groupId ?? dmThread, messageId: null, groupId: groupId ?? null, access: async () => access };
    const old = await runTaskCommandLegacy(buildTaskContext({ db }, base), command, NOW);
    const oldState = await snapshot();
    await reset();
    let turn: ReturnType<typeof openMcpTurn>;
    const before = bridgeGate.acquires;
    const ctx = buildTaskContext({ db }, base);
    ctx.mcp = async () => (turn ??= openMcpTurn(access, bridge, { groupScopeId: groupId }));
    let next: string | null;
    try {
      next = await runTaskCommand(ctx, command, NOW);
    } finally {
      await turn?.close();
    }
    return { old, next, oldState, newState: await snapshot(), calls: bridgeGate.acquires - before };
  }

  /** Trạng thái đáng so: mọi việc (bỏ giờ DB), sự kiện, hàng đợi báo Zalo (nội dung). */
  async function snapshot() {
    const tasks = await rows(`SELECT id, status, priority, title, assignee_contact_id, assignee_uid, assignee_name, assigner_contact_id, assigner_uid, assigner_name, source, source_thread_id,
      source_message_id, dedupe_key, due_at, due_has_time, remind_stage, COALESCE(resolution, '') AS resolution, closed_at IS NULL AS still_open, confirmed_at IS NULL AS unconfirmed FROM task ORDER BY id`);
    const events = await rows("SELECT task_id, kind, actor_name, via, COALESCE(note, '') AS note FROM task_event ORDER BY id");
    const jobs = (await rows("SELECT payload FROM job ORDER BY id")).map((row) => JSON.stringify(row.payload));
    return { tasks, events, jobs };
  }

  async function reseed(taskId: number, initial: RowDataPacket): Promise<void> {
    await db.query("DELETE FROM task_event WHERE task_id = ?", [taskId]);
    await db.query("DELETE FROM job");
    await db.query(`UPDATE task SET status = ?, title = ?, assignee_contact_id = ?, assignee_uid = ?, assignee_name = ?, due_at = ?, due_has_time = ?, remind_stage = ?, resolution = ?,
      closed_at = ?, confirmed_at = ? WHERE id = ?`,
    [initial.status, initial.title, initial.assignee_contact_id, initial.assignee_uid, initial.assignee_name, initial.due_at, initial.due_has_time, initial.remind_stage, initial.resolution,
      initial.closed_at, initial.confirmed_at, taskId]);
  }

  interface TaskSeed { status: TaskStatus; assigner?: Persona | null; assignee?: Persona | null; thread: number | null; title?: string; dueAt?: Date | null; code?: string }
  async function seedTask(seed: TaskSeed): Promise<number> {
    const party = (persona: Persona | null | undefined, fallback: [string, string]) => persona ? [persona.contactId, persona.uid, persona.name] : [null, fallback[0] || null, fallback[1]];
    const assigner = party(seed.assigner, ["u-khac", "Người Khác"]);
    const assignee = seed.assignee === null ? [null, null, ""] : party(seed.assignee, ["u-xa", "Người Xa"]);
    const closed = seed.status === TaskStatus.Done || seed.status === TaskStatus.Cancelled;
    return insertId(
      `INSERT INTO task (code, status, priority, title, assignee_contact_id, assignee_uid, assignee_name, assigner_contact_id, assigner_uid, assigner_name, source, source_thread_id,
        due_at, due_has_time, confirmed_at, closed_at, resolution) VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?, ?)`,
      [seed.code ?? `~t${(uniq += 1)}`, seed.status, seed.title ?? "gửi báo giá Flowertop", ...assignee, ...assigner, seed.thread, seed.dueAt ?? new Date("2026-10-30T17:00:00+07:00"),
        seed.status === TaskStatus.Proposed ? null : NOW, closed ? NOW : null, closed ? "xong từ trước" : null]);
  }
  let uniq = 0;

  const COMMANDS: Record<string, (id: number) => TaskCommand> = {
    status: (taskId) => ({ kind: "task_status", taskId }),
    done: (taskId) => ({ kind: "task_done", taskId, note: "đã gửi" }),
    done_bare: (taskId) => ({ kind: "task_done", taskId, note: "" }),
    note: (taskId) => ({ kind: "task_note", taskId, note: "bổ sung: chờ khách" }),
    reschedule: (taskId) => ({ kind: "task_reschedule", taskId, dueText: "thứ 6" }),
    reschedule_bad: (taskId) => ({ kind: "task_reschedule", taskId, dueText: "bữa nào đó" }),
    reassign: (taskId) => ({ kind: "task_reassign", taskId, assigneeName: "Người Nhận" }),
    cancel: (taskId) => ({ kind: "task_cancel", taskId, note: "nhầm" }),
    reopen: (taskId) => ({ kind: "task_reopen", taskId, note: "làm lại" }),
    confirm: (taskId) => ({ kind: "task_confirm", taskId }),
    reject: (taskId) => ({ kind: "task_reject", taskId }),
  };

  test("VÀNG: ma trận người hỏi × quan hệ × nhóm nguồn × trạng thái × cuộc × lệnh — câu trả lời + DB cũ == MCP, mỗi lệnh đúng MỘT lời gọi công cụ", async () => {
    let compared = 0;
    for (const [personaKey, persona] of Object.entries(personas)) {
      for (const relation of ["assigner", "assignee", "other"] as const) {
        for (const source of [dmThread, groupA, secretGroup]) {
          for (const status of [TaskStatus.Open, TaskStatus.Proposed, TaskStatus.Done]) {
            const taskId = await seedTask({
              status, thread: source, code: `~g${compared}-${(uniq += 1)}`,
              assigner: relation === "assigner" ? persona : null, assignee: relation === "assignee" ? persona : relation === "assigner" ? personas.assignee : null,
            });
            const initial = (await rows("SELECT * FROM task WHERE id = ?", [taskId]))[0];
            for (const location of LOCATIONS) {
              for (const [name, make] of Object.entries(COMMANDS)) {
                const result = await runBoth(persona, location, make(taskId), () => reseed(taskId, initial));
                const where = `${name} ${personaKey} ${relation} nguồn=${source} trạng thái=${status} cuộc=${location}`;
                assert.equal(result.next, result.old, where);
                assert.deepEqual(result.newState, result.oldState, where);
                assert.equal(result.calls, 1, `${where}: phải có đúng 1 tools/call`);
                await reseed(taskId, initial);
                compared += 1;
              }
            }
          }
        }
      }
    }
    assert.equal(compared, 7 * 3 * 3 * 3 * 3 * 11);
  });

  test("VÀNG danh sách: mọi người hỏi × cuộc × phạm vi (việc của mình / nhóm / quá hạn / chờ xác nhận) — nhóm Mật + phạm vi nhóm của tài khoản web", async () => {
    const past = new Date("2026-10-15T17:00:00+07:00");
    const seed: TaskSeed[] = [
      { status: TaskStatus.Open, assigner: personas.assigner, assignee: personas.assignee, thread: dmThread }, { status: TaskStatus.Open, assigner: personas.assigner, assignee: personas.assignee, thread: groupA, dueAt: past },
      { status: TaskStatus.Open, assigner: null, assignee: null, thread: groupA }, { status: TaskStatus.Open, assigner: null, assignee: personas.assignee, thread: groupB },
      { status: TaskStatus.Open, assigner: null, assignee: null, thread: secretGroup, dueAt: past }, { status: TaskStatus.Proposed, assigner: personas.assigner, assignee: null, thread: groupA },
      { status: TaskStatus.Proposed, assigner: null, assignee: personas.assignee, thread: secretGroup }, { status: TaskStatus.Open, assigner: personas.manager, assignee: personas.web, thread: dmThread, dueAt: past },
      { status: TaskStatus.Done, assigner: personas.assigner, assignee: personas.assignee, thread: groupA },
    ];
    for (const item of seed) await seedTask(item);
    let nonEmpty = 0;
    for (const persona of Object.values(personas)) {
      for (const location of LOCATIONS) {
        for (const scope of ["mine", "group", "overdue", "proposed"] as const) {
          const result = await runBoth(persona, location, { kind: "task_list", scope }, async () => undefined);
          assert.equal(result.next, result.old, `${persona.uid} ${location} ${scope}`);
          assert.equal(result.calls, 1);
          if (/\n/.test(result.old)) nonEmpty += 1;
        }
      }
    }
    assert.ok(nonEmpty >= 20, `quá ít danh sách có dòng (${nonEmpty})`);
  });

  test("VÀNG giao việc: người hỏi × cuộc × (tên một / mơ hồ / không thấy) × hạn (chữ / ISO / sai / không có) — câu, việc mới (nguồn, người giao, hạn), báo Zalo", async () => {
    await insertId("INSERT INTO contact (zalo_uid, display_name, kind) VALUES ('u-minh2', 'Minh Kế Toán', 2)");
    await db.query("INSERT INTO group_member (group_id, zalo_uid) VALUES (?, 'u-minh2')", [groupB]);
    const variants: [string, string, number?, string?][] = [
      ["Phụ Trách", "thứ 6"], ["Phụ Trách", "mai 17h"], ["Phụ Trách", "2026-10-30"], ["Phụ Trách", "2026-10-30T17:00:00+07:00"], ["Phụ Trách", ""], ["Phụ Trách", "bữa nào đó"],
      ["Minh", "thứ 6"], ["anh Minh Phụ", "mai"], ["Không Ai Cả", "mai"], ["Phụ Trách", "20/10", 1], ["Người Nhận", "thứ 6", 3], ["Lan Giao", "mai"],
    ];
    let created = 0;
    for (const persona of Object.values(personas)) {
      for (const location of LOCATIONS) {
        for (const [assigneeName, dueText, priority] of variants) {
          const command: TaskCommand = { kind: "task_create", assigneeName, title: "gửi báo giá Flowertop", dueText, priority };
          const result = await runBoth(persona, location, command, resetTasks);
          const where = `${persona.uid} ${location} ${assigneeName}/${dueText}`;
          assert.equal(result.next, result.old, where);
          assert.deepEqual(result.newState, result.oldState, where);
          assert.equal(result.calls, 1, where);
          created += result.newState.tasks.length;
          await resetTasks();
        }
      }
    }
    assert.ok(created >= 100, `quá ít việc được tạo (${created})`);
  });

  test("VÀNG «ok hết» / «bỏ hết»: người hỏi × cuộc × recap gần nhất của nhóm / tin riêng — câu (kể cả null) + DB", async () => {
    const insertRecording = (driveId: string, target: number | null, requesterUid: string | null, taskIds: number[], doneAt: string) => insertId(
      `INSERT INTO meeting_recording (drive_file_id, file_name, mime, size_bytes, drive_created_at, status, note, target_thread_id, requester_uid, task_ids, done_at)
       VALUES (?, 'x.mp3', 'audio/mpeg', 1000, ?, ?, '', ?, ?, ?, ?)`, [driveId, NOW, MeetingRecordingStatus.Done, target, requesterUid, JSON.stringify(taskIds), doneAt]);
    let decided = 0;
    for (const [key, persona] of Object.entries(personas)) {
      for (const location of LOCATIONS) {
        for (const kind of ["task_confirm_recap", "task_reject_recap"] as const) {
          const reseedRecap = async () => {
            await resetTasks();
            const mine = await seedTask({ status: TaskStatus.Proposed, assigner: persona, assignee: personas.assignee, thread: groupA });
            const others = await seedTask({ status: TaskStatus.Proposed, assigner: null, assignee: personas.assignee, thread: groupA });
            const dm = await seedTask({ status: TaskStatus.Proposed, assigner: persona, assignee: null, thread: dmThread });
            const done = await seedTask({ status: TaskStatus.Done, assigner: persona, assignee: null, thread: groupA });
            await insertRecording("rec-old", groupA, null, [done], "2026-10-18 10:00:00");
            await insertRecording("rec-group", groupA, null, [mine, others, done], "2026-10-19 10:00:00");
            await insertRecording("rec-dm", null, persona.uid, [dm], "2026-10-19 11:00:00");
          };
          await reseedRecap();
          const result = await runBoth(persona, location, { kind }, reseedRecap);
          const where = `${key} ${location} ${kind}`;
          assert.equal(result.next, result.old, where);
          assert.deepEqual(result.newState, result.oldState, where);
          assert.equal(result.calls, 1, where);
          if (result.old !== null) decided += 1;
        }
      }
    }
    assert.ok(decided >= 12, `quá ít ca có câu trả lời (${decided})`);
    // Không có recap nào: null cả hai đường
    await resetTasks();
    const none = await runBoth(personas.manager, "dm", { kind: "task_confirm_recap" }, async () => undefined);
    assert.equal(none.old, null);
    assert.equal(none.next, null);
  });

  test("việc số 0 («V-0») cho cùng câu «không thấy» như đường cũ, không gọi công cụ", async () => {
    const result = await runBoth(personas.manager, "dm", { kind: "task_status", taskId: 0 }, async () => undefined);
    assert.equal(result.next, result.old);
    assert.equal(result.calls, 0);
  });

  // ------------------------------------------------------------------ Mô hình
  const call = (name: string, args: Record<string, unknown>) => ({ functionCall: { name, args } });
  async function modelRun(families: string, script: Parts[], persona: Persona = personas.assigner) {
    const model = new ScriptedModel(script);
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 100, dailyTokenCap: 10_000_000 }, () => NOW,
      { tickets: { db, wakeJobs: () => undefined }, mcpBridge: { families: () => parseMcpFamilies(families), gate: bridgeGate } });
    const contact = (await findContactByUid(db, persona.uid))!;
    const reply = await service.answer({ botAccountId: 1, contact, threadId: dmThread, questionMessageId: null, question: "xử lý việc giúp anh" });
    const responses = model.requests.at(-1)!.contents.flatMap((content) => content.parts).flatMap((part) => (part.functionResponse ? [part.functionResponse.response] : []));
    return { reply, responses, model };
  }

  const seedOpenTask = async () => {
    await resetTasks();
    await seedTask({ status: TaskStatus.Open, assigner: personas.assigner, assignee: personas.assignee, thread: dmThread, code: "V-0001" });
  };

  test("công cụ mô hình: tên + khai báo GIỮ NGUYÊN; ghi do mô hình khởi xướng vẫn GHI NGAY (BC1 bỏ) và cùng kết quả hai chế độ", async () => {
    const recap = { tasks: [
      { task: "Gửi báo giá Flowertop", owner: "Phụ Trách", due: "thứ 6", priority: "Cao" }, { task: "Chốt công nợ", owner: "Ông Không Có", due: "mai" },
      { task: "Soạn hợp đồng" }, { task: "ab", owner: "Phụ Trách" }, { task: "Kiểm kho", owner: "(chưa rõ)", due: "bữa nào" },
    ] };
    const scripts: [string, Parts, Persona?][] = [
      ["task_action done", [call("task_action", { task_id: 1, action: "done", note: "đã gửi" })]],
      ["task_action status", [call("task_action", { task_id: 1, action: "status" })]],
      ["task_action note rỗng", [call("task_action", { task_id: 1, action: "note" })]],
      ["task_action note", [call("task_action", { task_id: 1, action: "note", note: "chờ khách" })]],
      ["task_action id sai", [call("task_action", { task_id: 0, action: "done" })]],
      ["task_action việc lạ", [call("task_action", { task_id: 99, action: "done" })]],
      ["task_action reschedule", [call("task_action", { task_id: 1, action: "reschedule", due: "thứ 6" })]],
      ["task_action reschedule thiếu hạn", [call("task_action", { task_id: 1, action: "reschedule" })]],
      ["task_action reschedule hạn sai", [call("task_action", { task_id: 1, action: "reschedule", due: "bữa nào" })]],
      ["task_action reassign", [call("task_action", { task_id: 1, action: "reassign", assignee: "Người Nhận" })]],
      ["task_action reassign thiếu tên", [call("task_action", { task_id: 1, action: "reassign" })]],
      ["task_action confirm sai trạng thái", [call("task_action", { task_id: 1, action: "confirm" })]],
      ["task_action cancel", [call("task_action", { task_id: 1, action: "cancel", note: "nhầm" })]],
      ["task_action không có quyền", [call("task_action", { task_id: 1, action: "cancel" })], personas.customer],
      ["list_tasks", [call("list_tasks", {})]], ["list_tasks overdue", [call("list_tasks", { scope: "overdue" })]],
      ["create_task", [call("create_task", { title: "Gửi báo giá Flowertop", assignee: "Phụ Trách", due: "thứ 6", priority: "Cao" })]],
      ["create_task không hạn", [call("create_task", { title: "Gửi báo giá Flowertop", assignee: "Phụ Trách" })]],
      ["create_task hạn sai", [call("create_task", { title: "Gửi báo giá Flowertop", assignee: "Phụ Trách", due: "bữa nào" })]],
      ["create_task không thấy người", [call("create_task", { title: "Gửi báo giá Flowertop", assignee: "Ai Đó" })]],
      ["create_task ngắn", [call("create_task", { title: "  ", assignee: "Phụ Trách" })]],
      ["create_task thiếu người", [call("create_task", { title: "Gửi báo giá", assignee: " " })]],
      ["create_task khách", [call("create_task", { title: "Gửi báo giá Flowertop", assignee: "Phụ Trách" })], personas.customer],
      ["save_recap_tasks", [call("save_recap_tasks", recap)]], ["save_recap_tasks rỗng", [call("save_recap_tasks", { tasks: [] })]],
      ["save_recap_tasks khách", [call("save_recap_tasks", recap)], personas.customer],
    ];
    for (const [label, script, persona] of scripts) {
      const outcomes: unknown[] = [];
      for (const families of ["", "tasks"]) {
        await seedOpenTask();
        const run = await modelRun(families, [script, [{ text: "xong" }]], persona);
        outcomes.push({ responses: run.responses, state: await snapshot(), text: run.reply.text });
        const declared = run.model.requests[0].tools.filter((tool) => TASK_TOOL_NAMES.has(tool.name));
        assert.deepEqual(declared.map((tool) => tool.name), ["list_tasks", "create_task", "task_action", "save_recap_tasks"], `${label} (${families || "cũ"}): khai báo thiếu / sai thứ tự`);
        outcomes.push(declared);
      }
      assert.deepEqual(outcomes[2], outcomes[0], `${label}: kết quả công cụ + DB khác giữa hai chế độ`);
      assert.deepEqual(outcomes[3], outcomes[1], `${label}: khai báo công cụ khác giữa hai chế độ`);
    }
    // Ghi NGAY: việc xong khi mô hình gọi done, không chờ «đồng ý», không để lại nháp
    await seedOpenTask();
    const acquiredBefore = bridgeGate.acquires;
    await modelRun("tasks", [[call("task_action", { task_id: 1, action: "done", note: "ok" })], [{ text: "đã xong" }]]);
    assert.equal((await rows("SELECT status FROM task WHERE id = 1"))[0].status, TaskStatus.Done);
    assert.equal((await rows("SELECT COUNT(*) AS n FROM mcp_write_draft"))[0].n, 0, "ghi ngay thì không để lại nháp");
    assert.ok(bridgeGate.acquires > acquiredBefore, "ghi do mô hình phải đi qua tools/call thật");
    // create_task thật sự tạo việc + báo người phụ trách (hàng đợi Zalo) ở chế độ MCP
    await resetTasks();
    await modelRun("tasks", [[call("create_task", { title: "Gửi báo giá Flowertop", assignee: "Phụ Trách", due: "thứ 6" })], [{ text: "ok" }]]);
    const made = await rows("SELECT title, assignee_uid, due_at, status FROM task");
    assert.deepEqual(made.map((row) => [row.title, row.assignee_uid, Number(row.status)]), [["Gửi báo giá Flowertop", personas.assignee.uid, TaskStatus.Open]]);
    assert.equal((await rows("SELECT COUNT(*) AS n FROM job"))[0].n, 1, "người phụ trách được báo");
  });

  test("mô hình KHÔNG có đường tới công cụ lệnh; nhật ký gọi: mô hình = nguồn 2, lệnh gõ = nguồn 3 (cùng contact_id); cổng /mcp ngoài không thấy công cụ việc", async () => {
    await seedOpenTask();
    const access = await accessFor(personas.assigner, "dm");
    const turn = openMcpTurn(access, bridge, { wakeJobs: () => undefined })!;
    const commandNames = ["task_list_for_actor", "task_get", "task_create", "task_act", "task_confirm_latest_recap"];
    try {
      const model = (await turn.model())!;
      const command = (await turn.command())!;
      for (const name of commandNames) {
        assert.ok(!model.toolNames.has(name), `mô hình thấy ${name}`);
        assert.ok(command.toolNames.has(name), `lệnh thiếu ${name}`);
      }
      for (const name of TASK_TOOL_NAMES) assert.ok(model.toolNames.has(name) && !command.toolNames.has(name), name);
      await assert.rejects(turn.callTool("assistant_model", "task_act", { task_id: 1, action: "done" }));
      await turn.callTool("assistant_model", "task_action", { task_id: 1, action: "status" });
      await turn.callTool("assistant_command", "task_list_for_actor", { scope: "mine" });
      assert.ok(model.instructions.includes("VIỆC (checklist"));
    } finally {
      await turn.close();
    }
    const readLogs = () => rows("SELECT tool, source, contact_id, key_id FROM mcp_call_log WHERE tool IN ('task_action', 'task_list_for_actor') ORDER BY id");
    let logs = await readLogs();
    for (let attempt = 0; attempt < 40 && logs.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      logs = await readLogs();
    }
    assert.deepEqual(logs.map((row) => [row.tool, row.source]), [["task_action", 2], ["task_list_for_actor", 3]]);
    assert.ok(logs.every((row) => row.contact_id === personas.assigner.contactId && row.key_id === null));
    const external = new Set(toolsFor({ ...access, contactActor: undefined }, "mcp_http", ALL_TOOLS).map((tool) => tool.name));
    for (const name of [...TASK_TOOL_NAMES, ...commandNames]) assert.ok(!external.has(name), `cổng ngoài lộ ${name}`);
  });

  test("bot không cấu hình ticket / việc (ngữ cảnh không có wakeJobs): mô hình không thấy công cụ việc, như đường cũ; lệnh gõ vẫn dùng được", async () => {
    const turn = openMcpTurn(await accessFor(personas.assigner, "dm"), bridge, {})!;
    try {
      const model = (await turn.model())!;
      for (const name of TASK_TOOL_NAMES) assert.ok(!model.toolNames.has(name), `mô hình thấy ${name}`);
      assert.ok((await turn.command())!.toolNames.has("task_act"));
    } finally {
      await turn.close();
    }
  });

  test("họ tắt: không tools/call nào cho lệnh việc (đường cũ nguyên vẹn)", async () => {
    await seedOpenTask();
    const access = await accessFor(personas.assigner, "dm");
    const before = bridgeGate.acquires;
    const ctx = buildTaskContext({ db }, { contact: { id: personas.assigner.contactId, uid: personas.assigner.uid, name: "Lan Giao", role: 0, kind: 2 }, threadId: dmThread, messageId: null, groupId: null, access: async () => access });
    let opened = 0;
    ctx.mcp = async () => { opened += 1; return openMcpTurn(access, { families: () => parseMcpFamilies("core"), gate: bridgeGate }, {}); };
    assert.match(String(await runTaskCommand(ctx, { kind: "task_status", taskId: 1 }, NOW)), /^V-1: gửi báo giá/);
    assert.equal(opened, 1);
    assert.equal(bridgeGate.acquires, before, "họ tasks tắt thì không tools/call");
  });

  // ------------------------------------------------------------------ MCP ngoài (propose_task_*)
  test("MCP ngoài: propose_task_create nhận assignee_name + due_text (cộng thêm) → nháp đúng người / ngày; tên mơ hồ → ambiguous; trộn id + tên → từ chối", async () => {
    const principal = { userId: 901, tenantId: 1, fullName: "Quản Lý Thử", email: "ql@example.com", role: UserRole.Manager, groupIds: null };
    const ctx = buildDataAccessContext({ db, principal, allowWrite: true, maskPersonal: false, source: McpCallSource.Http, keyId: 5, now: NOW });
    const run = (name: string, args: unknown) => runTool(findTool(name)!, ctx, args);
    const created = await run("propose_task_create", { title: "Gửi báo giá Flowertop", assignee_name: "Phụ Trách", due_text: "thứ 6", source_thread_id: groupA });
    assert.equal(created.isError, false, created.text);
    const draft = (created.structured as { draft: { code: string; preview: string } }).draft;
    assert.match(draft.preview, /Minh Phụ Trách/);
    assert.match(draft.preview, /T6 23\/10/, "bản xem trước ghi rõ ngày cụ thể");
    assert.equal((await rows("SELECT COUNT(*) AS n FROM task"))[0].n, 0, "chưa xác nhận thì chưa tạo");
    const confirmed = await run("confirm_write", { code: draft.code });
    assert.equal(confirmed.isError, false, confirmed.text);
    const task = (await rows("SELECT assignee_contact_id, due_at, due_has_time, source_thread_id FROM task"))[0];
    assert.equal(task.assignee_contact_id, personas.assignee.contactId);
    assert.equal(new Date(task.due_at).toISOString(), new Date("2026-10-23T00:00:00+07:00").toISOString());
    assert.deepEqual([Number(task.due_has_time), task.source_thread_id], [0, groupA]);
    // Cập nhật bằng tên + hạn chữ
    const reschedule = await run("propose_task_update", { task_id: 1, action: "reschedule", due_text: "mai 17h" });
    assert.equal(reschedule.isError, false, reschedule.text);
    assert.equal((await run("confirm_write", { code: (reschedule.structured as { draft: { code: string } }).draft.code })).isError, false);
    assert.equal(new Date((await rows("SELECT due_at FROM task WHERE id = 1"))[0].due_at).toISOString(), new Date("2026-10-21T17:00:00+07:00").toISOString());
    // Mơ hồ / sai
    await insertId("INSERT INTO contact (zalo_uid, display_name, kind) VALUES ('u-minh2', 'Minh Kế Toán', 2)");
    const ambiguous = await run("propose_task_create", { title: "Việc khác", assignee_name: "Minh" });
    assert.equal(ambiguous.isError, true);
    assert.equal(ambiguous.isError ? ambiguous.errorCode : "", "ambiguous");
    const both = await run("propose_task_create", { title: "Việc khác", assignee_name: "Phụ Trách", assignee_contact_id: personas.assignee.contactId });
    assert.equal(both.isError, true);
    const badDue = await run("propose_task_create", { title: "Việc khác", due_text: "bữa nào đó" });
    assert.equal(badDue.isError, true);
    // Cũ vẫn chạy: id + ngày
    const legacy = await run("propose_task_create", { title: "Việc cũ", assignee_contact_id: personas.assignee.contactId, due_date: "2026-10-30" });
    assert.equal(legacy.isError, false, legacy.text);
  });
});
