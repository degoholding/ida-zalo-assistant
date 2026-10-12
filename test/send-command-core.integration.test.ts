// Phase 9 phase 3 — lõi lệnh gửi trên MySQL THẬT (không cần Zalo): nháp + xem trước, từ chối (mơ hồ / nhóm khách / Mật / ngoài
// quyền / 11 nơi / không nguyên văn), một nháp sống mỗi người, xác nhận → job không trùng, hẹn giờ + cảnh báo, hủy, giao qua
// cổng giả (thành công / lỗi / bot tắt / mất quyền), báo kết quả một lần, gửi lại, nhật ký web, việc nền lưới đỡ.
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/<csdl_thử> npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { JobKind, SendCommandStatus, SendTargetStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { JobRow } from "../src/jobs/job-queue.js";
import { BotHaltedError } from "../src/messaging/bot-halted-error.js";
import { cancelSendCommand, confirmDraft } from "../src/send-commands/send-command-actions.js";
import { runSendChatCommand } from "../src/send-commands/send-command-chat.js";
import { runSendTargetJob } from "../src/send-commands/send-command-delivery.js";
import type { SendCommandDeps, SendDeliveryDeps, SendDeliveryPort, SendTargetJobPayload } from "../src/send-commands/send-command-deps.js";
import { parseSendCommand } from "../src/send-commands/send-command-parser.js";
import { findCommand, listTargets } from "../src/send-commands/send-command-repository.js";
import { recordWebSend, resendFailedTargets } from "../src/send-commands/send-command-web-actions.js";
import { runSendCommandWatch } from "../src/send-commands/send-command-watch.js";
import { loadSendRequester } from "../src/send-commands/send-target-resolver.js";
import { directKey, ensureGroup, ensureThread, markBotInGroup } from "../src/sync/group-repository.js";
import { databaseUrl, makeCalendar, resetTables, seedWorld, vn, type Phase8World } from "./phase8-brief-fixtures.js";

const T = vn("2026-10-12 09:00");
const READ = { readMessages: true, captureFiles: false };
const G1 = "TEST Sales Miền Tây";

describe("phase 9 — lõi lệnh gửi", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let world: Phase8World;
  let deps: SendCommandDeps;
  const direct = new Map<string, number>();
  const delivered: SendTargetJobPayload[] = [];
  let portError: Error | null = null;
  const port: SendDeliveryPort = {
    deliver: async (payload) => {
      if (portError) throw portError;
      delivered.push(payload);
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
    for (const uid of ["u-mi", "u-phong", "u-hang", "u-tuan", "u-huy"]) {
      direct.set(uid, (await ensureThread(db, directKey(world.botId, uid), READ, uid)).group.id);
    }
    delivered.length = 0;
    portError = null;
    deps = { db, calendar: makeCalendar(), wakeJobs: () => undefined };
  });

  async function say(uid: string, text: string, now: Date = T, fileThread = true): Promise<string> {
    const command = parseSendCommand(text);
    assert.ok(command, `parser phải nhận «${text}»`);
    const requester = await loadSendRequester(db, uid);
    return runSendChatCommand(command, {
      deps, requester, uid, name: requester?.name ?? uid, question: text, sourceThreadId: fileThread ? (direct.get(uid) ?? 0) : 0,
    }, now);
  }
  const commandIdOf = (reply: string): number => Number(reply.match(/G-(\d+)/)?.[1]);
  const countCommands = async (): Promise<number> => Number(((await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM send_command"))[0][0]).n);
  const sendJobs = async () => (await db.query<RowDataPacket[]>("SELECT * FROM job WHERE kind = ? ORDER BY id", [JobKind.SendCommandTarget]))[0];
  const jobRow = (row: RowDataPacket, attempts = 1): JobRow => ({
    id: Number(row.id), kind: JobKind.SendCommandTarget, payload: row.payload, serialKey: row.serial_key, attempts, maxAttempts: 3, createdAt: new Date(),
  });
  const reportJobs = async () => (await db.query<RowDataPacket[]>("SELECT * FROM job WHERE kind = ? AND dedupe_key LIKE 'sendcmd-report:%'", [JobKind.ContactMessage]))[0];

  test("nháp: xem trước do máy chủ dựng, nội dung nguyên văn, nơi nhận đã phân giải", async () => {
    const reply = await say("u-mi", `gửi nhóm ${G1}, Huy: Mai họp 9h nhé`);
    assert.match(reply, /XEM TRƯỚC LỆNH GỬI G-\d+/);
    assert.match(reply, new RegExp(`Nhóm «${G1}» \\(nội bộ\\)`));
    assert.match(reply, /Anh\/chị Huy \(nhân sự\)/);
    assert.match(reply, /Nội dung: «Mai họp 9h nhé»/);
    const command = (await findCommand(db, commandIdOf(reply)))!;
    assert.equal(command.status, SendCommandStatus.Draft);
    assert.equal(command.body, "Mai họp 9h nhé");
    assert.equal((await listTargets(db, command.id)).length, 2);
  });

  test("từ chối KHÔNG tạo nháp: nhóm khách, khách lẻ, nhân sự chưa có cuộc riêng, tên mơ hồ, không thấy", async () => {
    assert.match(await say("u-mi", "gửi nhóm TEST ĐL Thành Công: x"), /nhóm khách/);
    assert.match(await say("u-mi", "gửi anh Sáu: x"), /không phải nhân sự nội bộ/);
    assert.match(await say("u-mi", "gửi Tâm: x"), /chưa có cuộc riêng hoặc chưa là bạn Zalo/);
    const ambiguous = await say("u-mi", "gửi nhóm Kho: x");
    assert.match(ambiguous, /khớp 2 nơi/);
    assert.match(ambiguous, /Kho HN/);
    assert.match(await say("u-mi", "gửi nhóm Không Tồn Tại: x"), /không thấy nơi nhận/);
    assert.equal(await countCommands(), 0);
  });

  test("một tên lỗi kéo cả lệnh: gom mọi lỗi vào MỘT câu, không nháp nửa vời", async () => {
    const reply = await say("u-mi", `gửi nhóm ${G1}, nhóm Zzz, anh Sáu: x`);
    assert.match(reply, /nhóm Zzz/);
    assert.match(reply, /anh Sáu/);
    assert.match(reply, /chưa tạo lệnh nào/);
    assert.equal(await countCommands(), 0);
  });

  test("nhóm Mật: người chỉ có «mọi nhóm» bị chặn, người đã CHỌN đúng nhóm gửi được; người chỉ có vai trò cũng bị chặn", async () => {
    assert.match(await say("u-mi", "gửi nhóm TEST BGĐ Công nợ: x"), /nhóm Mật/);
    assert.match(await say("u-tuan", "gửi nhóm TEST BGĐ Công nợ: x"), /nhóm Mật/);
    const ok = await say("u-phong", "gửi nhóm TEST BGĐ Công nợ: x");
    assert.match(ok, /\(nội bộ, Mật\)/);
  });

  test("người không phải người nhận và không có vai trò không ra lệnh được", async () => {
    assert.match(await say("u-huy", `gửi nhóm ${G1}: x`), /chỉ dành cho/);
    assert.equal(await countCommands(), 0);
  });

  test("11 nơi bị chặn; nội dung không nguyên văn bị chặn; giờ hẹn sai bị chặn", async () => {
    const names = Array.from({ length: 11 }, (_, index) => `nhóm N${index}`).join(", ");
    assert.match(await say("u-mi", `gửi ${names}: x`), /tối đa 10 nơi/);
    const command = parseSendCommand(`gửi nhóm ${G1}: xin chào`)!;
    const requester = await loadSendRequester(db, "u-mi");
    const forged = await runSendChatCommand(command, { deps, requester, uid: "u-mi", name: "Mi", question: "gửi nhóm TEST Sales Miền Tây: khác hẳn", sourceThreadId: direct.get("u-mi")! }, T);
    assert.match(forged, /nguyên văn/);
    assert.match(await say("u-mi", `gửi nhóm ${G1} lúc 8h hôm nay: x`), /đã qua/);
    assert.equal(await countCommands(), 0);
  });

  test("hẹn giờ rơi giờ yên lặng / ngày nghỉ: cảnh báo trong xem trước, vẫn cho", async () => {
    const quiet = await say("u-mi", `gửi nhóm ${G1} lúc 22h mai: x`);
    assert.match(quiet, /Giờ gửi: 22:00 T3 13\/10/);
    assert.match(quiet, /Lưu ý: Giờ gửi rơi vào giờ yên lặng/);
    const sunday = await say("u-mi", `gửi nhóm ${G1} lúc 9h chủ nhật: x`);
    assert.match(sunday, /Lưu ý: Giờ gửi rơi vào ngày nghỉ/);
    const normal = await say("u-mi", `gửi nhóm ${G1} lúc 9h mai: x`);
    assert.doesNotMatch(normal, /Lưu ý/);
  });

  test("mỗi người MỘT nháp sống: nháp mới đẩy nháp cũ sang Expired, «đồng ý» trần trỏ nháp mới", async () => {
    const first = commandIdOf(await say("u-mi", `gửi nhóm ${G1}: một`));
    const second = commandIdOf(await say("u-mi", `gửi nhóm ${G1}: hai`));
    assert.equal((await findCommand(db, first))!.status, SendCommandStatus.Expired);
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const confirmed = await confirmDraft(deps, requester, "latest", T);
    assert.equal(confirmed.commandId, second);
    assert.match(confirmed.reply, /Đã nhận lệnh G-\d+: 1 nơi, đang gửi/);
    assert.match((await confirmDraft(deps, requester, first, T)).reply, /quá hạn xác nhận/);
  });

  test("đồng ý: một job mỗi nơi, đồng ý hai lần không xếp thêm; không có nháp thì handled = false", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    assert.equal((await confirmDraft(deps, requester, "latest", T)).handled, false);
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1}, Huy: họp`));
    await say("u-mi", `đồng ý G-${id}`);
    const jobs = await sendJobs();
    assert.equal(jobs.length, 2);
    assert.deepEqual(jobs.map((job) => job.dedupe_key).sort(), (await listTargets(db, id)).map((target) => `sendcmd:t${target.id}:a1`).sort());
    assert.ok(jobs.every((job) => job.serial_key === `send:${id}`));
    assert.match(await say("u-mi", `đồng ý G-${id}`), /đã được xác nhận rồi/);
    assert.equal((await sendJobs()).length, 2);
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Sending);
  });

  test("nháp quá 15 phút không xác nhận được; người khác không xác nhận / hủy được lệnh của mình", async () => {
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1}: x`));
    const late = new Date(T.getTime() + 16 * 60_000);
    assert.match(await say("u-mi", `đồng ý G-${id}`, late), /quá hạn xác nhận/);
    const other = commandIdOf(await say("u-phong", `gửi nhóm ${G1}: y`));
    assert.match(await say("u-mi", `đồng ý G-${other}`), /không tìm thấy/);
    assert.match(await say("u-mi", `hủy G-${other}`), /không tìm thấy/);
    assert.equal((await findCommand(db, other))!.status, SendCommandStatus.Draft);
  });

  test("hủy lệnh hẹn: lệnh + nơi Cancelled, job chờ bị bỏ; lệnh đang gửi thì không hủy được", async () => {
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1} lúc 9h mai: x`));
    await say("u-mi", "đồng ý G-" + id);
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Scheduled);
    assert.match(await say("u-mi", "lệnh gửi"), new RegExp(`G-${id} · đang hẹn`));
    assert.match(await say("u-mi", `hủy G-${id}`), /Đã hủy lệnh/);
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Cancelled);
    assert.ok((await listTargets(db, id)).every((target) => target.status === SendTargetStatus.Cancelled));
    assert.equal(Number((await sendJobs())[0].status), 4);

    const sending = commandIdOf(await say("u-mi", `gửi nhóm ${G1}: ngay`));
    await say("u-mi", `đồng ý G-${sending}`);
    assert.match(await say("u-mi", `hủy G-${sending}`), /không hủy được nữa/);
  });

  test("giao: nội dung nguyên văn tới cổng, nơi Sent, lệnh Done, báo kết quả ĐÚNG MỘT tin về cuộc riêng", async () => {
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1}, Huy: Mai họp 9h`));
    // «đồng ý» trần do chat-commands xử lý (phase 4) — ở đây gọi thẳng service
    const requester = (await loadSendRequester(db, "u-mi"))!;
    await confirmDraft(deps, requester, "latest", T);
    for (const row of await sendJobs()) await runSendTargetJob(deliveryDeps(), jobRow(row));
    assert.deepEqual(delivered.map((payload) => payload.text), ["Mai họp 9h", "Mai họp 9h"]);
    assert.deepEqual(delivered.map((payload) => payload.threadId).sort(), [world.g1, direct.get("u-huy")].sort());
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Done);
    const reports = await reportJobs();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].dedupe_key, `sendcmd-report:${id}`);
    assert.equal(reports[0].payload.threadId, direct.get("u-mi"));
    assert.match(reports[0].payload.text, /KẾT QUẢ LỆNH G-\d+: 2\/2 nơi thành công/);
    for (const row of await sendJobs()) await runSendTargetJob(deliveryDeps(), jobRow(row));
    assert.equal(delivered.length, 2, "job chạy lại không gửi lặp");
    assert.equal((await reportJobs()).length, 1);
  });

  test("giao lỗi: chưa lượt cuối → ném để thử lại; lượt cuối → nơi Failed + báo lỗi; bot tắt khẩn → Failed và ném tiếp", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1}, Huy: x`));
    await confirmDraft(deps, requester, id, T);
    const [first, second] = await sendJobs();
    portError = new Error("Zalo từ chối");
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow(first, 1)), /Zalo từ chối/);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Queued);
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow(first, 3)), /Zalo từ chối/);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Failed);
    portError = new BotHaltedError();
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow(second, 1)), BotHaltedError);
    const targets = await listTargets(db, id);
    assert.equal(targets[1].status, SendTargetStatus.Failed);
    assert.match(targets[1].error, /tắt khẩn/);
    assert.match((await reportJobs())[0].payload.text, /0\/2 nơi thành công[\s\S]*LỖI — Zalo từ chối[\s\S]*màn Gửi tin/);
  });

  test("giao: người ra lệnh mất quyền lúc hẹn → nơi Failed, không gửi", async () => {
    const requester = (await loadSendRequester(db, "u-tuan"))!;
    const id = commandIdOf(await say("u-tuan", `gửi nhóm ${G1} lúc 9h mai: x`));
    await confirmDraft(deps, requester, id, T);
    await db.query("UPDATE contact SET role = 0 WHERE zalo_uid = 'u-tuan'");
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]));
    assert.equal(delivered.length, 0);
    const [target] = await listTargets(db, id);
    assert.equal(target.status, SendTargetStatus.Failed);
    assert.match(target.error, /không còn quyền/);
  });

  test("giao: nhóm đổi thành nhóm khách hoặc bot rời nhóm trong lúc chờ → không gửi", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1} lúc 9h mai: x`));
    await confirmDraft(deps, requester, id, T);
    await db.query("UPDATE zalo_group SET group_kind = 1 WHERE id = ?", [world.g1]);
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]));
    assert.equal(delivered.length, 0);
    assert.match((await listTargets(db, id))[0].error, /nhóm khách/);
  });

  test("gửi lại nơi lỗi: lượt mới, job mới, không báo lại người ra lệnh", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1}: x`));
    await confirmDraft(deps, requester, id, T);
    portError = new BotHaltedError();
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0])), BotHaltedError);
    assert.equal((await reportJobs()).length, 1);
    portError = null;
    const result = await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, id, T);
    assert.match(result.reply, /Đã xếp gửi lại 1\/1/);
    const jobs = await sendJobs();
    assert.equal(jobs.length, 2);
    assert.match(String(jobs[1].dedupe_key), /:a2$/);
    await runSendTargetJob(deliveryDeps(), jobRow(jobs[1]));
    assert.equal(delivered.length, 1);
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Done);
    assert.equal((await listTargets(db, id))[0].status, SendTargetStatus.Sent);
    assert.equal((await reportJobs()).length, 1, "không báo lại");
    assert.match((await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, id, T)).reply, /không có nơi nào lỗi/);
  });

  test("tệp kèm: chỉ tệp người ra lệnh gửi trong 10 phút; không có tệp thì báo gửi tệp trước", async () => {
    const thread = direct.get("u-mi")!;
    assert.match(await say("u-mi", `gửi cái này vào nhóm ${G1}: xem giúp`), /chưa thấy tệp/);
    const addFile = async (zaloId: string, at: Date, name: string): Promise<void> => {
      const [message] = await db.query<ResultSetHeader>(
        "INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sent_at, text) VALUES (?, ?, 1, 'u-mi', ?, '')", [thread, zaloId, at]);
      await db.query("INSERT INTO attachment (message_id, group_id, file_name, source_url, status) VALUES (?, ?, ?, 'x', 1)", [message.insertId, thread, name]);
    };
    await addFile("old", new Date(T.getTime() - 30 * 60_000), "cu.pdf");
    await addFile("new", new Date(T.getTime() - 5 * 60_000), "bang-gia.pdf");
    const reply = await say("u-mi", `gửi cái này vào nhóm ${G1}: xem giúp`);
    assert.match(reply, /Tệp kèm: 1 \(bang-gia\.pdf\)/);
    const id = commandIdOf(reply);
    assert.equal((await findCommand(db, id))!.attachmentIds.length, 1);
    await confirmDraft(deps, (await loadSendRequester(db, "u-mi"))!, id, T);
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[0]));
    assert.deepEqual(delivered[0].attachmentIds, (await findCommand(db, id))!.attachmentIds);
  });

  test("nhật ký web: một dòng Done, nơi Sent hoặc Failed; không ném khi nhóm không tồn tại", async () => {
    const ok = await recordWebSend(db, { userId: 1, userName: "Quản trị", threadId: world.g1, body: "Xin chào", ok: true });
    const bad = await recordWebSend(db, { userId: 1, userName: "Quản trị", threadId: world.g2, body: "Lỗi", fileName: "a.pdf", ok: false, error: "mất mạng" });
    assert.equal(await recordWebSend(db, { userId: 1, userName: "Quản trị", threadId: 999999, body: "x", ok: true }), null);
    assert.equal((await findCommand(db, ok!))!.status, SendCommandStatus.Done);
    assert.equal((await listTargets(db, ok!))[0].status, SendTargetStatus.Sent);
    assert.equal((await listTargets(db, bad!))[0].status, SendTargetStatus.Failed);
    assert.match((await findCommand(db, bad!))!.body, /đính kèm tệp: a\.pdf/);
    assert.match((await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, bad!, T)).reply, /tệp đính kèm/);
    assert.equal(await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, ok!, T).then((r) => r.reply), `Lệnh G-${ok} không có nơi nào lỗi.`);
  });

  test("việc nền: nháp quá hạn → Expired; nơi mắc kẹt (job Expired) → Failed + chốt lệnh + báo một lần", async () => {
    const draft = commandIdOf(await say("u-mi", `gửi nhóm ${G1}: nháp`));
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1} lúc 9h mai: hẹn`));
    await confirmDraft(deps, (await loadSendRequester(db, "u-mi"))!, id, T);
    assert.equal((await findCommand(db, draft))!.status, SendCommandStatus.Expired);
    await db.query("UPDATE job SET status = 4, last_error = '' WHERE kind = ?", [JobKind.SendCommandTarget]);
    await db.query("UPDATE send_command_target SET updated_at = '2020-01-01'");
    const result = await runSendCommandWatch(deps, new Date(Date.now() + 10 * 60_000));
    assert.equal(result.failedTargets, 1);
    assert.match((await listTargets(db, id))[0].error, /quá giờ hẹn/);
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Done);
    assert.equal((await reportJobs()).length, 1);
    await runSendCommandWatch(deps, new Date(Date.now() + 20 * 60_000));
    assert.equal((await reportJobs()).length, 1);
  });

  test("gửi lại khi lệnh CÒN đang gửi: không ép Done, không chặn tin báo kết quả duy nhất (gồm cả nơi gửi lại)", async () => {
    const requester = (await loadSendRequester(db, "u-mi"))!;
    const id = commandIdOf(await say("u-mi", "gửi nhóm Kho HN, nhóm Kho HCM: x"));
    await confirmDraft(deps, requester, id, T);
    const [first, second] = await sendJobs();
    portError = new Error("Zalo lỗi");
    await assert.rejects(runSendTargetJob(deliveryDeps(), jobRow(first, 3)), /Zalo lỗi/);
    portError = null;
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Sending, "nơi thứ hai còn chờ");
    const result = await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, id, T);
    assert.equal(result.ok, true);
    assert.equal((await findCommand(db, id))!.reportedAt, null, "chưa báo lần nào thì không đánh dấu đã báo");
    await runSendTargetJob(deliveryDeps(), jobRow(second));
    await runSendTargetJob(deliveryDeps(), jobRow((await sendJobs())[2]));
    assert.equal((await findCommand(db, id))!.status, SendCommandStatus.Done);
    assert.equal((await reportJobs()).length, 1, "đúng MỘT tin báo, sau khi mọi nơi xong");
  });

  test("hủy / gửi lại bị từ chối thì ok = false (web không ghi nhật ký thao tác)", async () => {
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1}: x`));
    await confirmDraft(deps, (await loadSendRequester(db, "u-mi"))!, id, T);
    assert.notEqual((await cancelSendCommand(deps, { via: "web", name: "Quản trị" }, id, T)).ok, true);
    assert.notEqual((await resendFailedTargets(deps, { via: "web", name: "Quản trị" }, id, T)).ok, true);
  });

  test("cancelSendCommand từ web hủy được lệnh của người khác", async () => {
    const id = commandIdOf(await say("u-mi", `gửi nhóm ${G1} lúc 9h mai: x`));
    await confirmDraft(deps, (await loadSendRequester(db, "u-mi"))!, id, T);
    assert.match((await cancelSendCommand(deps, { via: "web", name: "Quản trị" }, id, T)).reply, /Đã hủy/);
    assert.equal((await findCommand(db, id))!.cancelledBy, "Quản trị");
  });
});
