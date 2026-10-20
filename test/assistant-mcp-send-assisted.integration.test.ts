// Phase 12 (phần 2) — hai công cụ đề xuất CÓ phần phía trợ lý (ghim, lời mời họp: Calendar ngoài MCP, bước ghi nháp qua lõi) và tra bản tin gọi tay
// (`brief_request_check`) qua MCP. MySQL thật. TEST VÀNG đường cũ == đường MCP: câu trả lời, hàng send_command / brief_log / việc nền.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p12 npm test

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { resolveAlertAsker } from "../src/assistant/alert-tools.js";
import type { MeetingCreator } from "../src/assistant/meeting-tool.js";
import { openMcpTurn } from "../src/assistant/mcp-bridge/open-mcp-turn.js";
import { runBriefCommand, type BriefChatDeps } from "../src/briefs/brief-commands.js";
import { runBriefCommandLegacy } from "../src/briefs/brief-commands-legacy.js";
import type { BriefCommand } from "../src/briefs/brief-command-parser.js";
import { runSendBriefTool } from "../src/briefs/brief-tool.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { BotMeeting } from "../src/google/calendar-meetings.js";
import { runProposeMeetingAnnouncementTool } from "../src/send-commands/send-meeting-announcement-tool.js";
import { runProposePinTool } from "../src/send-commands/send-pin-tool.js";
import { buildSendChatContext } from "../src/send-commands/send-command-context.js";
import { buildSendChatContextLegacy } from "../src/send-commands/send-command-context-legacy.js";
import { LocalFileStorage } from "../src/storage/file-storage.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { briefLogs, createPinnedPool, databaseUrl, makeConfig, recipientJobs, vn } from "./phase8-brief-fixtures.js";
import { accessFor, CountingGate, G1, makeBridge, requestFor, resetSendState, sendSnapshot, setupSendWorld, T, type SendWorld } from "./assistant-mcp-send-fixtures.js";

const MEETING_START = "2026-10-12T15:00:00+07:00";
const LINK = "https://meet.google.com/yec-kwmc-dqr";

describe("họ send qua MCP — ghim / lời mời họp / tra bản tin (phase 12)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let w: SendWorld;
  let storageDir: string;
  let storage: LocalFileStorage;
  let meetings: BotMeeting[] = [];
  const gate = new CountingGate(5, 20_000);
  const bridge = makeBridge(gate);

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    storageDir = await mkdtemp(path.join(tmpdir(), "p12-brief-"));
    storage = new LocalFileStorage(storageDir);
  });
  after(async () => { await db?.end(); await rm(storageDir, { recursive: true, force: true }); });
  beforeEach(async () => { w = await setupSendWorld(db); gate.acquires = 0; meetings = []; });

  const meeting = (over: Partial<BotMeeting> = {}): BotMeeting => ({
    id: "ev1", title: "Họp team bot", startTime: Date.parse(MEETING_START), endTime: Date.parse(MEETING_START) + 3_600_000, meetLink: LINK,
    requesterUid: "u-mi", createdAt: T.getTime() - 60_000, ...over,
  });
  const scheduler = (connected = true): MeetingCreator => ({
    connected, createMeeting: async () => { throw new Error("không tạo họp mới"); }, listMeetings: async () => meetings, cancelMeeting: async () => undefined,
  });

  async function mcpChat(uid: string, question: string) {
    const threadId = w.direct.get(uid)!;
    const access = await accessFor(db, uid, threadId);
    let turn: ReturnType<typeof openMcpTurn>;
    const request = { ...(await requestFor(db, uid, threadId, question, w.world.botId)), askerAccess: async () => access, commandMcp: async () => (turn ??= openMcpTurn(access, bridge)) };
    return { ctx: await buildSendChatContext(w.deps, request), close: async () => { await turn?.close(); } };
  }

  const TOOLS = {
    pin: (chat: Parameters<typeof runProposePinTool>[0], args: Record<string, unknown>) => runProposePinTool(chat, scheduler(), args, T),
    announce: (chat: Parameters<typeof runProposePinTool>[0], args: Record<string, unknown>) => runProposeMeetingAnnouncementTool(chat, scheduler(), args, T),
  };
  const CASES: { tool: keyof typeof TOOLS; question: string; args: Record<string, unknown>; meetings: BotMeeting[] }[] = [
    { tool: "pin", question: `ghim cuộc họp 15h của nhóm ${G1}`, args: { groups: [G1], meeting_title: "Họp team bot", content: "NỘI DUNG GIẢ" }, meetings: [meeting()] },
    { tool: "pin", question: `ghim lên nhóm ${G1}: thứ 6 nộp báo cáo`, args: { groups: [G1], content: "Thứ 6 nộp báo cáo" }, meetings: [] },
    { tool: "pin", question: `ghim lên nhóm ${G1}`, args: { groups: [G1] }, meetings: [] },
    { tool: "pin", question: "ghim lên anh Huy: nộp", args: { groups: ["anh Huy"], content: "Nộp" }, meetings: [] },
    { tool: "pin", question: "ghim", args: { groups: [] }, meetings: [] },
    { tool: "pin", question: `ghim họp lên nhóm ${G1}`, args: { groups: [G1], start_time: "không phải giờ" }, meetings: [meeting()] },
    { tool: "announce", question: `gửi link họp lên nhóm ${G1}`, args: { groups: [G1] }, meetings: [meeting()] },
    { tool: "announce", question: `gửi link họp lên nhóm ${G1}`, args: { groups: [G1] }, meetings: [meeting(), meeting({ id: "ev2", title: "Họp khác", createdAt: T.getTime() - 1000 })] },
    { tool: "announce", question: "gửi link họp lên nhóm TEST BGĐ Công nợ", args: { groups: ["TEST BGĐ Công nợ"] }, meetings: [meeting()] },
    { tool: "announce", question: `gửi link họp lên nhóm ${G1}`, args: { groups: [G1] }, meetings: [] },
    { tool: "announce", question: "gửi link họp", args: { groups: [] }, meetings: [meeting()] },
  ];

  test("VÀNG ghim / lời mời họp: người hỏi × tình huống — kết quả + câu dựng sẵn + DB cũ == MCP; đường ghi nháp đúng MỘT lời gọi công cụ lõi", async () => {
    let drafted = 0;
    for (const uid of ["u-mi", "u-phong", "u-tuan", "u-huy"] as const) {
      for (const item of CASES) {
        const where = `${item.tool} ${JSON.stringify(item.args)} / ${uid}`;
        meetings = item.meetings;
        await resetSendState(db);
        const legacyChat = (await buildSendChatContextLegacy(w.deps, await requestFor(db, uid, w.direct.get(uid)!, item.question, w.world.botId)))!;
        const old = await TOOLS[item.tool](legacyChat, item.args);
        const oldState = await sendSnapshot(db);
        await resetSendState(db);
        const via = await mcpChat(uid, item.question);
        try {
          gate.acquires = 0;
          const next = await TOOLS[item.tool](via.ctx!, item.args);
          assert.deepEqual(next, old, where);
          assert.deepEqual(await sendSnapshot(db), oldState, where);
          assert.ok(gate.acquires <= 1, `${where}: ${gate.acquires} lời gọi`);
          if (old.fixedReply?.startsWith("XEM TRƯỚC")) { drafted += 1; assert.equal(gate.acquires, 1, `${where}: nháp phải đi qua công cụ lõi`); }
        } finally { await via.close(); }
      }
    }
    assert.ok(drafted >= 6, `quá ít bản xem trước (${drafted})`);
  });

  // ------------------------------------------------------------------ bản tin
  const NOW = vn("2026-10-13 09:00");
  const REQUESTS: BriefCommand["request"][] = ["morning", "auto", "weekly", "monthly"];
  let wakes = 0;

  async function runBrief(mode: "legacy" | "mcp", uid: string, command: BriefCommand, calendarOk: boolean, prep: (pool: Db) => Promise<void>) {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of ["brief_log", "job"]) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await db.query("UPDATE recipient SET is_active = 1");
    const pool = createPinnedPool(NOW);
    try {
      await prep(pool);
      const contact = (await findContactByUid(pool, uid))!;
      const asker = await resolveAlertAsker(pool, contact as Parameters<typeof resolveAlertAsker>[1]);
      const base: BriefChatDeps = { db: pool, config: makeConfig(), storage, calendar: () => (calendarOk ? w.deps.calendar : null), buildClient: async () => null, wakeJobs: () => { wakes += 1; } };
      if (mode === "legacy") return { reply: await runBriefCommandLegacy(base, asker, command, NOW), logs: await briefLogs(pool), jobs: await recipientJobs(pool) };
      const access = await accessFor(pool, uid, w.direct.get(uid)!, undefined, NOW);
      let turn: ReturnType<typeof openMcpTurn>;
      gate.acquires = 0;
      try {
        const reply = await runBriefCommand({ ...base, mcp: async () => (turn ??= openMcpTurn(access, bridge, { wakeJobs: base.wakeJobs })) }, asker, command, NOW);
        return { reply, logs: await briefLogs(pool), jobs: await recipientJobs(pool), calls: gate.acquires };
      } finally { await turn?.close(); }
    } finally { await pool.end(); }
  }

  const compact = (state: Awaited<ReturnType<typeof runBrief>>) => ({
    reply: state.reply, logs: state.logs.map((row) => [row.recipient_id, row.kind, row.period_key, row.trigger_source, row.status]), jobs: state.jobs.map((job) => [job.status, job.payload]),
  });

  test("VÀNG bản tin gọi tay: người hỏi × loại × tình huống (bình thường / lịch hỏng / người nhận tắt / chạm trần) — câu + brief_log + việc nền cũ == MCP, đúng MỘT công cụ", async () => {
    const SCENARIOS: [string, (pool: Db) => Promise<void>, boolean][] = [
      ["bình thường", async () => undefined, true],
      ["lịch hỏng", async () => undefined, false],
      ["người nhận đã tắt", async (pool) => { await pool.query("UPDATE recipient SET is_active = 0"); }, true],
      ["chạm trần 6 lần / giờ", async (pool) => {
        const [recipient] = await pool.query<RowDataPacket[]>("SELECT id FROM recipient ORDER BY id LIMIT 1");
        for (let index = 0; index < 6; index += 1) {
          await pool.query("INSERT INTO brief_log (recipient_id, kind, period_key, trigger_source, status) VALUES (?, 1, ?, 2, 2)", [recipient[0].id, `2026-10-0${index + 1}`]);
        }
      }, true],
    ];
    let wokeUp = 0;
    for (const uid of ["u-mi", "u-hang", "u-phong", "u-tuan", "u-huy", "u-dis"]) {
      for (const request of REQUESTS) {
        for (const [name, prep, calendarOk] of SCENARIOS) {
          const command: BriefCommand = { kind: "brief_request", request, variant: "standard" };
          const where = `${uid} ${request} ${name}`;
          const old = await runBrief("legacy", uid, command, calendarOk, prep);
          const next = await runBrief("mcp", uid, command, calendarOk, prep);
          assert.deepEqual(compact(next), compact(old), where);
          // Ra quyết định không cần công cụ ở nhánh sớm (không có người nhận / báo cáo chung); còn lại đúng MỘT lời gọi công cụ
          const calls = (next as { calls?: number }).calls;
          assert.ok(calls === 0 || calls === 1, `${where}: ${calls} lời gọi`);
          if (old.reply === "" || old.reply?.startsWith("Anh/chị vừa gọi") || old.reply?.startsWith("Lịch làm việc")) assert.equal(calls, 1, `${where}: phải đúng 1 tools/call`);
          if (old.reply === "") wokeUp += 1;
        }
      }
    }
    assert.ok(wokeUp >= 6, `quá ít lệnh thành công (${wokeUp})`);
  });

  test("send_brief của mô hình chạy cùng luật; không nguồn phiên MCP thì đường cũ (không mở phiên nào)", async () => {
    const mi = await resolveAlertAsker(db, (await findContactByUid(db, "u-mi"))! as Parameters<typeof resolveAlertAsker>[1]);
    const deps = (extra: Partial<BriefChatDeps> = {}): BriefChatDeps => ({ db, config: makeConfig(), storage, calendar: () => w.deps.calendar, buildClient: async () => null, ...extra });
    assert.deepEqual(await runSendBriefTool(deps(), mi!, { kind: "weekly", period: "current" }, NOW), { queued: true, label: "báo cáo tuần" });
    const access = await accessFor(db, "u-mi", w.direct.get("u-mi")!, undefined, NOW);
    gate.acquires = 0;
    assert.deepEqual(await runSendBriefTool(deps({ access: async () => access }), mi!, { kind: "monthly" }, NOW), { queued: true, label: "báo cáo tháng" });
    assert.equal(gate.acquires, 0, "chỉ có `access` mà không có cầu nối trong biến môi trường thì không tự mở phiên (đường cũ)");
  });
});
