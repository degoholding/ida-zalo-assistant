// Vá sau review cho loại tài khoản «Normal» / nhóm «chỉ lưu» (17/10/2026) trên MySQL THẬT:
//   H1 bỏ việc vĩnh viễn chỉ khi DB không còn bot Trợ lý dùng được; bot Trợ lý của nhóm chưa chạy → lỗi thử lại, không lùi sang bot khác
//   H2 việc / ticket của nhóm «chỉ lưu» vẫn báo, qua tin riêng (bot Trợ lý); tin riêng thuộc bot Normal đổi đường sang bot Trợ lý
//   M4 «chỉ lưu» dính (bot Normal rời nhóm vẫn là chỉ lưu); L4 recap đã Queued của nhóm chỉ lưu bị bỏ
//   L5 PATCH /api/accounts/:id: kiểm kind, audit, đổi loại sống, không khởi động lại khi Đang dùng không đổi
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/bot_tro_ly_test_kindfix npm test

import assert from "node:assert/strict";
import type http from "node:http";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { SessionStore } from "../src/auth/session-store.js";
import { BotAccountKind, BotAccountStatus, ConversationType, GroupKind, JobKind, MeetingRecordingStatus, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { deliverContactMessage } from "../src/messaging/contact-message-delivery.js";
import { processRecording } from "../src/meetings/meeting-recap-pipeline.js";
import { claimNext, insertDiscovered } from "../src/meetings/meeting-recording-repository.js";
import { SyncService } from "../src/sync-service.js";
import { isCollectOnlyThread } from "../src/sync/collect-only.js";
import { directKey, ensureGroup, ensureThread, findThreadById } from "../src/sync/group-repository.js";
import { noSendableRunnerError } from "../src/sync/sendable-runner-picker.js";
import { notifyTaskParty } from "../src/tasks/task-notify.js";
import type { TaskRow } from "../src/tasks/task-repository.js";
import { acceptTicket, createTicket, findTicket } from "../src/tickets/ticket-service.js";
import { handleApiRequest, type ApiDeps } from "../src/web/api/api-router.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["ticket_event", "ticket_attachment", "ticket", "meeting_recording", "job", "audit_log", "web_session", "app_user",
  "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account"];
const READ = { readMessages: true, captureFiles: false };
const NOW = new Date("2026-10-17T03:00:00Z");

describe("vá sau review: bot Normal / nhóm chỉ lưu", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let normalBot = 0;
  let assistantBot = 0;
  let onlyNormal = 0;
  let both = 0;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    normalBot = (await db.query<ResultSetHeader>("INSERT INTO bot_account (label, zalo_uid, session_cipher, kind) VALUES ('thu-thap', 'u-bot-n', 'x', ?)", [BotAccountKind.Normal]))[0].insertId;
    assistantBot = (await db.query<ResultSetHeader>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('tro-ly', 'u-bot-a', 'x')"))[0].insertId;
    onlyNormal = (await ensureGroup(db, "g-only", READ)).group.id;
    both = (await ensureGroup(db, "g-both", READ)).group.id;
    for (const id of [onlyNormal, both]) await db.query("UPDATE zalo_group SET group_kind = ?, name = CONCAT('Nhóm ', zalo_group_id) WHERE id = ?", [GroupKind.Internal, id]);
    await db.query("INSERT INTO bot_group (bot_account_id, group_id) VALUES (?, ?), (?, ?), (?, ?)", [normalBot, onlyNormal, normalBot, both, assistantBot, both]);
    await db.query("INSERT INTO group_member (group_id, zalo_uid, display_name) VALUES (?, 'u-nv', 'Nhân Viên'), (?, 'u-nv', 'Nhân Viên')", [onlyNormal, both]);
  });

  const makeService = (runners: Record<number, { isCollectOnly: boolean }>): any => {
    const service = Object.create(SyncService.prototype) as any;
    service.db = db;
    service.runners = new Map(Object.entries(runners).map(([id, runner]) => [Number(id), runner]));
    return service;
  };
  const jobPayloads = async (): Promise<any[]> => {
    const [rows] = await db.query<RowDataPacket[]>("SELECT payload FROM job WHERE kind = ? ORDER BY id", [JobKind.ContactMessage]);
    return rows.map((row) => (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload));
  };

  describe("H1 bỏ việc chỉ khi hệ thống thật sự hết bot Trợ lý", () => {
    test("còn bot Trợ lý bật + có phiên (dù chưa chạy): lỗi thường để thử lại; tắt / mất phiên / cần đăng nhập → bỏ việc", async () => {
      const retryable = await noSendableRunnerError(db, "nhắn riêng");
      assert.notEqual(retryable.name, "JobSkippedError");
      await db.query("UPDATE bot_account SET status = ? WHERE id = ?", [BotAccountStatus.NeedsLogin, assistantBot]);
      assert.equal((await noSendableRunnerError(db, "nhắn riêng")).name, "JobSkippedError");
      await db.query("UPDATE bot_account SET status = 0, is_active = 0 WHERE id = ?", [assistantBot]);
      assert.equal((await noSendableRunnerError(db, "nhắn riêng")).name, "JobSkippedError");
      await db.query("UPDATE bot_account SET is_active = 1, session_cipher = NULL WHERE id = ?", [assistantBot]);
      assert.equal((await noSendableRunnerError(db, "nhắn riêng")).name, "JobSkippedError");
    });

    test("runnerForUid: chỉ bot Normal đang chạy nhưng bot Trợ lý vẫn bật (chưa kết nối) → lỗi thử lại, không bỏ việc", async () => {
      const service = makeService({ [normalBot]: { isCollectOnly: true } });
      await assert.rejects(service.runnerForUid("u-p"), (error: Error) => error.name !== "JobSkippedError");
    });

    test("runnerForThread: bot Trợ lý của nhóm chưa chạy → lỗi thử lại, KHÔNG lùi sang bot Trợ lý khác, KHÔNG bỏ việc", async () => {
      const other = { isCollectOnly: false, name: "bot-khac" };
      const service = makeService({ [normalBot]: { isCollectOnly: true }, 999: other });
      const thread = (await findThreadById(db, both))!;
      await assert.rejects(service.runnerForThread(thread), (error: Error) => error.name !== "JobSkippedError" && /đang tắt hoặc chưa kết nối/.test(error.message));
    });

    test("runnerForThread: cuộc riêng của bot Trợ lý chưa chạy → lỗi thử lại, không lùi sang bot khác", async () => {
      const dm = (await ensureThread(db, directKey(assistantBot, "u-y"), READ, "Y")).group;
      const service = makeService({ 999: { isCollectOnly: false } });
      await assert.rejects(service.runnerForThread(dm), (error: Error) => error.name !== "JobSkippedError");
    });

    test("L1: ô soạn báo riêng «bot Trợ lý của nhóm đang tắt» khác với nhóm chỉ lưu", async () => {
      const service = makeService({});
      await assert.rejects(service.pickRunnerForThread(both), (error: Error) => error.name !== "CollectOnlyAccountError" && /Trợ lý.*tắt/.test(error.message));
      const normalOnly = makeService({ [normalBot]: { isCollectOnly: true } });
      await assert.rejects(normalOnly.pickRunnerForThread(onlyNormal), (error: Error) => error.name === "CollectOnlyAccountError");
    });
  });

  describe("M4 «chỉ lưu» dính", () => {
    test("bot Normal rời nhóm vẫn là chỉ lưu; bot Trợ lý vào thì hết chỉ lưu; nhóm chưa từng có bot Normal giữ như cũ", async () => {
      await db.query("UPDATE bot_group SET left_at = NOW(3) WHERE bot_account_id = ? AND group_id = ?", [normalBot, onlyNormal]);
      assert.equal(await isCollectOnlyThread(db, onlyNormal), true);
      await db.query("INSERT INTO bot_group (bot_account_id, group_id) VALUES (?, ?)", [assistantBot, onlyNormal]);
      assert.equal(await isCollectOnlyThread(db, onlyNormal), false);
      const neverNormal = (await ensureGroup(db, "g-never", READ)).group.id;
      await db.query("INSERT INTO bot_group (bot_account_id, group_id, left_at) VALUES (?, ?, NOW(3))", [assistantBot, neverNormal]);
      assert.equal(await isCollectOnlyThread(db, neverNormal), false);
    });
  });

  describe("H2 việc / ticket của nhóm chỉ lưu vẫn báo qua tin riêng", () => {
    const task = (threadId: number): TaskRow => ({
      id: 7, source_thread_id: threadId, assigner: { uid: "u-giao", contactId: null, name: "Giao" },
    } as unknown as TaskRow);

    test("nhắc việc: nhóm chỉ lưu → job nhắn riêng (zaloUid); nhóm có bot Trợ lý → vào nhóm gắn thẻ", async () => {
      const party = { uid: "u-nv", contactId: null, name: "Nhân Viên" };
      await notifyTaskParty({ db }, task(onlyNormal), party, "nhắc việc", "t1");
      await notifyTaskParty({ db }, task(both), party, "nhắc việc", "t2");
      const [dm, group] = await jobPayloads();
      assert.equal(dm.zaloUid, "u-nv");
      assert.equal(dm.threadId, undefined);
      assert.equal(group.threadId, both);
      assert.deepEqual(group.mentionUids, ["u-nv"]);
    });

    test("tin báo ticket: nơi báo là nhóm chỉ lưu → nhắn riêng người gửi; nhóm có bot Trợ lý → vào nhóm", async () => {
      const actor = { name: "Xử lý", contactId: null, via: "web" as const };
      for (const threadId of [onlyNormal, both]) {
        const { ticket } = await createTicket({ db }, {
          requesterContactId: null, requesterUid: "u-nv", requesterName: "Nhân Viên", sourceThreadId: threadId, sourceMessageId: null,
          botAccountId: assistantBot, text: `Hỏng máy ${threadId}`, now: NOW,
        });
        await acceptTicket({ db }, (await findTicket(db, ticket.id))!, actor);
      }
      const payloads = (await jobPayloads()).filter((payload) => /đã được/.test(String(payload.text)));
      assert.equal(payloads.length, 2);
      const byText = (id: number) => payloads.find((payload) => String(payload.text).includes(`Hỏng máy ${id}`));
      assert.equal(byText(onlyNormal)?.zaloUid, "u-nv");
      assert.equal(byText(onlyNormal)?.threadId, undefined);
      assert.equal(byText(both)?.threadId, both);
    });

    test("giao tin: job vào cuộc riêng của bot Normal được chuyển thành nhắn riêng qua bot Trợ lý", async () => {
      const dm = (await ensureThread(db, directKey(normalBot, "u-x"), READ, "Người X")).group;
      const sent: string[] = [];
      const assistantRunner = { sendDirectText: async (uid: string, _name: string, text: string) => { sent.push(`${uid}:${text}`); } };
      const deps = {
        db,
        runnerForThread: async () => { throw new Error("không được gọi runnerForThread cho cuộc riêng của bot Normal"); },
        runnerForUid: async (uid: string) => { assert.equal(uid, "u-x"); return assistantRunner as never; },
      };
      await db.query("INSERT INTO job (kind, payload, status, run_after) VALUES (?, '{}', 0, NOW(3))", [JobKind.ContactMessage]);
      const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM job ORDER BY id DESC LIMIT 1");
      const job = { id: Number(rows[0].id), kind: JobKind.ContactMessage, payload: {}, serialKey: null, attempts: 1, maxAttempts: 4, createdAt: NOW };
      await deliverContactMessage(deps, { threadId: dm.id, text: "chào" }, job as never);
      assert.deepEqual(sent, ["u-x:chào"]);
    });
  });

  test("L4 recap đã Queued của nhóm chỉ lưu: bỏ qua trước khi gọi AI, ghi chú rõ", async () => {
    await insertDiscovered(db, {
      driveFileId: "drv-1", fileName: "hop.m4a", mime: "audio/mp4", sizeBytes: 1000, driveCreatedAt: NOW,
      status: MeetingRecordingStatus.Queued, targetThreadId: onlyNormal, requesterUid: "u-nv",
    });
    const claimed = (await claimNext(db, NOW, 3))!;
    const deps = {
      db, config: { meetingRecap: { maxBytes: 1_000_000 }, assistant: { dailyTokenCap: 1_000_000 } }, storage: {} as never, calendar: null,
      buildModel: async () => ({ readAudioSource: () => { throw new Error("không được gọi AI"); } }) as never,
    };
    await processRecording(deps as never, claimed, NOW);
    const [rows] = await db.query<RowDataPacket[]>("SELECT status, note FROM meeting_recording WHERE id = ?", [claimed.id]);
    assert.equal(Number(rows[0].status), MeetingRecordingStatus.Skipped);
    assert.match(String(rows[0].note), /chỉ lưu/);
  });

  describe("L5 PATCH /api/accounts/:id", () => {
    let apiDeps: ApiDeps;
    let token = "";
    let calls: string[] = [];

    before(async () => {
      const service = {
        db, config: { google: { loginClientId: "" }, privacy: { allowedAiProviders: ["1"] } }, isRunning: () => true,
        setAccountKind: (id: number, kind: number) => { calls.push(`kind:${id}:${kind}`); },
        restartAccount: async (id: number) => { calls.push(`restart:${id}`); return true; },
        stopAccount: async (id: number) => { calls.push(`stop:${id}`); },
      };
      apiDeps = { service: service as unknown as ApiDeps["service"], sessions: new SessionStore(db), qrLogins: {} as ApiDeps["qrLogins"] };
    });

    beforeEach(async () => {
      calls = [];
      const [result] = await db.query<ResultSetHeader>("INSERT INTO app_user (username, email, full_name, role, all_groups, is_active) VALUES ('qt', 'qt@ida.vn', 'qt', ?, 1, 1)", [UserRole.Admin]);
      token = await apiDeps.sessions.create(result.insertId);
    });

    async function patch(id: number, body: unknown) {
      const request = new PassThrough() as unknown as http.IncomingMessage & PassThrough;
      Object.assign(request, { method: "PATCH", url: `/api/accounts/${id}`, headers: { host: "localhost" } });
      (request as unknown as PassThrough).end(JSON.stringify(body));
      let status = 200;
      let raw = "";
      const response = {
        headersSent: false, setHeader: () => undefined, writeHead: (code: number) => { status = code; return response; },
        end: (chunk?: string) => { raw = chunk ?? ""; }, write: () => true, on: () => response, destroy: () => undefined,
      } as unknown as http.ServerResponse;
      await handleApiRequest({ request, response, url: new URL(`/api/accounts/${id}`, "http://localhost") }, apiDeps, { token, clientKey: "t", setCookie: (v) => `s=${v}` });
      return { status, body: raw ? JSON.parse(raw) : null };
    }
    const kindOf = async (id: number) => Number(((await db.query<RowDataPacket[]>("SELECT kind FROM bot_account WHERE id = ?", [id]))[0])[0].kind);

    test("kind chỉ nhận đúng 0 / 1 hoặc \"0\" / \"1\"; mọi giá trị khác 422 và không ghi gì", async () => {
      for (const bad of [2, -1, "", true, null, 1.5, "abc", "1 ", [1], {}, " "]) {
        const result = await patch(assistantBot, { kind: bad });
        assert.equal(result.status, 422, `kind=${JSON.stringify(bad)}`);
      }
      assert.equal(await kindOf(assistantBot), BotAccountKind.Assistant);
      assert.deepEqual(calls, []);
    });

    test("đổi loại: ghi DB + audit + áp dụng ngay vào runner đang chạy, KHÔNG dừng / chạy lại tài khoản", async () => {
      const result = await patch(assistantBot, { kind: "1" });
      assert.equal(result.status, 200);
      assert.equal(result.body.message, "Đã lưu loại tài khoản");
      assert.equal(await kindOf(assistantBot), BotAccountKind.Normal);
      assert.deepEqual(calls, [`kind:${assistantBot}:1`]);
      const [audit] = await db.query<RowDataPacket[]>("SELECT action, changed_fields FROM audit_log WHERE entity = 'bot_account' AND entity_id = ?", [assistantBot]);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, "update");
    });

    test("gửi lại cùng loại và cùng Đang dùng: không đổi gì, không audit, không khởi động lại", async () => {
      const result = await patch(assistantBot, { kind: 0, is_active: true });
      assert.equal(result.status, 200);
      assert.deepEqual(calls, []);
      assert.equal(Number(((await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_log"))[0])[0].n), 0);
    });

    test("tắt rồi bật: chỉ khi Đang dùng thật sự đổi mới dừng / chạy lại", async () => {
      assert.equal((await patch(assistantBot, { is_active: false })).body.message, "Đã tắt tài khoản bot");
      assert.equal((await patch(assistantBot, { is_active: true })).body.message, "Đã bật tài khoản bot");
      assert.deepEqual(calls, [`stop:${assistantBot}`, `restart:${assistantBot}`]);
    });
  });
});
