// Lời mời họp vào nhóm từ tin riêng (propose_meeting_announcement) trên MySQL THẬT, qua AssistantService với Calendar giả:
// create_meeting + propose_meeting_announcement → câu trả lời có dòng link + bản xem trước 1 nhóm; «đồng ý» → job gửi ĐÚNG nội dung do
// máy chủ dựng (mô hình có nhét body/content vào lời gọi cũng không vào được); nhóm Mật / ngoài quyền / không thấy họp bị từ chối.
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/<csdl_thử> npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { JobKind, SendCommandStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { JobRow } from "../src/jobs/job-queue.js";
import { confirmDraft } from "../src/send-commands/send-command-actions.js";
import { runSendTargetJob } from "../src/send-commands/send-command-delivery.js";
import type { SendCommandDeps, SendDeliveryDeps, SendDeliveryPort } from "../src/send-commands/send-command-deps.js";
import { findCommand, listTargets } from "../src/send-commands/send-command-repository.js";
import { loadSendRequester } from "../src/send-commands/send-target-resolver.js";
import { AssistantService } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import type { MeetingCreator } from "../src/assistant/meeting-tool.js";
import type { BotMeeting } from "../src/google/calendar-meetings.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { directKey, ensureThread, markBotInGroup } from "../src/sync/group-repository.js";
import { databaseUrl, makeCalendar, resetTables, seedWorld, vn, type Phase8World } from "./phase8-brief-fixtures.js";

const T = vn("2026-10-12 09:00");
const READ = { readMessages: true, captureFiles: false };
const G1 = "TEST Sales Miền Tây";
const NOON = "2026-10-12T12:00:00+07:00";
const LINK = "https://meet.google.com/yec-kwmc-dqr";
const EXPECTED_BODY = `Mời họp: Họp team bot\nLúc: 12:00 T2 12/10\nLink Google Meet: ${LINK}`;

describe("lời mời họp vào nhóm từ tin riêng", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let world: Phase8World;
  let deps: SendCommandDeps;
  const direct = new Map<string, number>();
  const delivered: { threadId: number; text: string }[] = [];
  const port: SendDeliveryPort = {
    deliver: async (request) => { delivered.push({ threadId: request.threadId, text: request.text }); },
    createReminder: async () => { throw new Error("lời mời họp không được đi đường nhắc hẹn"); },
  } as unknown as SendDeliveryPort;
  let calendarMeetings: BotMeeting[] = [];
  let created = 0;

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
    for (const groupId of [world.g1, world.g2, world.g3]) await markBotInGroup(db, world.botId, groupId);
    direct.clear();
    for (const uid of ["u-mi", "u-phong"]) direct.set(uid, (await ensureThread(db, directKey(world.botId, uid), READ, uid)).group.id);
    delivered.length = 0;
    calendarMeetings = [];
    created = 0;
    deps = { db, calendar: makeCalendar(), wakeJobs: () => undefined };
  });

  const meeting = (over: Partial<BotMeeting> = {}): BotMeeting => ({
    id: "ev1", title: "Họp team bot", startTime: Date.parse(NOON), endTime: Date.parse(NOON) + 3_600_000, meetLink: LINK,
    requesterUid: "u-mi", createdAt: T.getTime() - 60_000, ...over,
  });
  const scheduler = (): MeetingCreator => ({
    connected: true,
    createMeeting: async (input) => {
      created += 1;
      calendarMeetings.push(meeting({ title: input.title, startTime: input.startTime, endTime: input.startTime + 3_600_000, requesterUid: input.requesterUid, createdAt: T.getTime() }));
      return { eventId: "ev1", meetLink: LINK, eventLink: "https://cal/ev1" };
    },
    listMeetings: async () => calendarMeetings,
    cancelMeeting: async () => undefined,
  });
  /** Một lượt hỏi: mô hình giả lần lượt gọi các công cụ trong `calls`; gọi quá số lượt = lỗi (đã có bản xem trước thì không gọi mô hình nữa). */
  async function ask(uid: string, question: string, calls: { name: string; args: Record<string, unknown> }[]): Promise<string> {
    const turns: GeminiContent["parts"][] = calls.map((call) => [{ functionCall: call }]);
    const model: ModelClient = {
      generate: async () => {
        const parts = turns.shift();
        if (!parts) throw new Error("không được gọi mô hình sau khi đã có câu trả lời cố định");
        return { content: { role: "model" as const, parts }, inputTokens: 10, outputTokens: 5 };
      },
    };
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => T, { sendCommands: deps, meetingScheduler: scheduler() });
    const reply = await service.answer({
      botAccountId: world.botId, contact: (await findContactByUid(db, uid))!, threadId: direct.get(uid)!, questionMessageId: null, question,
    });
    return reply.text ?? "";
  }
  const commandIdOf = (reply: string): number => Number(reply.match(/G-(\d+)/)?.[1]);
  const countCommands = async (): Promise<number> => Number(((await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM send_command"))[0][0]).n);
  const sendJobs = async () => (await db.query<RowDataPacket[]>("SELECT * FROM job WHERE kind = ? ORDER BY id", [JobKind.SendCommandTarget]))[0];
  const jobRow = (row: RowDataPacket): JobRow => ({
    id: Number(row.id), kind: JobKind.SendCommandTarget, payload: row.payload, serialKey: row.serial_key, attempts: 1, maxAttempts: 3, createdAt: new Date(),
  });

  test("create_meeting + propose_meeting_announcement: dòng link đứng trên bản xem trước 1 nhóm; «đồng ý» → job gửi đúng nội dung máy chủ dựng", async () => {
    const reply = await ask("u-mi", `tạo cuộc họp 12h trưa nay và gửi lên nhóm ${G1}`, [
      { name: "create_meeting", args: { title: "Họp team bot", start_time: NOON } },
      // Mô hình cố nhét nội dung riêng: phải bị bỏ qua hoàn toàn
      { name: "propose_meeting_announcement", args: { groups: [G1], body: "NỘI DUNG GIẢ", content: "NỘI DUNG GIẢ" } },
    ]);
    assert.equal(created, 1);
    assert.match(reply, new RegExp(`^Đã tạo cuộc họp Google Meet «Họp team bot» lúc 12:00 12/10/2026: ${LINK}\n\nXEM TRƯỚC LỆNH GỬI G-\\d+`));
    assert.match(reply, new RegExp(`Gửi tới 1 nơi:\n1\\. Nhóm «${G1}» \\(nội bộ\\)`));
    assert.ok(reply.includes(`Nội dung: «${EXPECTED_BODY}»`));
    assert.doesNotMatch(reply, /NỘI DUNG GIẢ/);
    const id = commandIdOf(reply);
    const command = (await findCommand(db, id))!;
    assert.equal(command.status, SendCommandStatus.Draft);
    assert.equal(command.body, EXPECTED_BODY);

    const ok = await confirmDraft(deps, (await loadSendRequester(db, "u-mi"))!, "latest", T);
    assert.match(ok.reply, /Đã nhận lệnh G-\d+/);
    const jobs = await sendJobs();
    assert.equal(jobs.length, 1);
    const sendDeps: SendDeliveryDeps = { ...deps, port };
    await runSendTargetJob(sendDeps, jobRow(jobs[0]), T);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].threadId, world.g1);
    assert.equal(delivered[0].text, EXPECTED_BODY);
    assert.equal((await listTargets(db, id))[0].threadId, world.g1);
  });

  test("họp đã tạo ở lượt trước: chỉ propose_meeting_announcement (không tạo họp mới) — chọn cuộc người hỏi vừa tạo", async () => {
    calendarMeetings = [meeting(), meeting({ id: "ev-khac", title: "Họp khác", requesterUid: "u-phong", createdAt: T.getTime() - 1000 })];
    const reply = await ask("u-mi", `gửi link họp vừa tạo vào nhóm ${G1}`, [{ name: "propose_meeting_announcement", args: { groups: [G1] } }]);
    assert.equal(created, 0);
    assert.match(reply, /^XEM TRƯỚC LỆNH GỬI G-\d+/);
    assert.ok(reply.includes(EXPECTED_BODY));
  });

  test("không thấy cuộc họp / nhiều cuộc khớp: trả câu cố định, không tạo nháp", async () => {
    const none = await ask("u-mi", `gửi link họp vào nhóm ${G1}`, [{ name: "propose_meeting_announcement", args: { groups: [G1] } }]);
    assert.match(none, /^Em chưa thấy cuộc họp nào bot tạo/);
    calendarMeetings = [meeting(), meeting({ id: "ev2", startTime: Date.parse(NOON) + 7_200_000, endTime: Date.parse(NOON) + 10_800_000 })];
    const many = await ask("u-mi", `gửi link họp team bot vào nhóm ${G1}`, [{ name: "propose_meeting_announcement", args: { groups: [G1], meeting_title: "họp team" } }]);
    assert.match(many, /thấy 2 cuộc họp khớp[\s\S]*1\. Họp team bot — 12:00 T2 12\/10[\s\S]*2\. Họp team bot — 14:00 T2 12\/10/);
    assert.equal(await countCommands(), 0);
  });

  test("luật nhóm như lệnh gửi: tên nhóm phải có trong tin người hỏi; nhóm Mật chỉ người nhận đã chọn", async () => {
    calendarMeetings = [meeting()];
    const missing = await ask("u-mi", "gửi link họp vừa tạo lên nhóm", [{ name: "propose_meeting_announcement", args: { groups: [G1] } }]);
    assert.match(missing, /Tên nơi nhận phải đúng/);
    const secret = await ask("u-mi", "gửi link họp vừa tạo vào nhóm TEST BGĐ Công nợ", [{ name: "propose_meeting_announcement", args: { groups: ["TEST BGĐ Công nợ"] } }]);
    assert.match(secret, /nhóm Mật/);
    assert.equal(await countCommands(), 0);
    calendarMeetings = [meeting({ requesterUid: "u-phong" })];
    const chosen = await ask("u-phong", "gửi link họp vừa tạo vào nhóm TEST BGĐ Công nợ", [{ name: "propose_meeting_announcement", args: { groups: ["TEST BGĐ Công nợ"] } }]);
    assert.match(chosen, /\(nội bộ, Mật\)/);
  });
});
