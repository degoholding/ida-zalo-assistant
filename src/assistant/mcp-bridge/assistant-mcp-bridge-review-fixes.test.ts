import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod/v4";
import { McpCallSource } from "../../constants.js";
import { buildDataAccessContext } from "../../data-access/data-access-context.js";
import { fakeDb, manager, staff, NOW } from "../../data-access/data-access-test-support.js";
import type { AnyToolDefinition, AssistantFamily } from "../../data-access/tool-definition.js";
import { eraseTool } from "../../data-access/tool-definition.js";
import { ConcurrencyGate } from "../../mcp/mcp-concurrency-gate.js";
import type { Principal } from "../../auth/principal.js";
import { withCommandSession } from "../../send-commands/send-command-session.js";
import type { AskerAccess } from "../infra/asker-access.js";
import { applyMcpTurnPrompt, applyMcpTurnTools, loadMcpTurnTools } from "./turn-tool-declarations.js";
import { mapCallToolResult } from "./mcp-call-result-mapper.js";
import { mcpExecutorFor } from "./mcp-tool-router.js";
import { AssistantMcpTurn, OUTCOME_UNKNOWN_CODE } from "./assistant-mcp-turn.js";
import { parseMcpFamilies } from "./assistant-mcp-families.js";
import { openMcpTurn } from "./open-mcp-turn.js";
import type { ToolContext } from "../tools.js";

// Sửa theo review khu vực 2 (cầu nối): hạn chờ + «chưa rõ kết quả» (H3), không rơi về executor cũ (M2), tra tên không ghi đè bởi bản mcp_http (M3),
// lời nhắc chỉ của họ có công cụ thật sự (H1), cảnh báo họ lạ một lần (L4). Không DB thật.

const access = (principal: Principal): AskerAccess => ({
  ...buildDataAccessContext({ db: fakeDb().db, principal, maskPersonal: false, source: McpCallSource.Assistant, now: NOW, ownDirectThreadsOnly: true, ownDirectUid: "u-1" }),
  origin: "web_user",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const probe = (name: string, options: { readOnly: boolean; surfaces: AnyToolDefinition["surfaces"]; family?: AssistantFamily; ms?: number }): AnyToolDefinition => eraseTool({
  name, title: name, description: "thử", input: () => z.object({}).strict(), output: z.object({ ok: z.boolean() }),
  annotations: { readOnlyHint: options.readOnly, openWorldHint: false }, family: options.family, surfaces: options.surfaces, available: () => true,
  handler: async () => { await sleep(options.ms ?? 0); return { structured: { ok: true }, summary: "ok", rowCount: 0 }; },
});

function turnWith(catalog: AnyToolDefinition[], families: AssistantFamily[], callTimeoutMs?: number, principal: Principal = manager()): AssistantMcpTurn {
  return new AssistantMcpTurn(access(principal), new Set(families), { gate: new ConcurrencyGate(5, 50), families: new Set(families), logCall: async () => undefined, catalog }, { callTimeoutMs });
}

test("H3: công cụ GHI chậm quá hạn phía client → «chưa rõ kết quả — đừng thử lại», KHÔNG ném; công cụ ĐỌC chậm thì ném", async () => {
  const turn = turnWith([
    probe("slow_write", { readOnly: false, surfaces: ["assistant_model"], family: "tasks", ms: 400 }),
    probe("slow_read", { readOnly: true, surfaces: ["assistant_model"], family: "tasks", ms: 400 }),
  ], ["tasks"], 60);
  try {
    const result = await turn.callTool("assistant_model", "slow_write", {});
    assert.equal(result.isError, true);
    assert.equal((result._meta as Record<string, { code: string }>)["bot-tro-ly/error"].code, OUTCOME_UNKNOWN_CODE);
    const mapped = mapCallToolResult({ filesToSend: [] }, result, "string") as { error: string };
    assert.match(mapped.error, /Chưa rõ kết quả/);
    assert.match(mapped.error, /đừng thử lại/);
    await assert.rejects(turn.callTool("assistant_model", "slow_read", {}), /timed out|timeout/i);
  } finally {
    await turn.close();
  }
});

test("H3: hạn chờ mặc định lớn hơn thời gian chờ cổng (không còn mặc định 60s của SDK không liên quan tới cổng)", () => {
  const gate = new ConcurrencyGate(5, 20_000);
  assert.equal(gate.maxWaitMs, 20_000);
  const turn = new AssistantMcpTurn(access(manager()), new Set(["core"]), { gate, families: new Set(["core"]), logCall: async () => undefined });
  assert.ok((turn as unknown as { callTimeoutMs: number }).callTimeoutMs > 20_000 + 60_000);
});

test("H3: lệnh gõ ghi quá hạn (withCommandSession) trả câu «chưa rõ kết quả» thay vì ném — nơi gọi / việc nền không thử lại", async () => {
  const turn = turnWith([probe("slow_cmd", { readOnly: false, surfaces: ["assistant_command"], family: "send", ms: 400 })], ["send"], 60);
  try {
    const via = await withCommandSession({ mcp: async () => turn }, ["slow_cmd"], (call) => call("slow_cmd", {}));
    assert.ok(via);
    assert.match(String(via.value.reply), /đừng thử lại/);
    assert.equal(via.value.outcome_unknown, true);
  } finally {
    await turn.close();
  }
});

test("M3: tra tên chỉ theo công cụ có mặt trợ lý — bản trùng tên của mcp_http (xếp sau) không ghi đè họ / hình lỗi", () => {
  const assistantSide = eraseTool({ ...probe("dup_tool", { readOnly: true, surfaces: ["assistant_model"], family: "reads" }), assistantErrorShape: "string" as const });
  const httpSide = probe("dup_tool", { readOnly: true, surfaces: ["mcp_http"] });
  for (const catalog of [[assistantSide, httpSide], [httpSide, assistantSide]]) {
    const turn = turnWith(catalog, ["reads"]);
    assert.equal(turn.familyOfTool("dup_tool"), "reads");
    assert.equal(turn.errorShapeOf("dup_tool"), "string");
  }
  assert.equal(turnWith([httpSide], ["reads"]).familyOfTool("dup_tool"), undefined, "công cụ chỉ ở mcp_http không có họ trợ lý");
});

test("M2: họ alerts bật + phiên mở: tên cũ confirm_alert_change KHÔNG rơi về executor cũ (lỗi «không có công cụ»); họ tắt thì để đường cũ", async () => {
  const on = openMcpTurn(access(manager()), { families: () => parseMcpFamilies("alerts"), gate: new ConcurrencyGate(5, 50) })!;
  try {
    const ctx = { mcp: on, filesToSend: [] } as unknown as ToolContext;
    assert.equal(mcpExecutorFor(ctx, "confirm_alert_change"), undefined, "phiên chưa mở ⇒ đường cũ (T2)");
    await on.model();
    const executor = mcpExecutorFor(ctx, "confirm_alert_change");
    assert.ok(executor, "phiên đã mở ⇒ bộ định tuyến nhận tên của họ");
    assert.deepEqual(await executor(ctx, {}), { error: "Không có công cụ confirm_alert_change" });
    assert.equal(mcpExecutorFor(ctx, "ten_cua_cong_cu_khac"), undefined);
  } finally {
    await on.close();
  }
  const off = openMcpTurn(access(manager()), { families: () => parseMcpFamilies("tickets"), gate: new ConcurrencyGate(5, 50) })!;
  try {
    await off.model();
    assert.equal(mcpExecutorFor({ mcp: off, filesToSend: [] } as unknown as ToolContext, "confirm_alert_change"), undefined);
  } finally {
    await off.close();
  }
});

test("M2: công cụ của họ bật bị ẨN cho người hỏi (Nhân viên không có propose_*) → khai báo cũ bị gỡ + executor báo không có; không rơi về executor cũ", async () => {
  const turn = openMcpTurn(access(staff()), { families: () => parseMcpFamilies("core,drafts"), gate: new ConcurrencyGate(5, 50) }, { coreQueryTools: true })!;
  try {
    const mcp = (await loadMcpTurnTools(turn, {}))!;
    assert.ok(mcp, "phiên mở được dù người hỏi không có công cụ ghi");
    const base = [{ name: "propose_contact_update", description: "cũ", parameters: { type: "object", properties: {} } }, { name: "web_search", description: "giữ", parameters: { type: "object", properties: {} } }];
    assert.deepEqual(applyMcpTurnTools(base as never, mcp).map((d) => d.name).filter((n) => !["describe_entities", "query_records"].includes(n)), ["web_search"]);
    const ctx = { mcp: turn, filesToSend: [] } as unknown as ToolContext;
    assert.deepEqual(await mcpExecutorFor(ctx, "propose_contact_update")!(ctx, {}), { error: "Không có công cụ propose_contact_update" });
  } finally {
    await turn.close();
  }
});

test("H1: lời nhắc chỉ của họ có công cụ trong khai báo CUỐI (nhóm: không gửi / số liệu / cảnh báo / gợi ý; Nhân viên tin riêng: không gửi)", async () => {
  const turn = openMcpTurn(access(manager()), { families: () => parseMcpFamilies("all"), gate: new ConcurrencyGate(5, 50) }, { coreQueryTools: true })!;
  try {
    const mcp = (await loadMcpTurnTools(turn, {}))!;
    const everything = new Set([...mcp.names, "suggest_replies"]);
    const all = applyMcpTurnPrompt("đầu", mcp, everything);
    for (const marker of ["query_metrics", "suggest_replies", "query_records, describe_entities"]) assert.ok(all.includes(marker), `tin riêng thiếu ${marker}`);
    // gửi / cảnh báo cần ngữ cảnh lượt (sổ gửi, alertRuntime) — người hỏi không có thì máy chủ không đăng ký ⇒ không lời nhắc (đây là ca «Nhân viên / không đủ quyền»)
    for (const marker of ["propose_send_message", "propose_alert_change"]) assert.ok(!all.includes(marker), `${marker} xuất hiện dù công cụ không đăng ký`);
    // hỏi trong nhóm: chỉ còn công cụ trong GROUP_SCOPE_TOOL_NAMES — mô phỏng bằng bỏ công cụ gửi / số liệu / cảnh báo / gợi ý khỏi khai báo cuối
    const group = new Set([...everything].filter((name) => !/query_metrics|suggest_replies/.test(name)));
    const inGroup = applyMcpTurnPrompt("đầu", mcp, group);
    for (const marker of ["query_metrics", "suggest_replies"]) assert.ok(!inGroup.includes(marker), `nhóm lại có ${marker}`);
    assert.ok(inGroup.includes("query_records, describe_entities"), "họ core vẫn có công cụ trong nhóm");
  } finally {
    await turn.close();
  }
});

test("H1: họ bật nhưng KHÔNG công cụ nào trong khai báo cuối thì lời nhắc cũ của nó cũng gỡ, lời nhắc mới không thêm (không nhắc công cụ không có)", async () => {
  const turn = openMcpTurn(access(staff()), { families: () => parseMcpFamilies("alerts,send,metrics"), gate: new ConcurrencyGate(5, 50) })!;
  try {
    const mcp = (await loadMcpTurnTools(turn, {}))!;
    const legacy = "CẢNH BÁO TIN NHẮN (người hỏi là quản lý / người nhận báo):\n- cũ";
    const result = applyMcpTurnPrompt(`đầu\n${legacy}\ncuối`, mcp, new Set(["web_search"]));
    assert.ok(!result.includes("propose_alert_change") && !result.includes("propose_send_message") && !result.includes("query_metrics"));
    assert.ok(result.includes("đầu") && result.includes("cuối"));
  } finally {
    await turn.close();
  }
});

test("L4: họ lạ chỉ cảnh báo MỘT lần mỗi giá trị (parseMcpFamilies chạy mỗi lượt)", (context) => {
  const warn = context.mock.method(console, "error", () => undefined);
  for (let i = 0; i < 5; i += 1) parseMcpFamilies("core,ho_la_review_l4");
  const lines = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("ho_la_review_l4"));
  assert.equal(lines.length, 1);
  parseMcpFamilies("ho_la_khac_l4");
  assert.equal(warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("ho_la_khac_l4")).length, 1);
});
