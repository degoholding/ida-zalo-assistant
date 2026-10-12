// Phase 9 phase 4 — nối Zalo trên MySQL THẬT: giao tin có tiến độ từng tệp (thử lại không gửi lặp), «đồng ý» / «hủy» trần
// chọn nháp lệnh gửi, hướng dẫn có khối GỬI TIN, lệnh gửi trong nhóm bị chặn.
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/<csdl_thử> npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { parseChatCommand, runChatCommand } from "../src/assistant/chat-commands.js";
import { JobKind } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { JobRow } from "../src/jobs/job-queue.js";
import { deliverContactMessage } from "../src/messaging/contact-message-delivery.js";
import type { ContactMessagePayload } from "../src/messaging/contact-message.js";
import type { SendChatContext } from "../src/send-commands/send-command-chat.js";
import { loadSendRequester } from "../src/send-commands/send-target-resolver.js";
import { directKey, ensureThread, findThreadById, markBotInGroup } from "../src/sync/group-repository.js";
import type { AccountRunner } from "../src/zalo/account-runner.js";
import { databaseUrl, makeCalendar, postMessage, resetTables, seedWorld, vn, type Phase8World } from "./phase8-brief-fixtures.js";

const T = vn("2026-10-12 09:00");

describe("phase 9 — nối Zalo (phase 4)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let world: Phase8World;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await resetTables(db);
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    await db.query("TRUNCATE TABLE send_command_target");
    await db.query("TRUNCATE TABLE send_command");
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    world = await seedWorld(db);
  });

  async function storedAttachment(): Promise<number> {
    const messageId = await postMessage(db, "z-att", "u-x", "X", "tệp", T);
    const [result] = await db.query<ResultSetHeader>(
      "INSERT INTO attachment (message_id, group_id, source_url, status) VALUES (?, ?, 'http://x', 1)", [messageId, world.g1]);
    return result.insertId;
  }

  test("giao tin: tệp đính kèm gửi một lần, lượt thử lại tiếp tục từ chỗ đã xong", async () => {
    const a = await storedAttachment();
    const b = await storedAttachment();
    const [jobResult] = await db.query<ResultSetHeader>("INSERT INTO job (kind, payload, status) VALUES (?, '{}', 1)", [JobKind.SendCommandTarget]);
    const job = { id: jobResult.insertId, kind: JobKind.SendCommandTarget, payload: {}, serialKey: null, attempts: 1, maxAttempts: 3, createdAt: new Date() } as JobRow;
    const thread = (await findThreadById(db, world.g1))!;
    const calls: string[] = [];
    let failOn: number | null = b;
    const runner = {
      sendThreadText: async (_t: unknown, text: string) => { calls.push(`text:${text}`); },
      sendThreadStoredFile: async (_t: unknown, id: number) => { if (id === failOn) throw new Error("Zalo lỗi"); calls.push(`file:${id}`); },
    } as unknown as AccountRunner;
    const deps = { db, runnerForThread: async () => runner, runnerForUid: async () => runner };
    const payload: ContactMessagePayload & { targetId: number } = { targetId: 7, threadId: thread.id, text: "xin chào", attachmentIds: [a, b] };

    await assert.rejects(deliverContactMessage(deps, payload, job), /Zalo lỗi/);
    assert.deepEqual(calls, ["text:xin chào", `file:${a}`]);
    // Tiến độ nằm trong payload của job, vẫn giữ targetId
    const [rows] = await db.query<RowDataPacket[]>("SELECT payload FROM job WHERE id = ?", [job.id]);
    const saved = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    assert.equal(saved.targetId, 7);
    assert.equal(saved.textSent, true);
    assert.equal(saved.sentAttachmentCount, 1);

    failOn = null;
    await deliverContactMessage(deps, payload, { ...job, attempts: 2 });
    assert.deepEqual(calls, ["text:xin chào", `file:${a}`, `file:${b}`]);
  });

  async function sendContext(uid: string): Promise<SendChatContext> {
    const direct = (await ensureThread(db, directKey(world.botId, uid), { readMessages: true, captureFiles: false }, uid)).group.id;
    const requester = await loadSendRequester(db, uid);
    return {
      deps: { db, calendar: makeCalendar(), wakeJobs: () => undefined }, requester, uid, name: requester?.name ?? uid,
      question: "", sourceThreadId: direct, requesterContactId: null,
    };
  }

  test("lệnh gõ: nháp → «đồng ý» xếp job; «hủy» trần hủy nháp; không có nháp thì để AI", async () => {
    const ctx = await sendContext("u-mi");
    assert.ok(ctx.requester, "u-mi phải đủ quyền ra lệnh gửi");
    const run = async (text: string, send: SendChatContext | undefined = ctx, inGroup = false) => {
      const command = parseChatCommand(text);
      assert.ok(command, text);
      return runChatCommand({ db, asker: null, inGroup, now: T, send: send && { ...send, question: text } }, command);
    };
    assert.equal(await run("đồng ý"), null);
    const [groupRows] = await db.query<RowDataPacket[]>("SELECT name FROM zalo_group WHERE id = ?", [world.g1]);
    await db.query("UPDATE zalo_group SET group_kind = 2 WHERE id = ?", [world.g1]);
    await markBotInGroup(db, world.botId, world.g1);
    const groupName = String(groupRows[0].name);
    const preview = await run(`gửi nhóm ${groupName}: họp 3h chiều nay`);
    assert.match(preview ?? "", /G-\d+/);
    assert.match((await run("đồng ý")) ?? "", /Đã nhận lệnh G-\d+/);
    const [jobs] = await db.query<RowDataPacket[]>("SELECT id FROM job WHERE kind = ?", [JobKind.SendCommandTarget]);
    assert.equal(jobs.length, 1);

    await run(`gửi nhóm ${groupName}: nội dung hai`);
    assert.match((await run("hủy")) ?? "", /Đã hủy lệnh G-\d+/);

    // Trong nhóm: câu cố định, không tạo nháp
    assert.match((await run(`gửi nhóm ${groupName}: lén`, undefined, true)) ?? "", /nhắn riêng/);
  });

  test("hướng dẫn: khối GỬI TIN chỉ cho người đủ quyền", async () => {
    const allowed = await sendContext("u-mi");
    const command = parseChatCommand("hướng dẫn")!;
    const withSend = await runChatCommand({ db, asker: null, inGroup: false, now: T, send: allowed }, command);
    assert.match(withSend ?? "", /GỬI TIN THEO LỆNH/);
    const without = await runChatCommand({ db, asker: null, inGroup: false, now: T }, command);
    assert.doesNotMatch(without ?? "", /GỬI TIN THEO LỆNH/);
  });
});
