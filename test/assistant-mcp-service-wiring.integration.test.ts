// Tích hợp sau đợt 2 — AssistantService THẬT (MySQL thật, mô hình kịch bản) với các họ qua MCP: lệnh gõ «việc» / «cần xử lý» ghi mcp_call_log nguồn 3,
// khai báo của mô hình mất `confirm_alert_change` khi họ `alerts` bật, phiên MCP của lệnh không rò sau lượt tin riêng, và một lượt mô hình + lệnh gõ cho TỪNG họ
// với `all` (mọi lời gọi có dòng nhật ký đúng nguồn; không dòng nào = đường cũ). Dữ liệu: thế giới thử của test họ `send`.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_int2 npm test

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { AssistantService } from "../src/assistant/assistant-service.js";
import type { AlertToolsDeps } from "../src/assistant/alert-tools.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { AssistantMcpTurn } from "../src/assistant/mcp-bridge/assistant-mcp-turn.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { FileStorage } from "../src/storage/file-storage.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { PIN_TOOL_PROMPT, REMINDER_TOOL_PROMPT, SEND_TOOL_PROMPT } from "../src/send-commands/send-tool-prompts.js";
import { makeConfig } from "./phase8-brief-fixtures.js";
import { CountingGate, G1, setupSendWorld, T, type SendWorld } from "./assistant-mcp-send-fixtures.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

type Parts = GeminiContent["parts"];
class ScriptedModel implements ModelClient {
  readonly requests: { system?: string; contents: GeminiContent[]; tools: { name: string }[] }[] = [];
  constructor(private readonly turns: Parts[]) {}
  async generate(request: { system?: string; contents: GeminiContent[]; tools: { name: string }[] }) {
    this.requests.push({ system: request.system, contents: structuredClone(request.contents), tools: structuredClone(request.tools) });
    const turn = this.turns.shift();
    if (!turn) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: turn }, inputTokens: 10, outputTokens: 5 };
  }
}
const call = (name: string, args: Record<string, unknown>) => ({ functionCall: { name, args } });

describe("AssistantService + họ qua MCP (tích hợp sau đợt 2)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let w: SendWorld;
  const gate = new CountingGate(5, 20_000);
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

  const logs = async () => (await db.query<RowDataPacket[]>("SELECT tool, source FROM mcp_call_log ORDER BY id"))[0].map((row) => [row.tool as string, Number(row.source)] as const);

  /** Một lượt hỏi ở tin riêng của `uid`; `families` = chuỗi công tắc họ ("" = tắt hết). */
  async function dmTurn(families: string, question: string, script: Parts[], uid = "u-mi") {
    const model = new ScriptedModel(script);
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 1000, dailyTokenCap: 100_000_000 }, () => T, {
      tickets: { db, wakeJobs: () => undefined }, sendCommands: w.deps, alertTools: alertDeps(), storage: {} as FileStorage, coreQueryTools: true,
      mcpBridge: { families: () => parseMcpFamilies(families), gate },
    });
    const contact = (await findContactByUid(db, uid))!;
    const reply = await service.answer({ botAccountId: w.world.botId, contact, threadId: w.direct.get(uid)!, questionMessageId: null, question });
    return { reply, model };
  }

  test("lệnh gõ «việc» qua AssistantService thật: họ tasks bật ⇒ mcp_call_log nguồn 3 (task_list_for_actor); họ tắt ⇒ không dòng nào, cùng câu trả lời", async () => {
    const replies: (string | null)[] = [];
    for (const families of ["", "tasks"]) {
      await db.query("TRUNCATE TABLE mcp_call_log");
      const { reply, model } = await dmTurn(families, "việc", []);
      assert.equal(model.requests.length, 0, "lệnh gõ không qua mô hình");
      replies.push(reply.text);
      const rows = await logs();
      if (families) assert.deepEqual(rows, [["task_list_for_actor", 3]]);
      else assert.deepEqual(rows, []);
    }
    assert.equal(replies[1], replies[0]);
  });

  test("họ alerts bật: khai báo cho mô hình KHÔNG có confirm_alert_change (có propose_alert_change); «cần xử lý» gõ → alert_pending_list nguồn 3; họ tắt: còn confirm_alert_change", async () => {
    for (const families of ["alerts", ""]) {
      await db.query("TRUNCATE TABLE mcp_call_log");
      const { model } = await dmTurn(families, "hôm nay anh cần biết tình hình chung", [[{ text: "ok" }]]);
      const names = new Set(model.requests[0].tools.map((tool) => tool.name));
      assert.ok(names.has("propose_alert_change") && names.has("list_pending_items"), `${families || "tắt"}: thiếu công cụ cảnh báo`);
      assert.equal(names.has("confirm_alert_change"), families === "", `${families || "tắt"}: confirm_alert_change`);
    }
    await db.query("TRUNCATE TABLE mcp_call_log");
    const typed = await dmTurn("alerts", "cần xử lý", []);
    assert.equal(typed.model.requests.length, 0);
    assert.deepEqual(await logs(), [["alert_pending_list", 3]]);
    // người hỏi không phải người dùng cảnh báo (không vai trò, không người nhận): công cụ họ alerts không lên
    await db.query("INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES ('u-la', 'Người lạ', 1, 0)");
    const { ensureThread, directKey } = await import("../src/sync/group-repository.js");
    w.direct.set("u-la", (await ensureThread(db, directKey(w.world.botId, "u-la"), { readMessages: true, captureFiles: false }, "u-la")).group.id);
    const stranger = await dmTurn("alerts", "xin chào em", [[{ text: "chào" }]], "u-la");
    assert.ok(!stranger.model.requests[0].tools.some((tool) => /pending_items|propose_alert_change/.test(tool.name)));
  });

  test("không phiên MCP nào còn mở sau lượt tin riêng (lệnh gõ, mô hình, lượt lỗi) — ngữ cảnh lệnh gửi mở phiên ở MỌI tin riêng", async () => {
    const open = new Set<AssistantMcpTurn>();
    let opened = 0;
    const originalClose = AssistantMcpTurn.prototype.close;
    // `session` (riêng tư) là cửa mở phiên duy nhất: mọi lượt có phiên đều đi qua nó
    const proto = AssistantMcpTurn.prototype as unknown as { session: (surface: string) => Promise<unknown> };
    const originalSession = proto.session;
    mock.method(proto, "session", function (this: AssistantMcpTurn, surface: string) { open.add(this); opened += 1; return originalSession.call(this, surface); });
    mock.method(AssistantMcpTurn.prototype, "close", async function (this: AssistantMcpTurn) { await originalClose.call(this); open.delete(this); });
    await dmTurn("all", "xin chào em", [[{ text: "chào anh" }]]);
    assert.ok((await logs()).some(([tool, source]) => tool === "send_context" && source === 3), "ngữ cảnh gửi đã mở phiên lệnh");
    assert.ok(opened > 0, "bộ theo dõi phải thấy phiên đã mở");
    assert.equal(open.size, 0, "lượt mô hình thường");
    await dmTurn("all", "việc", []);
    assert.equal(open.size, 0, "lượt lệnh gõ");
    const failed = await dmTurn("all", "xin chào em", []);
    assert.match(String(failed.reply.text), /gặp lỗi/);
    assert.equal(open.size, 0, "lượt lỗi");
  });

  test("lắp lời nhắc họ send: lời nhắc gửi / nhắc hẹn từ `instructions` của máy chủ đúng MỘT lần, ghim vẫn còn đúng một lần (không mất, không trùng); họ tắt: như cũ", async () => {
    for (const families of ["all", ""]) {
      const { model } = await dmTurn(families, "xin chào em", [[{ text: "chào anh" }]]);
      const system = model.requests[0].system ?? "";
      for (const prompt of [SEND_TOOL_PROMPT, REMINDER_TOOL_PROMPT, PIN_TOOL_PROMPT]) {
        assert.equal(system.split(prompt.trim()).length - 1, 1, `${families || "tắt"}: ${prompt.trim().slice(0, 40)}`);
      }
    }
  });

  test("SMOKE ASSISTANT_MCP_FAMILIES=all: mỗi họ một lượt mô hình / lệnh gõ — dòng mcp_call_log đúng nguồn, công cụ không báo «chưa bật» (không lùi về đường cũ)", async () => {
    // Lượt mô hình: đọc, lõi, tệp, ticket, việc, cảnh báo, số liệu trong MỘT vòng; đề xuất gửi tin ở vòng sau (chốt câu trả lời của lượt)
    const model = await dmTurn("all", "tổng hợp giúp anh tình hình hôm nay", [
      [call("list_groups", {}), call("search_messages", { query: "báo giá" }), call("describe_entities", {}), call("search_files", { query: "" }),
        call("read_file", { attachment_id: 999_999 }), call("list_tickets", {}), call("list_tasks", {}), call("list_pending_items", { limit: 5 }),
        call("query_metrics", { metric: "revenue", period: "this_month" })],
      [call("propose_send_message", { targets: [G1], content: "họp 3h chiều nay nhé" })],
    ]);
    assert.match(String(model.reply.text), /gửi|nháp|đồng ý/i, "xem trước lệnh gửi do máy chủ dựng");
    const modelRows = await logs();
    const sourceOf = (tool: string) => modelRows.filter(([name]) => name === tool).map(([, source]) => source);
    for (const [tool, source] of [
      ["list_groups", 2], ["search_messages", 2], ["describe_entities", 2], ["search_files", 2], ["file_read_prepare", 3], ["list_tickets", 2], ["list_tasks", 2],
      ["list_pending_items", 2], ["query_metrics", 2], ["propose_send_message", 2], ["send_context", 3],
    ] as const) assert.ok(sourceOf(tool).includes(source), `${tool}: thiếu dòng nhật ký nguồn ${source} — ${JSON.stringify(modelRows)}`);
    const firstRound = model.model.requests[1].contents.flatMap((content) => content.parts).flatMap((part) => (part.functionResponse ? [part.functionResponse] : []));
    for (const response of firstRound) {
      const text = JSON.stringify(response.response);
      assert.ok(!/chưa bật|không có công cụ|Công cụ .* không có/i.test(text), `${response.name}: ${text}`);
    }
    // Lượt lệnh gõ: ticket, việc, cảnh báo, gửi tin — mỗi lệnh đúng MỘT dòng nguồn 3 của họ (cộng send_context của ngữ cảnh gửi)
    for (const [question, tool] of [["ticket", "ticket_list_for_actor"], ["việc", "task_list_for_actor"], ["cần xử lý", "alert_pending_list"], [`gửi nhóm ${G1}: họp 3h`, "send_draft_create"]] as const) {
      await db.query("TRUNCATE TABLE mcp_call_log");
      const typed = await dmTurn("all", question, []);
      assert.equal(typed.model.requests.length, 0, `${question}: lệnh gõ không qua mô hình`);
      const rows = await logs();
      assert.ok(rows.filter(([name, source]) => name === tool && source === 3).length === 1, `${question}: ${JSON.stringify(rows)}`);
      assert.ok(rows.every(([, source]) => source === 3), `${question}: mọi dòng của lệnh gõ phải nguồn 3`);
    }
  });
});
