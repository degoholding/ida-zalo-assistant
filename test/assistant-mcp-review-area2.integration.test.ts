// Tích hợp sửa review khu vực 2 (cầu nối / ráp) — AssistantService THẬT + MySQL thật + mô hình kịch bản:
// H1 lời nhắc chỉ của họ có công cụ thật sự cho lượt này, H2 ngữ cảnh gửi lười + lùi về đọc cũ khi MCP lỗi, M1 phiên lệnh khóa nhóm,
// L2 họ bật đọc một lần mỗi lượt, L3 phiên mô hình luôn đóng.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_fixB npm test

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import { AssistantService } from "../src/assistant/assistant-service.js";
import { ALERT_FAMILY_INSTRUCTIONS, ALERT_TOOLS_PROMPT, type AlertToolsDeps } from "../src/assistant/alert-tools.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { AssistantMcpTurn } from "../src/assistant/mcp-bridge/assistant-mcp-turn.js";
import { AssistantTurnStatus, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { QUERY_METRICS_PROMPT } from "../src/metrics/metric-query-tool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { SUGGEST_REPLIES_PROMPT } from "../src/reply-suggestions/reply-suggestion-tool.js";
import { PIN_TOOL_PROMPT, REMINDER_TOOL_PROMPT, SEND_TOOL_PROMPT } from "../src/send-commands/send-tool-prompts.js";
import type { FileStorage } from "../src/storage/file-storage.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { makeConfig } from "./phase8-brief-fixtures.js";
import { setupSendWorld, T, type SendWorld } from "./assistant-mcp-send-fixtures.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

type Parts = GeminiContent["parts"];
class ScriptedModel implements ModelClient {
  readonly requests: { system?: string; tools: { name: string }[] }[] = [];
  constructor(private readonly turns: Parts[]) {}
  async generate(request: { system?: string; contents: GeminiContent[]; tools: { name: string }[] }) {
    this.requests.push({ system: request.system, tools: structuredClone(request.tools) });
    const turn = this.turns.shift();
    if (!turn) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: turn }, inputTokens: 10, outputTokens: 5 };
  }
}

describe("AssistantService + cầu nối MCP — sửa review khu vực 2", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let w: SendWorld;
  const alertDeps = (): AlertToolsDeps => ({ db, config: makeConfig(), saveSettings: async (patch) => Object.keys(patch), invalidate: () => undefined });

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    w = await setupSendWorld(db);
    await db.query("TRUNCATE TABLE assistant_turn");
  });
  afterEach(() => mock.restoreAll());

  function service(model: ModelClient, bridge: { families: () => ReturnType<typeof parseMcpFamilies>; gate: ConcurrencyGate }) {
    return new AssistantService(db, model, "gia-lap", { maxPerHour: 1000, dailyTokenCap: 100_000_000 }, () => T, {
      tickets: { db, wakeJobs: () => undefined }, sendCommands: w.deps, alertTools: alertDeps(), storage: {} as FileStorage, coreQueryTools: true, mcpBridge: bridge,
    });
  }
  const bridgeOf = (families: string, gate = new ConcurrencyGate(5, 20_000)) => ({ families: () => parseMcpFamilies(families), gate });
  const count = (system: string, prompt: string) => system.split(prompt.trim()).length - 1;

  async function dm(uid: string, question: string, script: Parts[], bridge = bridgeOf("all")) {
    const model = new ScriptedModel(script);
    const contact = (await findContactByUid(db, uid))!;
    const reply = await service(model, bridge).answer({ botAccountId: w.world.botId, contact, threadId: w.direct.get(uid)!, questionMessageId: null, question });
    return { reply, model };
  }

  test("H1: hỏi TRONG NHÓM với mọi họ: không lời nhắc gửi / số liệu / cảnh báo / gợi ý (công cụ của chúng không có trong nhóm)", async () => {
    const model = new ScriptedModel([[{ text: "ok" }]]);
    const contact = (await findContactByUid(db, "u-mi"))!;
    const reply = await service(model, bridgeOf("all")).answer({
      botAccountId: w.world.botId, contact, threadId: w.world.g1, questionMessageId: null, question: "tình hình nhóm thế nào",
      groupScope: { groupId: w.world.g1, groupName: "TEST Sales Miền Tây" },
    });
    assert.equal(reply.status, AssistantTurnStatus.Answered);
    const system = model.requests[0].system ?? "";
    for (const prompt of [SEND_TOOL_PROMPT, REMINDER_TOOL_PROMPT, PIN_TOOL_PROMPT, QUERY_METRICS_PROMPT, ALERT_TOOLS_PROMPT, ALERT_FAMILY_INSTRUCTIONS, SUGGEST_REPLIES_PROMPT]) {
      assert.equal(count(system, prompt), 0, `nhóm: còn lời nhắc ${prompt.trim().slice(0, 40)}`);
    }
    assert.ok(system.includes("query_records"), "lời nhắc họ core (có công cụ trong nhóm) vẫn còn");
  });

  test("H1: tin riêng người không vai trò: không lời nhắc gửi / cảnh báo; người quản lý: mỗi lời nhắc đúng MỘT lần, không lời nhắc cảnh báo cũ trùng", async () => {
    const stranger = await dm("u-huy", "xin chào em", [[{ text: "chào" }]]);
    const lowSystem = stranger.model.requests[0].system ?? "";
    for (const prompt of [SEND_TOOL_PROMPT, REMINDER_TOOL_PROMPT, PIN_TOOL_PROMPT, ALERT_TOOLS_PROMPT, ALERT_FAMILY_INSTRUCTIONS]) {
      assert.equal(count(lowSystem, prompt), 0, `người không vai trò: còn ${prompt.trim().slice(0, 40)}`);
    }
    const manager = await dm("u-mi", "xin chào em", [[{ text: "chào anh" }]]);
    const system = manager.model.requests[0].system ?? "";
    for (const prompt of [SEND_TOOL_PROMPT, REMINDER_TOOL_PROMPT, ALERT_FAMILY_INSTRUCTIONS, QUERY_METRICS_PROMPT]) assert.equal(count(system, prompt), 1, prompt.trim().slice(0, 40));
    assert.equal(count(system, ALERT_TOOLS_PROMPT), 0, "lời nhắc cảnh báo cũ đã được thay");
  });

  test("H2: send_context lười + lỗi MCP (cổng bận) → câu hỏi thường VẪN được trả lời (lùi về đọc cũ), không hỏng cả lượt", async () => {
    const busy = new ConcurrencyGate(0, 5);
    const { reply } = await dm("u-mi", "xin chào em", [[{ text: "chào anh" }]], bridgeOf("all", busy));
    assert.equal(reply.status, AssistantTurnStatus.Answered);
    assert.match(String(reply.text), /chào anh/);
  });

  test("H2: lệnh gõ không cần ngữ cảnh gửi («việc», «ticket») KHÔNG gọi send_context; lệnh gửi gõ thì có", async () => {
    for (const question of ["việc", "ticket"]) {
      await db.query("TRUNCATE TABLE mcp_call_log");
      await dm("u-mi", question, []);
      const [rows] = await db.query<any[]>("SELECT tool FROM mcp_call_log");
      assert.ok(!rows.some((row) => row.tool === "send_context"), `${question}: không được hỏi send_context`);
    }
    await db.query("TRUNCATE TABLE mcp_call_log");
    await dm("u-mi", "lệnh gửi", []);
    const [rows] = await db.query<any[]>("SELECT tool FROM mcp_call_log");
    assert.ok(rows.some((row) => row.tool === "send_context"), "lệnh gửi cần ngữ cảnh gửi");
  });

  test("M1: Quản trị hỏi trong nhóm → phiên lệnh khóa nhóm: không quyền ghi, không confirm_draft", async () => {
    await db.query("INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) SELECT 'ad@x.vn', 'ad', 'ad', ?, id, 1, 1, 1 FROM contact WHERE zalo_uid = 'u-phong'", [UserRole.Admin]);
    const seen: { allowWrite: boolean; groupScopeId?: number; tools: string[] }[] = [];
    const original = AssistantMcpTurn.prototype.command;
    mock.method(AssistantMcpTurn.prototype, "command", async function (this: AssistantMcpTurn) {
      const session = await original.call(this);
      const ctx = (this as unknown as { access: { allowWrite: boolean; groupScopeId?: number } }).access;
      seen.push({ allowWrite: ctx.allowWrite, groupScopeId: ctx.groupScopeId, tools: [...(session?.toolNames ?? [])] });
      return session;
    });
    const contact = (await findContactByUid(db, "u-phong"))!;
    await service(new ScriptedModel([]), bridgeOf("all")).answer({
      botAccountId: w.world.botId, contact, threadId: w.world.g1, questionMessageId: null, question: "ticket",
      groupScope: { groupId: w.world.g1, groupName: "TEST Sales Miền Tây" },
    });
    assert.ok(seen.length > 0, "lệnh ticket trong nhóm phải mở phiên lệnh");
    for (const entry of seen) {
      assert.equal(entry.groupScopeId, w.world.g1);
      assert.equal(entry.allowWrite, false);
      assert.ok(!entry.tools.includes("confirm_draft"), `phiên lệnh trong nhóm có confirm_draft: ${entry.tools}`);
    }
  });

  test("L2: họ bật đọc MỘT lần mỗi lượt (phiên lệnh và phiên mô hình dùng chung ảnh chụp)", async () => {
    let reads = 0;
    const bridge = { families: () => { reads += 1; return parseMcpFamilies("all"); }, gate: new ConcurrencyGate(5, 20_000) };
    await dm("u-mi", "xin chào em", [[{ text: "chào anh" }]], bridge);
    assert.equal(reads, 1);
  });

  test("L3: phiên mô hình luôn đóng — kể cả khi dựng khai báo ném lỗi trước vòng gọi mô hình", async () => {
    const opened = new Set<AssistantMcpTurn>();
    const closed = new Set<AssistantMcpTurn>();
    const originalClose = AssistantMcpTurn.prototype.close;
    mock.method(AssistantMcpTurn.prototype, "model", async function (this: AssistantMcpTurn) { opened.add(this); throw new Error("hỏng khi mở phiên mô hình"); });
    mock.method(AssistantMcpTurn.prototype, "close", async function (this: AssistantMcpTurn) { closed.add(this); await originalClose.call(this); });
    await assert.rejects(dm("u-mi", "xin chào em", [[{ text: "chào" }]]), /hỏng khi mở phiên mô hình/);
    assert.ok(opened.size > 0);
    for (const turn of opened) assert.ok(closed.has(turn), "phiên mô hình chưa được đóng");
  });
});
