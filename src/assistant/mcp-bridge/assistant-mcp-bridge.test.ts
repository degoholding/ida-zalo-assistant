import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod/v4";
import { McpCallSource, McpCallStatus } from "../../constants.js";
import { buildDataAccessContext } from "../../data-access/data-access-context.js";
import { fakeDb, manager, staff, NOW } from "../../data-access/data-access-test-support.js";
import { ALL_TOOLS, toolsFor } from "../../data-access/read-tool-catalog.js";
import type { AnyToolDefinition } from "../../data-access/tool-definition.js";
import { eraseTool } from "../../data-access/tool-definition.js";
import { runTool as runCoreToolDefinition } from "../../data-access/tool-runner.js";
import { ConcurrencyGate } from "../../mcp/mcp-concurrency-gate.js";
import type { McpCallLogEntry } from "../../mcp/mcp-call-log.js";
import type { Principal } from "../../auth/principal.js";
import type { AskerAccess } from "../asker-access.js";
import { coreToolDeclarations, coreToolOptions } from "../core-tool-adapter.js";
import { writeToolDeclarations } from "../write-tool-adapter.js";
import type { AssistantMcpBridge } from "./assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "./assistant-mcp-families.js";
import { AssistantMcpTurn } from "./assistant-mcp-turn.js";
import { mapCallToolResult } from "./mcp-call-result-mapper.js";
import { toFunctionDeclarationsFromMcp } from "./mcp-declaration-adapter.js";
import { openMcpTurn } from "./open-mcp-turn.js";
import { loadMcpTurnTools } from "./turn-tool-declarations.js";

// Cầu nối MCP trong tiến trình (không DB thật): phiên lười, hai mặt tách bằng cấu trúc, `tools/call` JSON-RPC thật qua InMemoryTransport,
// khai báo dựng từ `tools/list` KHỚP khai báo cũ của công cụ đã ở lõi, cổng đồng thời riêng.

const access = (principal: Principal, overrides: Partial<AskerAccess> = {}): AskerAccess => ({
  ...buildDataAccessContext({ db: fakeDb().db, principal, maskPersonal: false, source: McpCallSource.Assistant, now: NOW, ownDirectThreadsOnly: true, ownDirectUid: "u-1" }),
  origin: "web_user", ...overrides,
});

function rig(families: string, options: { max?: number; waitMs?: number; groupScopeId?: number; asker?: AskerAccess } = {}) {
  const logs: McpCallLogEntry[] = [];
  const gate = new ConcurrencyGate(options.max ?? 5, options.waitMs ?? 50);
  const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies(families), gate };
  const turn = openMcpTurn(options.asker ?? access(manager()), bridge, { groupScopeId: options.groupScopeId, coreQueryTools: true });
  return { turn, logs, gate };
}

test("parseMcpFamilies: rỗng = tắt; all = mọi họ; chữ hoa / khoảng trắng được; họ lạ bị bỏ qua", () => {
  assert.equal(parseMcpFamilies("").size, 0);
  assert.equal(parseMcpFamilies(undefined).size, 0);
  assert.equal(parseMcpFamilies(" , ").size, 0);
  assert.ok(parseMcpFamilies("ALL").has("send") && parseMcpFamilies("all").size >= 9);
  assert.deepEqual([...parseMcpFamilies(" Core , drafts,nonsense ")].sort(), ["core", "drafts"]);
});

test("họ tắt: không dựng phiên nào (openMcpTurn trả undefined); họ core bị loại khi cài đặt công cụ lõi tắt", () => {
  const bridge = (families: string): AssistantMcpBridge => ({ families: () => parseMcpFamilies(families), gate: new ConcurrencyGate(1, 10) });
  assert.equal(openMcpTurn(access(manager()), null), undefined);
  assert.equal(openMcpTurn(access(manager()), bridge("")), undefined);
  assert.equal(openMcpTurn(access(manager()), bridge("core"), { coreQueryTools: false }), undefined);
  assert.ok(openMcpTurn(access(manager()), bridge("core,drafts"), { coreQueryTools: false })?.familyEnabled("drafts"));
});

test("phiên mở LƯỜI: chưa gọi model()/command() thì chưa mở gì; mở đúng một lần mỗi mặt; close() dọn", async () => {
  const { turn } = rig("core,drafts");
  assert.equal(turn!.opened, 0);
  await Promise.all([turn!.model(), turn!.model()]);
  assert.equal(turn!.opened, 1);
  await turn!.command();
  assert.equal(turn!.opened, 2);
  await turn!.close();
  assert.equal(turn!.modelHasTool("query_records"), false);
});

test("hai mặt tách bằng cấu trúc: model có đọc + propose_*, không confirm_draft; command chỉ có confirm_draft / cancel_draft", async () => {
  const { turn } = rig("core,drafts");
  try {
    const model = (await turn!.model())!;
    const command = (await turn!.command())!;
    assert.deepEqual([...model.toolNames].sort(), ["describe_entities", "propose_contact_update", "propose_group_update", "propose_reply_template_save", "query_records"]);
    assert.deepEqual([...command.toolNames].sort(), ["cancel_draft", "confirm_draft"]);
    // Mô hình gọi thẳng confirm_draft vào máy chủ của mình: không có công cụ này — lỗi, không chạm DB
    await assert.rejects(turn!.callTool("assistant_model", "confirm_draft", { code: "ABCDEF" }), /not found/i);
    assert.equal(turn!.modelHasTool("confirm_draft"), false);
  } finally {
    await turn!.close();
  }
});

test("Nhân viên (không ghi qua AI) và hỏi trong nhóm: không có propose_*; cổng /mcp ngoài không đổi", async () => {
  for (const options of [{ asker: access(staff()) }, { groupScopeId: 11 }]) {
    const { turn } = rig("core,drafts", options);
    try {
      assert.deepEqual([...(await turn!.model())!.toolNames].sort(), ["describe_entities", "query_records"]);
      assert.equal((await turn!.command())!.toolNames.size, 0, "không ghi được ⇒ không có lệnh nháp");
    } finally {
      await turn!.close();
    }
  }
  const http = toolsFor(access(manager()), "mcp_http").map((tool) => tool.name);
  assert.ok(!http.includes("confirm_draft") && !http.includes("cancel_draft"));
  assert.equal(new Set(toolsFor(access(manager()), "mcp_http").map((tool) => tool.name)).size, http.length);
  assert.ok(ALL_TOOLS.filter((tool) => tool.surfaces?.includes("assistant_model")).every((tool) => tool.family === "core"));
});

test("describe_entities qua cặp InMemoryTransport = gọi thẳng lõi; ghi mcp_call_log nguồn Assistant, không khóa", async () => {
  const logs: McpCallLogEntry[] = [];
  const gate = new ConcurrencyGate(5, 50);
  const base = access(manager());
  const turn = new AssistantMcpTurn(base, new Set(["core"]), { gate, families: new Set(["core"]), logCall: async (entry) => { logs.push(entry); } });
  try {
    const direct = await runCoreToolDefinition(ALL_TOOLS.find((tool) => tool.name === "describe_entities")!, base, { entity: "tasks" });
    const viaMcp = await turn.callTool("assistant_model", "describe_entities", { entity: "tasks" });
    assert.ok(!viaMcp.isError);
    assert.deepEqual(viaMcp.structuredContent, direct.structured);
    assert.equal(logs.length, 1);
    assert.deepEqual([logs[0].tool, logs[0].source, logs[0].keyId, logs[0].status], ["describe_entities", McpCallSource.Assistant, null, McpCallStatus.Ok]);
  } finally {
    await turn.close();
  }
});

test("lỗi nghiệp vụ mang _meta lỗi có cấu trúc; bộ chuyển dựng {error:{code,message}} cho mô hình (hoặc chữ với công cụ cũ)", async () => {
  const logs: McpCallLogEntry[] = [];
  const turn = new AssistantMcpTurn(access(manager()), new Set(["core"]), { gate: new ConcurrencyGate(5, 50), families: new Set(["core"]), logCall: async (entry) => { logs.push(entry); } });
  try {
    const result = await turn.callTool("assistant_model", "query_records", { entity: "tasks", filters: [{ field: "khong_co", op: "eq", value: "x" }] });
    assert.equal(result.isError, true);
    assert.equal((result._meta as Record<string, { code: string }>)["bot-tro-ly/error"].code, "invalid_field");
    const sink = { filesToSend: [] as number[] };
    const mapped = mapCallToolResult(sink, result) as { error: { code: string; message: string } };
    assert.equal(mapped.error.code, "invalid_field");
    assert.deepEqual(mapCallToolResult(sink, result, "string"), { error: mapped.error.message });
    assert.equal(logs[0].status, McpCallStatus.Invalid);
  } finally {
    await turn.close();
  }
});

test("hỏi trong nhóm: query_records thực thể ngoài nhóm bị LÕI chặn forbidden (không chỉ bộ chuyển)", async () => {
  const { turn } = rig("core", { groupScopeId: 11 });
  try {
    const result = await turn!.callTool("assistant_model", "query_records", { entity: "tasks" });
    assert.equal(result.isError, true);
    assert.equal((result._meta as Record<string, { code: string }>)["bot-tro-ly/error"].code, "forbidden");
    const noEntity = await turn!.callTool("assistant_model", "describe_entities", {});
    assert.equal((noEntity._meta as Record<string, { code: string }>)["bot-tro-ly/error"].code, "forbidden");
  } finally {
    await turn!.close();
  }
});

test("_meta.turn: mặt trợ lý phát tác động của công cụ, bộ chuyển tách ra; mặt mcp_http KHÔNG BAO GIỜ có _meta", async () => {
  const tool: AnyToolDefinition = eraseTool({
    name: "effect_probe", title: "probe", description: "thử", input: () => z.object({}).strict(), output: z.object({ ok: z.boolean() }),
    annotations: { readOnlyHint: true, openWorldHint: false }, family: "core", surfaces: ["assistant_model", "mcp_http"], available: () => true,
    handler: async () => ({ structured: { ok: true }, summary: "ok", rowCount: 0, effects: { fixedReply: "Câu dựng sẵn", filesToSend: [3, 3] } }),
  });
  const turn = new AssistantMcpTurn(access(manager()), new Set(["core"]), {
    gate: new ConcurrencyGate(5, 50), families: new Set(["core"]), logCall: async () => undefined, catalog: [tool],
  });
  try {
    const result = await turn.callTool("assistant_model", "effect_probe", {});
    const sink = { filesToSend: [] as number[], fixedReply: undefined as string | undefined };
    assert.deepEqual(mapCallToolResult(sink, result), { ok: true }, "phần trả mô hình không chứa tác động");
    assert.equal(sink.fixedReply, "Câu dựng sẵn");
    assert.deepEqual(sink.filesToSend, [3]);
  } finally {
    await turn.close();
  }
  const { runTool } = await import("../../data-access/tool-runner.js");
  const { toCallToolResult } = await import("../../mcp/mcp-tool-result.js");
  const outcome = await runTool(tool, access(manager()), {});
  assert.ok(outcome.effects, "lõi có tác động");
  assert.equal(toCallToolResult(outcome, false)._meta, undefined, "cổng ngoài không chở _meta");
});

test("cổng đồng thời RIÊNG: đầy ⇒ server_busy cho trợ lý, cổng khác không bị chiếm", async () => {
  const assistantGate = new ConcurrencyGate(1, 20);
  const externalGate = new ConcurrencyGate(1, 20);
  const turn = new AssistantMcpTurn(access(manager()), new Set(["core"]), { gate: assistantGate, families: new Set(["core"]), logCall: async () => undefined });
  const held = await assistantGate.acquire();
  assert.ok(held.ok);
  try {
    const busy = await turn.callTool("assistant_model", "describe_entities", { entity: "tasks" });
    assert.equal(busy.isError, true);
    assert.equal((busy._meta as Record<string, { code: string }>)["bot-tro-ly/error"].code, "server_busy");
    assert.equal(externalGate.inFlight, 0);
    const other = await externalGate.acquire();
    assert.ok(other.ok, "cổng MCP ngoài còn chỗ");
    if (other.ok) other.release();
    held.release();
    assert.ok(!(await turn.callTool("assistant_model", "describe_entities", { entity: "tasks" })).isError);
    assert.equal(assistantGate.inFlight, 0, "chỗ trả lại sau mỗi lời gọi");
  } finally {
    held.release();
    await turn.close();
  }
});

test("khai báo dựng từ tools/list KHỚP khai báo cũ của công cụ đã ở lõi (Quản lý / Nhân viên × tin riêng / trong nhóm)", async () => {
  for (const principal of [manager(), staff()]) {
    for (const groupScopeId of [undefined, 11]) {
      const asker = access(principal);
      const { turn } = rig("core", { asker, groupScopeId });
      try {
        const mcp = (await loadMcpTurnTools(turn, coreToolOptions(groupScopeId)))!;
        const legacy = [...coreToolDeclarations(asker, coreToolOptions(groupScopeId)), ...writeToolDeclarations(asker, groupScopeId)];
        const byName = (list: { name: string }[]) => Object.fromEntries(list.map((item) => [item.name, item]));
        assert.deepEqual(byName(mcp.declarations.filter((d) => legacy.some((l) => l.name === d.name))), byName(legacy), `${principal.role} nhóm=${groupScopeId}`);
        assert.deepEqual(mcp.declarations.map((d) => d.name).sort(), legacy.map((d) => d.name).sort());
      } finally {
        await turn!.close();
      }
    }
  }
});

test("bộ chuyển: mọi công cụ lõi hiện có qua bộ làm sạch không lỗi (anyOf null gập thành nullable)", async () => {
  const asker = access(manager());
  const { turn } = rig("core");
  try {
    const listed = (await turn!.model())!.tools;
    const declarations = toFunctionDeclarationsFromMcp(listed);
    assert.equal(declarations.length, listed.length, "không công cụ nào bị bỏ vì sơ đồ hỏng");
    assert.ok(!JSON.stringify(declarations).includes("\"anyOf\""));
    assert.ok(!JSON.stringify(declarations).includes("\"null\""));
    assert.ok(asker);
  } finally {
    await turn!.close();
  }
});
