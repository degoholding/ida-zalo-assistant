// Nhắc hẹn nhóm từ tin riêng trên MySQL THẬT (không cần Zalo): nháp xem trước (chỉ nhóm, quyền như lệnh gửi), một nháp sống mỗi
// người, «đồng ý» → job → cổng giả tạo nhắc hẹn ĐÚNG MỘT lần (thử lại không tạo trùng), bot tắt → lỗi, mất quyền → lỗi, giờ nhắc qua
// → bỏ, gửi lại nơi lỗi, báo kết quả một lần, công cụ AI chốt câu trả lời bằng bản xem trước.
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
import type { SendChatContext } from "../src/send-commands/send-command-chat.js";
import { runSendTargetJob } from "../src/send-commands/send-command-delivery.js";
import type { SendCommandDeps, SendDeliveryDeps, SendDeliveryPort, SendReminderRequest } from "../src/send-commands/send-command-deps.js";
import { createDraft } from "../src/send-commands/send-command-draft-service.js";
import { findCommand, listTargets } from "../src/send-commands/send-command-repository.js";
import { resendFailedTargets } from "../src/send-commands/send-command-web-actions.js";
import { loadSendRequester } from "../src/send-commands/send-target-resolver.js";
import { createReminderDraft } from "../src/send-commands/send-reminder-draft-service.js";
import { runProposeReminderTool } from "../src/send-commands/send-reminder-tool.js";
import { AssistantService } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import type { MeetingCreator } from "../src/assistant/meeting-tool.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { directKey, ensureGroup, ensureThread, markBotInGroup } from "../src/sync/group-repository.js";
import { databaseUrl, makeCalendar, resetTables, seedWorld, vn, type Phase8World } from "./phase8-brief-fixtures.js";

const T = vn("2026-10-12 09:00");
const READ = { readMessages: true, captureFiles: false };
const G1 = "TEST Sales Miền Tây";
const TUE_8H = "2026-10-13T08:00:00+07:00";
const SUN_9H = "2026-10-18T09:00:00+07:00";

describe("nhắc hẹn nhóm từ tin riêng", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let world: Phase8World;
  let deps: SendCommandDeps;
  const direct = new Map<string, number>();
  const created: SendReminderRequest[] = [];
  let portError: Error | null = null;
  const port: SendDeliveryPort = {
    deliver: async () => { throw new Error("nhắc hẹn không được đi đường gửi tin"); },
    createReminder: async (request) => {
      if (portError) throw portError;
      created.push(request);
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
    for (const [name, label] of [["Kho HN", "kho-hn"], ["Kho HCM", "kho-hcm"]]) {
      const { group } = await ensureGroup(db, `z-${label}`, READ);
      await db.query("UPDATE zalo_group SET name = ?, group_kind = 2 WHERE id = ?", [name, group.id]);
      await markBotInGroup(db, world.botId, group.id);
    }
    direct.clear();
    for (const uid of ["u-mi", "u-phong", "u-tuan", "u-huy"]) direct.set(uid, (await ensureThread(db, directKey(world.botId, uid), READ, uid)).group.id);
    created.length = 0;
    portError = null;
    deps = { db, calendar: makeCalendar(), wakeJobs: () => undefined };
  });

  /** Dựng nháp nhắc hẹn như công cụ AI gọi: `question` là tin người hỏi (tên nhóm phải có trong đó). */
  async function draft(uid: string, groups: string[], over: { title?: string; start?: string; repeat?: string; now?: Date } = {}): Promise<string> {
    const requester = await loadSendRequester(db, uid);
    const result = await createReminderDraft(deps, {
      requester: requester!, question: `tạo nhắc hẹn họp trong ${groups.join(", ")}`, groupNames: groups, title: over.title ?? "Họp giao ban",
      startTime: over.start ?? TUE_8H, repeat: over.repeat ?? "weekly", sourceThreadId: direct.get(uid)!,
    }, over.now ?? T);
    return result.reply;
  }
  const commandIdOf = (reply: string): number => Number(reply.match(/G-(\d+)/)?.[1]);
  const countCommands = async (): Promise<number> => Number(((await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM send_command"))[0][0]).n);
  const sendJobs = async () => (await db.query<RowDataPacket[]>("SELECT * FROM job WHERE kind = ? ORDER BY id", [JobKind.SendCommandTarget]))[0];
  const jobRow = (row: RowDataPacket, attempts = 1): JobRow => ({
    id: Number(row.id), kind: JobKind.SendCommandTarget, payload: row.payload, serialKey: row.serial_key, attempts, maxAttempts: 3, createdAt: new Date(),
  });
  const reportJobs = async () => (await db.query<RowDataPacket[]>("SELECT * FROM job WHERE kind = ? AND dedupe_key LIKE 'sendcmd-report:%'", [JobKind.ContactMessage]))[0];
  const confirm = async (uid: string, id: number | "latest" = "latest") => confirmDraft(deps, (await loadSendRequester(db, uid))!, id, T);

  test("nháp: xem trước do máy chủ dựng, lưu action_kind = 2 + giờ nhắc + lặp, tiêu đề là nội dung nhắc", async () => {
    const reply = await draft("u-mi", [G1]);
    assert.match(reply, /^XEM TRƯỚC NHẮC HẸN G-\d+/);
    assert.match(reply, new RegExp(`Nhóm «${G1}» \\(nội bộ\\)`));
    assert.match(reply, /Nhắc lúc: 08:00 T3 13\/10/);
    assert.match(reply, /Lặp: hằng tuần/);
    assert.match(reply, /Nội dung nhắc: «Họp giao ban»/);
    assert.match(reply, /Nhắn «đồng ý» trong 15 phút để tạo/);
    const command = (await findCommand(db, commandIdOf(reply)))!;
    assert.equal(command.status, SendCommandStatus.Draft);
    assert.equal(command.actionKind, SendActionKind.Reminder);
    assert.equal(command.body, "Họp giao ban");
    assert.equal(command.reminderAt?.toISOString(), "2026-10-13T01:00:00.000Z");
    assert.equal(command.reminderRepeat, 2);
    assert.equal(command.scheduledAt, null);
    assert.equal((await listTargets(db, command.id)).length, 1);
  });

  test("giờ nhắc rơi ngày nghỉ: cảnh báo trong xem trước, vẫn cho tạo", async () => {
    assert.match(await draft("u-mi", [G1], { start: SUN_9H }), /Lưu ý: Giờ nhắc rơi vào ngày nghỉ/);
  });

  test("CHỈ nhóm: tên trỏ tới người bị từ chối rõ; nhóm khách, nhóm Mật ngoài quyền, tên mơ hồ / không thấy; không tạo nháp", async () => {
    assert.match(await draft("u-mi", ["anh Huy"]), /là một người, không phải nhóm — nhắc hẹn chỉ tạo cho nhóm/);
    // Nhắc hẹn không chỉ sang màn Hội thoại trên web (màn đó không tạo được nhắc hẹn)
    const guest = await draft("u-mi", ["TEST ĐL Thành Công"]);
    assert.match(guest, /nhóm khách — nhắc hẹn từ tin riêng chỉ tạo cho nhóm nội bộ/);
    assert.doesNotMatch(guest, /Hội thoại trên web/);
    assert.match(await draft("u-mi", ["TEST BGĐ Công nợ"]), /nhóm Mật/);
    assert.match(await draft("u-mi", ["Kho"]), /khớp 2 nơi/);
    assert.match(await draft("u-mi", ["Nhóm Không Tồn Tại"]), /Em không thấy nhóm nội bộ nào/);
    assert.equal(await countCommands(), 0);
    // Người đã CHỌN nhóm Mật thì tạo được
    assert.match(await draft("u-phong", ["TEST BGĐ Công nợ"]), /\(nội bộ, Mật\)/);
  });

  test("từ chối giờ / tiêu đề / kiểu lặp / số nhóm: không tạo nháp", async () => {
    assert.match(await draft("u-mi", [G1], { start: "2026-10-12T08:00:00+07:00" }), /đã qua hoặc quá sát/);
    assert.match(await draft("u-mi", [G1], { start: "2027-12-01T08:00:00+07:00" }), /366 ngày/);
    assert.match(await draft("u-mi", [G1], { title: "x".repeat(201) }), /tối đa 200/);
    assert.match(await draft("u-mi", [G1], { title: "  " }), /nội dung nhắc đang trống/);
    assert.match(await draft("u-mi", [G1], { repeat: "yearly" }), /Kiểu lặp/);
    const many = Array.from({ length: 11 }, (_, index) => `Nhóm N${index}`);
    assert.match(await draft("u-mi", many), /tối đa 10 nhóm/);
    assert.equal(await countCommands(), 0);
  });

  test("tên nhóm mô hình tự thêm (không có trong tin người hỏi) bị chặn", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const result = await createReminderDraft(deps, {
      requester, question: "tạo nhắc hẹn họp lúc 8h mai", groupNames: [G1], title: "Họp", startTime: TUE_8H, repeat: "none", sourceThreadId: direct.get("u-mi")!,
    }, T);
    assert.match(result.reply, /Tên nhóm phải đúng/);
    assert.equal(await countCommands(), 0);
  });

  test("một nháp sống mỗi người: nháp nhắc hẹn thay nháp gửi tin cũ (và ngược lại); «đồng ý» trần trỏ nháp mới", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const message = await createDraft(deps, {
      requester, question: `gửi nhóm ${G1}: một`, targetNames: [G1], scheduleText: "", body: "một", withRecentFiles: false, sourceThreadId: direct.get("u-mi")!,
    }, T);
    const reminder = commandIdOf(await draft("u-mi", [G1]));
    assert.equal((await findCommand(db, message.commandId!))!.status, SendCommandStatus.Expired);
    assert.equal((await confirm("u-mi")).commandId, reminder);
  });

  test("đồng ý: một job mỗi nhóm, KHÔNG gửi tin; giao tạo nhắc hẹn đúng 1 lần; chạy lại không tạo trùng; báo kết quả đúng một tin", async () => {
    const id = commandIdOf(await draft("u-mi", [G1, "Kho HN"]));
    const reply = await confirm("u-mi");
    assert.match(reply.reply, /Đã nhận lệnh G-\d+: tạo nhắc hẹn cho 2 nhóm\. Tạo xong em báo kết quả\./);
    const jobs = await sendJobs();
    assert.equal(jobs.length, 2);
    for (const row of jobs) await runSendTargetJob(deliveryDeps(), jobRow(row), T);
    assert.equal(created.length, 2);
    assert.deepEqual(created.map((request) => request.threadId).sort(), [world.g1, ...[(await listTargets(db, id))[1].threadId!]].sort());
    for (const request of created) {
      assert.equal(request.title, "Họp giao ban");
      assert.equal(request.startTime, Date.parse(TUE_8H));
      assert.equal(request.repeat, 2);
      assert.equal(request.checkExisting, false, "lượt đầu của lượt giao đầu: tạo thẳng");
    }
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Done);
    const reports = await reportJobs();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].payload.threadId, direct.get("u-mi"));
    assert.match(reports[0].payload.text, /KẾT QUẢ NHẮC HẸN G-\d+: 2\/2 nhóm thành công/);
    assert.match(reports[0].payload.text, /nhóm «Kho HN»: đã tạo nhắc hẹn/);
    for (const row of jobs) await runSendTargetJob(deliveryDeps(), jobRow(row, 2), T);
    assert.equal(created.length, 2, "job chạy lại không tạo trùng");
    assert.equal((await reportJobs()).length, 1);
  });

  test("lỗi tạm thời: chưa lượt cuối → ném để thử lại, nơi vẫn Queued; thử lại thành công thì tạo đúng 1 lần", async () => {
    const id = commandIdOf(await draft("u-mi", [G1]));
    await confirm("u-mi");
    const [row] = await sendJobs();
    portError = new Error("Zalo từ chối");
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow(row, 1), T), /Zalo từ chối/);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Queued);
    portError = null;
    await runSendTargetJob(deliveryDeps(), jobRow(row, 2), T);
    await runSendTargetJob(deliveryDeps(), jobRow(row, 3), T);
    assert.equal(created.length, 1);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Sent);
  });

  test("bot tắt khẩn: nơi Failed «tắt khẩn», ném tiếp BotHaltedError, báo lỗi; gửi lại sau khi bật → tạo nhắc hẹn, không báo lại", async () => {
    const id = commandIdOf(await draft("u-mi", [G1]));
    await confirm("u-mi");
    portError = new BotHaltedError();
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]), T), BotHaltedError);
    const [failed] = await listTargets(db, id);
    assert.equal(failed.status, SendTargetStatus.Failed);
    assert.match(failed.error, /tắt khẩn/);
    assert.equal(created.length, 0);
    assert.match((await reportJobs())[0].payload.text, /0\/1 nhóm thành công[\s\S]*LỖI — bot đang tắt khẩn[\s\S]*màn Gửi tin/);
    portError = null;
    assert.match((await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, id, T)).reply, /Đã xếp gửi lại 1\/1/);
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[1]), T);
    assert.equal(created.length, 1);
    // Gửi lại từ web = job mới (attempts lại là 1) nhưng lượt giao thứ 2 → vẫn phải bỏ trùng nhắc hẹn lượt trước có thể đã tạo
    assert.equal(created[0].checkExisting, true);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Sent);
    assert.equal((await reportJobs()).length, 1, "không báo lại");
  });

  test("giao: người ra lệnh mất quyền, hoặc nhóm thành nhóm khách → nơi Failed, không tạo", async () => {
    const lost = commandIdOf(await draft("u-tuan", [G1]));
    await confirm("u-tuan");
    await db.query("UPDATE contact SET role = 0 WHERE zalo_uid = 'u-tuan'");
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]), T);
    assert.match((await listTargets(db, lost))[0].error, /không còn quyền/);
    const guest = commandIdOf(await draft("u-mi", ["Kho HCM"]));
    await confirm("u-mi");
    await db.query("UPDATE zalo_group SET group_kind = 1 WHERE name = 'Kho HCM'");
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[1]), T);
    assert.equal((await listTargets(db, guest))[0].status, SendTargetStatus.Failed);
    assert.equal(created.length, 0);
  });

  test("giờ nhắc đã qua lúc xác nhận → nháp Expired, không xếp job; qua lúc tới lượt giao → bỏ việc, nơi Failed", async () => {
    const late = commandIdOf(await draft("u-mi", [G1], { now: vn("2026-10-13 07:50") }));
    const result = await confirmDraft(deps, (await loadSendRequester(db, "u-mi"))!, "latest", new Date(vn("2026-10-13 07:59").getTime() + 30_000));
    assert.match(result.reply, /Giờ nhắc của lệnh G-\d+ đã qua hoặc quá sát/);
    assert.equal((await findCommand(db, late))!.status, SendCommandStatus.Expired);
    assert.equal((await sendJobs()).length, 0);

    const slow = commandIdOf(await draft("u-mi", [G1]));
    await confirm("u-mi");
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]), vn("2026-10-13 08:05")), /giờ nhắc đã qua/);
    const [target] = await listTargets(db, slow);
    assert.equal(target.status, SendTargetStatus.Failed);
    assert.equal(created.length, 0);
  });

  test("công cụ AI: chốt câu trả lời bằng bản xem trước, tạo nháp; thiếu nhóm trong tin người hỏi → từ chối", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const chat: SendChatContext = { deps, requester, uid: "u-mi", name: "Mi", question: `tạo nhắc hẹn họp 8h sáng mai trong nhóm ${G1}`, sourceThreadId: direct.get("u-mi")! };
    const args = { groups: [G1], title: "Họp 11h", start_time: TUE_8H, repeat: "none" };
    const ok = await runProposeReminderTool(chat, args, T);
    assert.match(ok.fixedReply ?? "", /^XEM TRƯỚC NHẮC HẸN G-\d+/);
    assert.equal(ok.response.drafted, true);
    assert.equal(await countCommands(), 1);
    const refused = await runProposeReminderTool({ ...chat, question: "tạo nhắc hẹn họp 8h sáng mai" }, args, T);
    assert.equal(refused.response.drafted, false);
    assert.match(refused.fixedReply ?? "", /Tên nhóm phải đúng/);
    assert.equal(await countCommands(), 1);
  });

  test("cả lượt: create_meeting rồi propose_group_reminder → câu trả lời có link Meet vừa tạo + bản xem trước (không nuốt link)", async () => {
    const turns: GeminiContent["parts"][] = [
      [{ functionCall: { name: "create_meeting", args: { title: "Họp team bot", start_time: TUE_8H } } }],
      [{ functionCall: { name: "propose_group_reminder", args: { groups: [G1], title: "Họp team bot", start_time: TUE_8H } } }],
    ];
    const model: ModelClient = {
      generate: async () => {
        const parts = turns.shift();
        if (!parts) throw new Error("không được gọi mô hình sau khi đã có bản xem trước");
        return { content: { role: "model" as const, parts }, inputTokens: 10, outputTokens: 5 };
      },
    };
    const meetings: MeetingCreator = {
      connected: true,
      createMeeting: async () => ({ eventId: "ev1", meetLink: "https://meet.google.com/yec-kwmc-dqr", eventLink: "https://cal/ev1" }),
      listMeetings: async () => [],
      cancelMeeting: async () => undefined,
    };
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => T, { sendCommands: deps, meetingScheduler: meetings });
    const reply = await service.answer({
      botAccountId: world.botId, contact: (await findContactByUid(db, "u-mi"))!, threadId: direct.get("u-mi")!, questionMessageId: null,
      question: `tạo lịch hẹn họp 8h sáng mai trong nhóm ${G1}`,
    });
    assert.match(reply.text ?? "", /^Đã tạo cuộc họp Google Meet «Họp team bot» lúc 08:00 13\/10\/2026: https:\/\/meet\.google\.com\/yec-kwmc-dqr\n\nXEM TRƯỚC NHẮC HẸN G-\d+/);
    assert.equal(await countCommands(), 1);
  });

  test("cả lượt: create_task + create_ticket rồi propose_group_reminder → câu trả lời có kết quả giao việc / ticket + bản xem trước", async () => {
    const turns: GeminiContent["parts"][] = [
      [{ functionCall: { name: "create_task", args: { title: "Gửi báo giá Thanh Công", assignee: "Phong", due: "20/10" } } },
        { functionCall: { name: "create_ticket", args: { text: "Máy chiếu phòng họp bị mờ" } } },
        { functionCall: { name: "create_task", args: { title: "x" } } }], // thiếu nội dung → lỗi, không được thành dòng
      [{ functionCall: { name: "propose_group_reminder", args: { groups: [G1], title: "Họp team", start_time: TUE_8H } } }],
    ];
    const model: ModelClient = {
      generate: async () => {
        const parts = turns.shift();
        if (!parts) throw new Error("không được gọi mô hình sau khi đã có bản xem trước");
        return { content: { role: "model" as const, parts }, inputTokens: 10, outputTokens: 5 };
      },
    };
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => T,
      { sendCommands: deps, tickets: { db, wakeJobs: () => undefined } });
    const reply = await service.answer({
      botAccountId: world.botId, contact: (await findContactByUid(db, "u-mi"))!, threadId: direct.get("u-mi")!, questionMessageId: null,
      question: `giao Phong gửi báo giá, báo lỗi máy chiếu, và tạo nhắc hẹn họp 8h sáng mai trong nhóm ${G1}`,
    });
    const lines = (reply.text ?? "").split("\n\n");
    assert.match(lines[0], /^Dạ đã ghi V-\d+: Gửi báo giá Thanh Công — .*Phong.* — hạn .*20\/10/);
    assert.match(lines[1], /^Dạ em đã ghi nhận ticket T-\d+/);
    assert.match(lines[2], /^XEM TRƯỚC NHẮC HẸN G-\d+/);
    assert.equal(lines.filter((line) => /Thiếu nội dung việc/.test(line)).length, 0);
  });
});
