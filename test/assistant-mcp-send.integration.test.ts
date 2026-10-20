// Phase 12 — họ `send` qua MCP trong tiến trình (lệnh gửi tin + nháp G-…). MySQL thật. TEST VÀNG: đường CŨ (dịch vụ gọi thẳng) so với đường MCP (công cụ lệnh /
// công cụ mô hình của lõi `data-access/send/`) cho CÙNG câu trả lời từng ký tự và CÙNG trạng thái DB (send_command, send_command_target, job) trên ma trận
// người hỏi × lệnh × cuộc. Cộng: kho «đồng ý» chọn đúng nháp, mô hình không có công cụ xác nhận, MCP ngoài không thấy công cụ gửi, nhật ký gọi nguồn 2 / 3.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p12 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { parseChatCommand } from "../src/assistant/chat-commands.js";
import type { ChatCommandContext } from "../src/assistant/chat-commands.js";
import { openMcpTurn } from "../src/assistant/mcp-bridge/open-mcp-turn.js";
import { mapCallToolResult } from "../src/assistant/mcp-bridge/mcp-call-result-mapper.js";
import { toFunctionDeclarationsFromMcp } from "../src/assistant/mcp-bridge/mcp-declaration-adapter.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ALL_TOOLS, toolsFor } from "../src/data-access/read-tool-catalog.js";
import { buildSendChatContext } from "../src/send-commands/send-command-context.js";
import { buildSendChatContextLegacy } from "../src/send-commands/send-command-context-legacy.js";
import { runSendChatCommand, sendPendingProvider, type SendChatContext } from "../src/send-commands/send-command-chat.js";
import { runSendChatCommandLegacy, sendPendingProviderLegacy } from "../src/send-commands/send-command-chat-legacy.js";
import { createDraft } from "../src/send-commands/send-command-draft-service.js";
import type { SendChatCommand } from "../src/send-commands/send-command-parser.js";
import { runProposeSendTool } from "../src/send-commands/send-command-tool-legacy.js";
import { runProposeReminderTool } from "../src/send-commands/send-reminder-tool-legacy.js";
import { PROPOSE_REMINDER_DECLARATION, PROPOSE_SEND_DECLARATION } from "../src/send-commands/send-tool-declarations.js";
import { registerSendTurn } from "../src/send-commands/send-turn-registry.js";
import { loadSendRequester } from "../src/send-commands/send-target-resolver.js";
import { databaseUrl } from "./phase8-brief-fixtures.js";
import { accessFor, CountingGate, G1, makeBridge, PERSONAS, requestFor, resetSendState, sendSnapshot, setupSendWorld, T, type SendWorld } from "./assistant-mcp-send-fixtures.js";

const SEND_TOOL_NAMES = ["send_context", "send_draft_create", "send_pin_draft_create", "send_draft_confirm", "send_draft_cancel", "send_draft_list", "send_draft_pending", "brief_request_check"];

describe("họ send qua MCP (phase 12)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let w: SendWorld;
  const gate = new CountingGate(5, 20_000);
  const bridge = makeBridge(gate);

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => { w = await setupSendWorld(db); gate.acquires = 0; });

  /** Phiên MCP dùng chung của lượt (như `commandMcp` của assistant-service) + hàm đóng. */
  async function mcpFor(uid: string, threadId: number) {
    const access = await accessFor(db, uid, threadId);
    let turn: ReturnType<typeof openMcpTurn>;
    return { access, askerAccess: async () => access, commandMcp: async () => (turn ??= openMcpTurn(access, bridge, { wakeJobs: () => undefined })), close: async () => { await turn?.close(); } };
  }

  /** Ngữ cảnh MCP của một lượt hỏi `question` ở cuộc `threadId`. */
  async function mcpContext(uid: string, threadId: number, question: string) {
    const source = await mcpFor(uid, threadId);
    const request = { ...(await requestFor(db, uid, threadId, question, w.world.botId)), askerAccess: source.askerAccess, commandMcp: source.commandMcp };
    return { ...source, ctx: await buildSendChatContext(w.deps, request) };
  }

  const strip = (ctx: SendChatContext | null) => ctx && { requester: ctx.requester, uid: ctx.uid, name: ctx.name, requesterContactId: ctx.requesterContactId, question: ctx.question, sourceThreadId: ctx.sourceThreadId, sourceMessageId: ctx.sourceMessageId, botAccountId: ctx.botAccountId };

  test("VÀNG buildSendChatContext: người hỏi × cuộc (tin riêng / web- / demo- / không tồn tại) — cùng ngữ cảnh, đúng MỘT lời gọi send_context", async () => {
    let nonNull = 0;
    for (const uid of PERSONAS) {
      for (const threadId of [w.direct.get(uid)!, w.webThread, w.demoThread, 987_654]) {
        const legacy = await buildSendChatContextLegacy(w.deps, await requestFor(db, uid, threadId, "hỏi gì đó", w.world.botId));
        gate.acquires = 0;
        const via = await mcpContext(uid, threadId, "hỏi gì đó");
        try {
          assert.deepEqual(strip(via.ctx), strip(legacy), `${uid} thread=${threadId}`);
          assert.equal(gate.acquires, 1, `${uid}: phải đúng 1 tools/call`);
          if (legacy) nonNull += 1;
        } finally { await via.close(); }
      }
    }
    assert.equal(nonNull, PERSONAS.length, "mỗi người có đúng một cuộc riêng thật");
  });

  // ------------------------------------------------------------------ lệnh gõ
  const preview = (uid: string, body: string, targets = G1) => async () => {
    const requester = await loadSendRequester(db, uid);
    if (requester) await createDraft(w.deps, { requester, question: `gửi nhóm ${targets}: ${body}`, targetNames: [targets], scheduleText: "", body, withRecentFiles: false, sourceThreadId: w.direct.get(uid)! }, T);
  };

  interface Scenario { name: string; question: string; commandText?: string; prep?: (uid: string) => () => Promise<void>; own?: boolean }
  const SCENARIOS: Scenario[] = [
    { name: "nháp nhóm", question: `gửi nhóm ${G1}: họp 3h chiều nay` },
    { name: "nháp hai nơi có hẹn giờ", question: `gửi nhóm ${G1}, Kho HN lúc 8h sáng mai: nghỉ lễ` },
    { name: "nháp người", question: "gửi anh Huy: nhớ nộp báo cáo" },
    { name: "nhóm không có", question: "gửi nhóm Không Có Thật: xin chào" },
    { name: "nhóm khách", question: "gửi nhóm TEST ĐL Thành Công: xin chào" },
    { name: "nhóm Mật", question: "gửi nhóm TEST BGĐ Công nợ: tuyệt mật" },
    { name: "nội dung không có trong tin", question: `gửi nhóm ${G1}: họp 3h chiều nay`, commandText: `gửi nhóm ${G1}: nội dung khác hẳn` },
    { name: "danh sách có nháp", question: "lệnh gửi", prep: (uid) => preview(uid, "họp 3h chiều nay") },
    { name: "danh sách rỗng", question: "lệnh gửi" },
    { name: "hủy lệnh của mình", question: "hủy G-1", prep: (uid) => preview(uid, "họp 3h chiều nay") },
    { name: "hủy lệnh không có", question: "hủy G-7" },
    { name: "đồng ý lệnh của mình", question: "đồng ý G-1", prep: (uid) => preview(uid, "họp 3h chiều nay") },
    { name: "đồng ý lệnh không có", question: "đồng ý G-1" },
    { name: "đồng ý lệnh quá hạn", question: "đồng ý G-1", prep: (uid) => async () => {
      await preview(uid, "họp 3h chiều nay")();
      await db.query("UPDATE send_command SET confirm_expires_at = ?", [new Date(T.getTime() - 60_000)]);
    } },
  ];

  test("VÀNG lệnh gõ: người hỏi × kịch bản — câu bot + hàng send_command / nơi nhận / việc nền cũ == MCP, mỗi lệnh đúng MỘT lời gọi công cụ", async () => {
    let compared = 0;
    let replied = 0;
    for (const uid of PERSONAS) {
      for (const scenario of SCENARIOS) {
        const threadId = w.direct.get(uid)!;
        const command = parseChatCommand(scenario.commandText ?? scenario.question) as SendChatCommand;
        assert.ok(command, scenario.name);
        const where = `${scenario.name} / ${uid}`;
        await resetSendState(db);
        await scenario.prep?.(uid)();
        const legacyCtx = (await buildSendChatContextLegacy(w.deps, await requestFor(db, uid, threadId, scenario.question, w.world.botId)))!;
        const old = await runSendChatCommandLegacy(command, legacyCtx, T);
        const oldState = await sendSnapshot(db);
        await resetSendState(db);
        await scenario.prep?.(uid)();
        const via = await mcpContext(uid, threadId, scenario.question);
        try {
          gate.acquires = 0;
          const next = await runSendChatCommand(command, via.ctx!, T);
          assert.equal(next, old, where);
          assert.deepEqual(await sendSnapshot(db), oldState, where);
          // NOT_ALLOWED không cần công cụ (nhánh sớm ở lớp lệnh) — còn lại đúng một lời gọi
          assert.ok(gate.acquires <= 1 && (gate.acquires === 1 || old.startsWith("Lệnh gửi tin chỉ dành cho")), `${where}: ${gate.acquires} lời gọi`);
          if (!old.startsWith("Lệnh gửi tin chỉ dành cho")) replied += 1;
        } finally { await via.close(); }
        compared += 1;
      }
    }
    assert.equal(compared, PERSONAS.length * SCENARIOS.length);
    assert.ok(replied > 40, `quá ít ca có câu trả lời thật (${replied})`);
  });

  // ------------------------------------------------------------------ «đồng ý» / «hủy» trơn
  test("VÀNG kho chờ xác nhận: nháp mới nhất của người hỏi — `at`, câu «đồng ý» / «hủy», trạng thái DB cũ == MCP; không nháp = null; chỉ nháp của CHÍNH mình", async () => {
    for (const uid of ["u-mi", "u-phong", "u-tuan", "u-huy"] as const) {
      for (const action of ["confirm", "cancel"] as const) {
        const outcomes: unknown[] = [];
        for (const mode of ["legacy", "mcp"] as const) {
          await resetSendState(db);
          await preview("u-mi", "họp 3h chiều nay")();
          await preview(uid, "bản nháp của riêng mình")();
          const threadId = w.direct.get(uid)!;
          let chat: ChatCommandContext;
          let close = async () => undefined as unknown;
          if (mode === "legacy") {
            chat = { db, asker: null, inGroup: false, now: T, send: (await buildSendChatContextLegacy(w.deps, await requestFor(db, uid, threadId, "đồng ý", w.world.botId)))! };
          } else {
            const via = await mcpContext(uid, threadId, "đồng ý");
            chat = { db, asker: null, inGroup: false, now: T, send: via.ctx! };
            close = via.close;
          }
          try {
            const store = await (mode === "legacy" ? sendPendingProviderLegacy : sendPendingProvider).latest({ chat, access: null });
            const reply = store ? await store[action]() : null;
            outcomes.push({ at: store?.at ?? null, reply, state: await sendSnapshot(db) });
          } finally { await close(); }
        }
        assert.deepEqual(outcomes[1], outcomes[0], `${uid} ${action}`);
      }
    }
    // Người chưa từng ra lệnh: không có kho chờ
    await resetSendState(db);
    const via = await mcpContext("u-hang", w.direct.get("u-hang")!, "đồng ý");
    try {
      assert.equal(await sendPendingProvider.latest({ chat: { db, asker: null, inGroup: false, now: T, send: via.ctx! }, access: null }), null);
    } finally { await via.close(); }
  });

  test("xác nhận hai lần: chỉ MỘT lần xếp việc gửi (claimConfirm nguyên tử), lần hai báo đã xác nhận", async () => {
    await preview("u-mi", "họp 3h chiều nay")();
    const via = await mcpContext("u-mi", w.direct.get("u-mi")!, "đồng ý G-1");
    try {
      const command = parseChatCommand("đồng ý G-1") as SendChatCommand;
      const first = await runSendChatCommand(command, via.ctx!, T);
      const second = await runSendChatCommand(command, via.ctx!, T);
      assert.match(first, /Đã nhận lệnh G-1: 1 nơi, đang gửi/);
      assert.match(second, /đã được xác nhận rồi/);
      assert.equal(((await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM job WHERE kind = ?", [Number((await sendSnapshot(db)).jobs[0][0])]))[0][0] as RowDataPacket).n, 1);
    } finally { await via.close(); }
  });

  // ------------------------------------------------------------------ mô hình
  const openTurns: { close: () => Promise<void> }[] = [];
  afterEachClose();
  function afterEachClose() {
    after(async () => { for (const turn of openTurns) await turn.close(); });
  }

  /** Phiên MCP với chủ thể ĐÃ đăng ký ngữ cảnh gửi (như buildSendChatContext làm) — tin `question` là nguyên văn người hỏi. */
  async function registered(uid: string, question: string, threadId = w.direct.get(uid)!, groupScopeId?: number) {
    const access = await accessFor(db, uid, threadId, groupScopeId);
    registerSendTurn(access.contactActor!, { question, deps: { calendar: w.deps.calendar, wakeJobs: w.deps.wakeJobs } });
    const turn = openMcpTurn(access, bridge, { groupScopeId, wakeJobs: () => undefined })!;
    openTurns.push(turn);
    return { access, turn };
  }

  test("tools/list: mô hình có propose_send_message / propose_group_reminder, KHÔNG có công cụ xác nhận / lệnh; lệnh có công cụ lệnh, không có propose_*; cổng /mcp ngoài không thấy gì của họ", async () => {
    const { access, turn } = await modelTurn("u-mi", `gửi nhóm ${G1}: hi`);
    const model = (await turn.model())!;
    const command = (await turn.command())!;
    for (const name of ["propose_send_message", "propose_group_reminder"]) {
      assert.ok(model.toolNames.has(name), `mô hình thiếu ${name}`);
      assert.ok(!command.toolNames.has(name));
      assert.ok(turn.blocksAfterFixedReply(name));
    }
    for (const name of SEND_TOOL_NAMES) {
      assert.ok(!model.toolNames.has(name), `mô hình thấy ${name}`);
      assert.ok(command.toolNames.has(name), `lệnh thiếu ${name}`);
    }
    await assert.rejects(turn.callTool("assistant_model", "send_draft_confirm", { command_id: 1 }));
    await assert.rejects(turn.callTool("assistant_model", "send_draft_create", { question: "x", target_names: [], schedule_text: "", body: "", with_recent_files: false }));
    assert.ok(model.instructions.includes("propose_send_message") && model.instructions.includes("send_brief"));
    const external = new Set(toolsFor(access, "mcp_http", ALL_TOOLS).map((tool) => tool.name));
    for (const name of ["propose_send_message", "propose_group_reminder", ...SEND_TOOL_NAMES]) assert.ok(!external.has(name), `cổng ngoài lộ ${name}`);
    const bare = new Set(toolsFor({ ...access, contactActor: undefined }, "assistant_model", ALL_TOOLS).map((tool) => tool.name));
    assert.ok(!bare.has("propose_send_message"), "không chủ thể liên hệ thì công cụ gửi không lên");
  });

  test("công cụ mô hình ẩn khi: không đủ quyền ra lệnh, hỏi trong nhóm, cuộc web-/demo-, chưa đăng ký ngữ cảnh gửi", async () => {
    for (const [uid, threadId, group] of [["u-huy", w.direct.get("u-huy")!, undefined], ["u-dis", w.direct.get("u-dis")!, undefined], ["u-mi", w.webThread, undefined], ["u-mi", w.demoThread, undefined], ["u-mi", w.world.g1, w.world.g1]] as const) {
      const { turn } = await registered(uid, "gửi nhóm A: hi", threadId, group);
      // Công cụ lên theo `send_context` đã chạy; chưa chạy thì ẩn — gọi nó như buildSendChatContext rồi mở phiên mô hình mới
      await turn.callTool("assistant_command", "send_context", {});
      const fresh = openMcpTurn(await accessFor(db, uid, threadId, group), bridge, { groupScopeId: group })!;
      openTurns.push(fresh);
      assert.ok(!(await fresh.model())!.toolNames.has("propose_send_message"), `${uid} thread=${threadId} group=${group ?? "-"}`);
    }
    const access = await accessFor(db, "u-mi", w.direct.get("u-mi")!);
    const turn = openMcpTurn(access, bridge)!;
    openTurns.push(turn);
    assert.ok(!(await turn.model())!.toolNames.has("propose_send_message"), "chưa đăng ký ngữ cảnh gửi");
    assert.ok(!(await turn.command())!.toolNames.has("send_draft_create"));
  });

  /** Đăng ký + phân giải như buildSendChatContext (gọi send_context) rồi mở phiên mô hình: danh sách công cụ mô hình phụ thuộc kết quả phân giải. */
  async function modelTurn(uid: string, question: string) {
    const access = await accessFor(db, uid, w.direct.get(uid)!);
    registerSendTurn(access.contactActor!, { question, deps: { calendar: w.deps.calendar, wakeJobs: w.deps.wakeJobs } });
    const boot = openMcpTurn(access, bridge)!;
    await boot.callTool("assistant_command", "send_context", {});
    await boot.close();
    const turn = openMcpTurn(access, bridge, { wakeJobs: () => undefined })!;
    openTurns.push(turn);
    return { access, turn };
  }

  const PROPOSALS: { name: string; question: string; args: Record<string, unknown> }[] = [
    { name: "propose_send_message", question: `nhắn nhóm ${G1} là họp 3h chiều nay nhé`, args: { targets: [G1], content: "họp 3h chiều nay nhé" } },
    { name: "propose_send_message", question: `nhắn nhóm ${G1} lúc 8h sáng mai: nghỉ lễ`, args: { targets: [G1, "Kho HN"], content: "nghỉ lễ", schedule: "8h sáng mai" } },
    { name: "propose_send_message", question: `nhắn nhóm ${G1} họp`, args: { targets: [G1], content: "NỘI DUNG MÔ HÌNH TỰ SỬA" } },
    { name: "propose_send_message", question: "nhắn nhóm abc", args: { targets: [], content: "x" } },
    { name: "propose_send_message", question: "gửi tệp", args: { targets: [G1], content: " ", with_recent_files: true } },
    { name: "propose_send_message", question: `nhắn nhóm TEST ĐL Thành Công: hi`, args: { targets: ["TEST ĐL Thành Công"], content: "hi" } },
    { name: "propose_group_reminder", question: `tạo nhắc hẹn họp giao ban trong nhóm ${G1}`, args: { groups: [G1], title: "Họp giao ban", start_time: "2026-10-13T08:00:00+07:00" } },
    { name: "propose_group_reminder", question: `nhắc hẹn nhóm ${G1}`, args: { groups: [G1], title: "Họp", start_time: "2026-10-13T08:00:00+07:00", repeat: "weekly" } },
    { name: "propose_group_reminder", question: `nhắc hẹn nhóm ${G1}`, args: { groups: [G1], title: "Họp", start_time: "2020-01-01T08:00:00+07:00" } },
    { name: "propose_group_reminder", question: "nhắc hẹn", args: { groups: [G1], title: " ", start_time: "2026-10-13T08:00:00+07:00" } },
    { name: "propose_group_reminder", question: "nhắc hẹn nhóm TEST BGĐ Công nợ", args: { groups: ["TEST BGĐ Công nợ"], title: "Họp", start_time: "2026-10-13T08:00:00+07:00" } },
  ];

  test("VÀNG công cụ đề xuất của mô hình: kết quả cho mô hình + câu dựng sẵn (fixedReply) + hàng DB cũ == MCP — mọi người hỏi × đề xuất", async () => {
    let drafted = 0;
    for (const uid of ["u-mi", "u-phong", "u-tuan", "u-huy", "u-dis"] as const) {
      for (const proposal of PROPOSALS) {
        const where = `${proposal.name} ${JSON.stringify(proposal.args)} / ${uid}`;
        await resetSendState(db);
        const requester = await loadSendRequester(db, uid);
        const legacyChat: SendChatContext | undefined = requester ? {
          deps: w.deps, requester, uid, name: requester.name, requesterContactId: (await accessFor(db, uid, w.direct.get(uid)!)).contactActor!.contactId,
          question: proposal.question, sourceThreadId: w.direct.get(uid)!, botAccountId: 1,
        } : undefined;
        const legacy = requester
          ? await (proposal.name === "propose_send_message" ? runProposeSendTool : runProposeReminderTool)(legacyChat, proposal.args, T)
          : null;
        const oldState = await sendSnapshot(db);
        await resetSendState(db);
        const { turn } = await modelTurn(uid, proposal.question);
        const listed = (await turn.model())!.toolNames.has(proposal.name);
        if (!requester) { assert.ok(!listed, `${where}: không đủ quyền thì không được thấy công cụ`); continue; }
        assert.ok(listed, where);
        const sink = { filesToSend: [] as number[], fixedReply: undefined as string | undefined };
        const response = mapCallToolResult(sink, await turn.callTool("assistant_model", proposal.name, proposal.args), "string");
        assert.deepEqual(response, legacy!.response, where);
        assert.equal(sink.fixedReply, legacy!.fixedReply, where);
        assert.deepEqual(await sendSnapshot(db), oldState, where);
        if (sink.fixedReply?.startsWith("XEM TRƯỚC")) drafted += 1;
      }
    }
    assert.ok(drafted >= 8, `quá ít bản xem trước (${drafted})`);
  });

  test("khai báo cho mô hình GIỮ NGUYÊN: tên, mô tả, sơ đồ của propose_send_message / propose_group_reminder bằng bản cũ", async () => {
    const { turn } = await modelTurn("u-mi", "x");
    const session = (await turn.model())!;
    const declared = toFunctionDeclarationsFromMcp(session.tools).filter((tool) => tool.name.startsWith("propose_"));
    assert.deepEqual(declared.map((tool) => tool.name), ["propose_send_message", "propose_group_reminder"]);
    for (const old of [PROPOSE_SEND_DECLARATION, PROPOSE_REMINDER_DECLARATION]) {
      const now = declared.find((tool) => tool.name === old.name)!;
      assert.equal(now.description, old.description);
      assert.deepEqual(now.parameters, old.parameters);
    }
  });

  test("nhật ký gọi: mô hình = nguồn 2 (propose_send_message), lệnh gõ = nguồn 3 (send_draft_create), cùng contact_id, không khóa MCP", async () => {
    const { turn, access } = await modelTurn("u-mi", `nhắn nhóm ${G1} là họp 3h chiều nay nhé`);
    await turn.callTool("assistant_model", "propose_send_message", { targets: [G1], content: "họp 3h chiều nay nhé" });
    await turn.callTool("assistant_command", "send_draft_create", { question: `gửi nhóm ${G1}: họp`, target_names: [G1], schedule_text: "", body: "họp", with_recent_files: false });
    const read = () => db.query<RowDataPacket[]>("SELECT tool, source, contact_id, key_id FROM mcp_call_log WHERE tool IN ('propose_send_message', 'send_draft_create') ORDER BY id").then(([rows]) => rows);
    let logs = await read();
    for (let attempt = 0; attempt < 40 && logs.length < 2; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 50)); logs = await read(); }
    assert.deepEqual(logs.map((row) => [row.tool, row.source]), [["propose_send_message", 2], ["send_draft_create", 3]]);
    assert.ok(logs.every((row) => row.contact_id === access.contactActor!.contactId && row.key_id === null));
  });
});
