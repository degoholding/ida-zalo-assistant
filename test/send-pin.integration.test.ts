// Ghim ghi chú lên nhóm từ tin riêng trên MySQL THẬT (không cần Zalo): nháp xem trước (chỉ nhóm, quyền như nhắc hẹn / lệnh gửi), «đồng ý»
// → job → cổng giả ghim ĐÚNG MỘT lần (thử lại không trùng), bot tắt → lỗi, báo kết quả một lần; qua AssistantService với Calendar giả:
// ghim cuộc họp (nội dung do máy chủ dựng) và ghim nội dung do mô hình soạn.
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/<csdl_thử> npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { JobKind, SendActionKind, SendCommandStatus, SendTargetStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { JobRow } from "../src/jobs/job-queue.js";
import { BotHaltedError } from "../src/messaging/bot-halted-error.js";
import { confirmDraft } from "../src/send-commands/send-command-actions.js";
import { runSendTargetJob } from "../src/send-commands/send-command-delivery.js";
import type { SendCommandDeps, SendDeliveryDeps, SendDeliveryPort, SendPinRequest } from "../src/send-commands/send-command-deps.js";
import { findCommand, listTargets } from "../src/send-commands/send-command-repository.js";
import { resendFailedTargets } from "../src/send-commands/send-command-web-actions.js";
import { loadSendRequester } from "../src/send-commands/send-target-resolver.js";
import { createPinDraft } from "../src/send-commands/send-pin-draft-service.js";
import { AssistantService } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import type { MeetingCreator } from "../src/assistant/meeting-tool.js";
import type { BotMeeting } from "../src/google/calendar-meetings.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { directKey, ensureGroup, ensureThread, markBotInGroup } from "../src/sync/group-repository.js";
import { databaseUrl, makeCalendar, resetTables, seedWorld, vn, type Phase8World } from "./phase8-brief-fixtures.js";

const T = vn("2026-10-12 09:00");
const READ = { readMessages: true, captureFiles: false };
const G1 = "TEST Sales Miền Tây";
const MEETING_START = "2026-10-12T15:00:00+07:00";
const LINK = "https://meet.google.com/yec-kwmc-dqr";
const MEETING_BODY = `Cuộc họp: Họp team bot\nLúc: 15:00 T2 12/10\nLink Google Meet: ${LINK}`;

describe("ghim lên nhóm từ tin riêng", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let world: Phase8World;
  let deps: SendCommandDeps;
  const direct = new Map<string, number>();
  const pinned: SendPinRequest[] = [];
  let portError: Error | null = null;
  let calendarMeetings: BotMeeting[] = [];
  const port: SendDeliveryPort = {
    deliver: async () => { throw new Error("ghim không được đi đường gửi tin"); },
    createReminder: async () => { throw new Error("ghim không được đi đường nhắc hẹn"); },
    createPin: async (request) => {
      if (portError) throw portError;
      pinned.push(request);
    },
  };
  const deliveryDeps = (): SendDeliveryDeps => ({ ...deps, port });

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
    const { group } = await ensureGroup(db, "z-kho-hn", READ);
    await db.query("UPDATE zalo_group SET name = 'Kho HN', group_kind = 2 WHERE id = ?", [group.id]);
    await markBotInGroup(db, world.botId, group.id);
    direct.clear();
    for (const uid of ["u-mi", "u-phong", "u-tuan", "u-huy"]) direct.set(uid, (await ensureThread(db, directKey(world.botId, uid), READ, uid)).group.id);
    pinned.length = 0;
    portError = null;
    calendarMeetings = [];
    deps = { db, calendar: makeCalendar(), wakeJobs: () => undefined };
  });

  async function draft(uid: string, groups: string[], content = "Nộp báo cáo tuần trước thứ 6", question?: string): Promise<string> {
    const requester = await loadSendRequester(db, uid);
    return (await createPinDraft(deps, {
      requester: requester!, question: question ?? `ghim lên ${groups.join(", ")}: ${content}`, groupNames: groups, content, sourceThreadId: direct.get(uid)!,
    }, T)).reply;
  }
  const commandIdOf = (reply: string): number => Number(reply.match(/G-(\d+)/)?.[1]);
  const countCommands = async (): Promise<number> => Number(((await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM send_command"))[0][0]).n);
  const sendJobs = async () => (await db.query<RowDataPacket[]>("SELECT * FROM job WHERE kind = ? ORDER BY id", [JobKind.SendCommandTarget]))[0];
  const reportJobs = async () => (await db.query<RowDataPacket[]>("SELECT * FROM job WHERE kind = ? AND dedupe_key LIKE 'sendcmd-report:%'", [JobKind.ContactMessage]))[0];
  const jobRow = (row: RowDataPacket, attempts = 1): JobRow => ({
    id: Number(row.id), kind: JobKind.SendCommandTarget, payload: row.payload, serialKey: row.serial_key, attempts, maxAttempts: 3, createdAt: new Date(),
  });
  const confirm = async (uid: string) => confirmDraft(deps, (await loadSendRequester(db, uid))!, "latest", T);

  test("nháp: xem trước do máy chủ dựng, lưu action_kind = 3 và body = nội dung ghim, không giờ hẹn", async () => {
    const reply = await draft("u-mi", [G1, "Kho HN"]);
    assert.match(reply, /^XEM TRƯỚC GHIM G-\d+\nGhim lên 2 nhóm:/);
    assert.match(reply, new RegExp(`1\\. Nhóm «${G1}» \\(nội bộ\\)`));
    assert.match(reply, /Nội dung ghim: «Nộp báo cáo tuần trước thứ 6»/);
    assert.match(reply, /Nhắn «đồng ý» trong 15 phút để ghim, «hủy» để bỏ\./);
    const command = (await findCommand(db, commandIdOf(reply)))!;
    assert.equal(command.status, SendCommandStatus.Draft);
    assert.equal(command.actionKind, SendActionKind.Pin);
    assert.equal(command.body, "Nộp báo cáo tuần trước thứ 6");
    assert.equal(command.reminderAt, null);
    assert.equal(command.scheduledAt, null);
    assert.equal((await listTargets(db, command.id)).length, 2);
  });

  test("CHỈ nhóm: tên trỏ tới người, nhóm khách, nhóm Mật ngoài quyền, tên mơ hồ / không thấy → không tạo nháp; người đã chọn nhóm Mật thì được", async () => {
    assert.match(await draft("u-mi", ["anh Huy"]), /là một người, không phải nhóm — ghim chỉ làm được cho nhóm/);
    const guest = await draft("u-mi", ["TEST ĐL Thành Công"]);
    assert.match(guest, /nhóm khách — ghim từ tin riêng chỉ làm cho nhóm nội bộ/);
    assert.doesNotMatch(guest, /Hội thoại trên web/);
    assert.match(await draft("u-mi", ["TEST BGĐ Công nợ"]), /nhóm Mật — chỉ người nhận đã chọn đúng nhóm này mới ghim được/);
    assert.match(await draft("u-mi", ["Nhóm Không Tồn Tại"]), /Em không thấy nhóm nội bộ nào/);
    assert.equal(await countCommands(), 0);
    assert.match(await draft("u-phong", ["TEST BGĐ Công nợ"]), /\(nội bộ, Mật\)/);
  });

  test("từ chối nội dung rỗng / quá dài / tên nhóm không có trong tin người hỏi / quá 10 nhóm / không đủ quyền", async () => {
    assert.match(await draft("u-mi", [G1], "  "), /nội dung ghim đang trống/);
    assert.match(await draft("u-mi", [G1], "x".repeat(1001)), /dài 1001 ký tự — tối đa 1000/);
    assert.match(await draft("u-mi", [G1], "Họp", "ghim cuộc họp lên nhóm"), /Tên nhóm phải đúng/);
    assert.match(await draft("u-mi", Array.from({ length: 11 }, (_, index) => `Nhóm N${index}`)), /tối đa 10 nhóm/);
    assert.equal(await countCommands(), 0);
    assert.equal((await draft("u-mi", [G1], "x".repeat(1000))).startsWith("XEM TRƯỚC GHIM"), true);
  });

  test("đồng ý: một job mỗi nhóm; giao ghim đúng 1 lần (checkExisting = false); chạy lại không ghim trùng; báo kết quả đúng một tin", async () => {
    const id = commandIdOf(await draft("u-mi", [G1, "Kho HN"]));
    const reply = await confirm("u-mi");
    assert.match(reply.reply, /Đã nhận lệnh G-\d+: ghim lên 2 nhóm\. Ghim xong em báo kết quả\./);
    const jobs = await sendJobs();
    assert.equal(jobs.length, 2);
    for (const row of jobs) await runSendTargetJob(deliveryDeps(), jobRow(row), T);
    assert.equal(pinned.length, 2);
    for (const request of pinned) {
      assert.equal(request.content, "Nộp báo cáo tuần trước thứ 6");
      assert.equal(request.checkExisting, false);
    }
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Done);
    const reports = await reportJobs();
    assert.equal(reports.length, 1);
    assert.match(reports[0].payload.text, /KẾT QUẢ GHIM G-\d+: 2\/2 nhóm thành công/);
    assert.match(reports[0].payload.text, /nhóm «Kho HN»: đã ghim/);
    for (const row of jobs) await runSendTargetJob(deliveryDeps(), jobRow(row, 2), T);
    assert.equal(pinned.length, 2, "job chạy lại không ghim trùng");
    assert.equal((await reportJobs()).length, 1);
  });

  test("lỗi tạm thời: ném để thử lại, nơi vẫn Queued; thử lại (checkExisting = true) thành công thì ghim đúng 1 lần", async () => {
    const id = commandIdOf(await draft("u-mi", [G1]));
    await confirm("u-mi");
    const [row] = await sendJobs();
    portError = new Error("Zalo từ chối");
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow(row, 1), T), /Zalo từ chối/);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Queued);
    portError = null;
    await runSendTargetJob(deliveryDeps(), jobRow(row, 2), T);
    await runSendTargetJob(deliveryDeps(), jobRow(row, 3), T);
    assert.equal(pinned.length, 1);
    assert.equal(pinned[0].checkExisting, true);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Sent);
  });

  test("bot tắt khẩn: nơi Failed «tắt khẩn», ném BotHaltedError, báo LỖI; gửi lại từ web → ghim với checkExisting = true, không báo lại", async () => {
    const id = commandIdOf(await draft("u-mi", [G1]));
    await confirm("u-mi");
    portError = new BotHaltedError();
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]), T), BotHaltedError);
    const [failed] = await listTargets(db, id);
    assert.equal(failed.status, SendTargetStatus.Failed);
    assert.match(failed.error, /tắt khẩn/);
    assert.equal(pinned.length, 0);
    assert.match((await reportJobs())[0].payload.text, /KẾT QUẢ GHIM G-\d+: 0\/1 nhóm thành công[\s\S]*LỖI — bot đang tắt khẩn[\s\S]*màn Gửi tin/);
    portError = null;
    assert.match((await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, id, T)).reply, /Đã xếp gửi lại 1\/1/);
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[1]), T);
    assert.equal(pinned.length, 1);
    assert.equal(pinned[0].checkExisting, true);
    assert.equal((await reportJobs()).length, 1, "không báo lại");
  });

  test("giao: người ra lệnh mất quyền, hoặc nhóm thành nhóm khách → nơi Failed, không ghim", async () => {
    const lost = commandIdOf(await draft("u-tuan", [G1]));
    await confirm("u-tuan");
    await db.query("UPDATE contact SET role = 0 WHERE zalo_uid = 'u-tuan'");
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]), T);
    assert.match((await listTargets(db, lost))[0].error, /không còn quyền/);
    const guest = commandIdOf(await draft("u-mi", ["Kho HN"]));
    await confirm("u-mi");
    await db.query("UPDATE zalo_group SET group_kind = 1 WHERE name = 'Kho HN'");
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[1]), T);
    assert.equal((await listTargets(db, guest))[0].status, SendTargetStatus.Failed);
    assert.equal(pinned.length, 0);
  });

  const meeting = (over: Partial<BotMeeting> = {}): BotMeeting => ({
    id: "ev1", title: "Họp team bot", startTime: Date.parse(MEETING_START), endTime: Date.parse(MEETING_START) + 3_600_000, meetLink: LINK,
    requesterUid: "u-mi", createdAt: T.getTime() - 60_000, ...over,
  });
  const scheduler = (): MeetingCreator => ({
    connected: true,
    createMeeting: async () => { throw new Error("ghim không được tạo họp mới"); },
    listMeetings: async () => calendarMeetings,
    cancelMeeting: async () => undefined,
  });
  /** Một lượt hỏi qua AssistantService: mô hình giả gọi lần lượt các công cụ; đã có bản xem trước thì không gọi mô hình nữa. */
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

  test("lượt AI: ghim cuộc họp vừa tạo → nội dung máy chủ dựng từ Calendar (chữ mô hình nhét vào content bị bỏ); đồng ý → job ghim đúng nội dung", async () => {
    calendarMeetings = [meeting(), meeting({ id: "ev-khac", title: "Họp khác", requesterUid: "u-phong", createdAt: T.getTime() - 1000 })];
    const reply = await ask("u-mi", `ghim cuộc họp 15h của nhóm ${G1} cho anh`, [
      { name: "propose_group_pin", args: { groups: [G1], meeting_title: "Họp team bot", content: "NỘI DUNG GIẢ" } },
    ]);
    assert.match(reply, /^XEM TRƯỚC GHIM G-\d+/);
    assert.ok(reply.includes(`Nội dung ghim: «${MEETING_BODY}»`));
    assert.doesNotMatch(reply, /NỘI DUNG GIẢ/);
    const id = commandIdOf(reply);
    assert.equal((await findCommand(db, id))!.body, MEETING_BODY);
    await confirm("u-mi");
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]), T);
    assert.equal(pinned.length, 1);
    assert.equal(pinned[0].threadId, world.g1);
    assert.equal(pinned[0].content, MEETING_BODY);
  });

  test("lượt AI: không có content mà có cuộc họp → ghim cuộc họp; không thấy họp → câu «chưa thấy cuộc họp», không nháp", async () => {
    calendarMeetings = [meeting()];
    assert.ok((await ask("u-mi", `okee ghim lên nhóm ${G1}`, [{ name: "propose_group_pin", args: { groups: [G1] } }])).includes(MEETING_BODY));
    calendarMeetings = [];
    const none = await ask("u-mi", `ghim cuộc họp lên nhóm ${G1}`, [{ name: "propose_group_pin", args: { groups: [G1] } }]);
    assert.match(none, /^Em chưa thấy cuộc họp nào bot tạo/);
    assert.equal(await countCommands(), 1);
  });

  test("lượt AI: ghim nội dung do mô hình soạn (không có họp) hiện nguyên trong xem trước; ghim cho người bị từ chối", async () => {
    const reply = await ask("u-mi", `ghim lên nhóm ${G1}: thứ 6 nộp báo cáo tuần`, [{ name: "propose_group_pin", args: { groups: [G1], content: "Thứ 6 nộp báo cáo tuần" } }]);
    assert.match(reply, /Nội dung ghim: «Thứ 6 nộp báo cáo tuần»/);
    const person = await ask("u-mi", "ghim lên anh Huy: nộp báo cáo", [{ name: "propose_group_pin", args: { groups: ["anh Huy"], content: "Nộp báo cáo" } }]);
    assert.match(person, /là một người, không phải nhóm — ghim chỉ làm được cho nhóm/);
    assert.equal(await countCommands(), 1);
  });
});
