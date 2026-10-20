import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallSource } from "../../constants.js";
import { buildDataAccessContext } from "../../data-access/data-access-context.js";
import { admin, fakeDb, manager, NOW } from "../../data-access/data-access-test-support.js";
import { UNTRUSTED_NOTICE } from "../../data-access/tool-definition.js";
import { toolsFor } from "../../data-access/read-tool-catalog.js";
import type { z } from "zod/v4";
import type { Principal } from "../../auth/principal.js";
import { ConcurrencyGate } from "../../mcp/mcp-concurrency-gate.js";
import { sanitizeForGemini } from "../gemini-schema-sanitizer.js";
import { TOOL_DECLARATIONS } from "../tools.js";
import type { AskerAccess } from "../infra/asker-access.js";
import type { ContactActor } from "../../data-access/actors/contact-actor.js";
import type { AssistantMcpBridge } from "./assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "./assistant-mcp-families.js";
import { openMcpTurn } from "./open-mcp-turn.js";
import { applyMcpTurnPrompt, loadMcpTurnTools } from "./turn-tool-declarations.js";
import { SUGGEST_REPLIES_PROMPT } from "../../reply-suggestions/reply-suggestion-tool.js";

// Họ `files` (phase 7): khai báo `search_files` cho mô hình dựng từ `tools/list` KHỚP từng chữ khai báo cũ (T3); công cụ lệnh không lộ cho mô hình;
// cổng /mcp ngoài có `search_files` (dặn dữ liệu không đáng tin) nhưng không có công cụ lệnh. Không DB thật.

const actor = { contactId: 1, uid: "u-1" } as ContactActor;
const access = (principal: Principal): AskerAccess => ({
  ...buildDataAccessContext({ db: fakeDb().db, principal, maskPersonal: false, source: McpCallSource.Assistant, now: NOW, ownDirectThreadsOnly: true, ownDirectUid: "u-1", contactActor: actor }),
  origin: "web_user",
});

const rig = (principal: Principal, groupScopeId?: number) => {
  const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("files"), gate: new ConcurrencyGate(5, 50) };
  return openMcpTurn(access(principal), bridge, { groupScopeId, coreQueryTools: true })!;
};

const COMMAND_TOOLS = ["file_read_prepare", "file_send_check", "file_text_store", "link_shared_check", "reply_sources"];

test("khai báo search_files dựng từ tools/list KHỚP khai báo cũ (tên, mô tả, sơ đồ tham số)", async () => {
  const turn = rig(manager());
  try {
    const mcp = (await loadMcpTurnTools(turn, {}))!;
    assert.deepEqual(mcp.declarations.map((tool) => tool.name), ["search_files"]);
    const old = TOOL_DECLARATIONS.find((tool) => tool.name === "search_files")!;
    const fresh = mcp.declarations[0];
    assert.equal(fresh.description, old.description);
    assert.deepEqual(fresh.parameters, sanitizeForGemini(old.parameters));
    assert.equal(turn.errorShapeOf("search_files"), "string");
    assert.equal(turn.familyOfTool("search_files"), "files");
  } finally {
    await turn.close();
  }
});

test("mặt mô hình chỉ có search_files; năm công cụ lệnh ở mặt lệnh (reply_sources ẩn khi hỏi trong nhóm); mô hình không có đường tới lệnh", async () => {
  const turn = rig(manager());
  try {
    assert.deepEqual([...(await turn.model())!.toolNames], ["search_files"]);
    assert.deepEqual([...(await turn.command())!.toolNames].sort(), COMMAND_TOOLS);
    await assert.rejects(turn.callTool("assistant_model", "file_text_store", { attachment_id: 1, method: "text", text: "x", summary: "", input_tokens: 0, output_tokens: 0 }), /not found/i);
  } finally {
    await turn.close();
  }
  const group = rig(manager({ groupIds: [11] }), 11);
  try {
    assert.deepEqual([...(await group.command())!.toolNames].sort(), COMMAND_TOOLS.filter((name) => name !== "reply_sources"));
  } finally {
    await group.close();
  }
});

test("lời nhắc họ: lời nhắc suggest_replies cũ được thay bằng instructions của máy chủ (cùng chữ, không lặp)", async () => {
  const turn = rig(manager());
  try {
    const mcp = (await loadMcpTurnTools(turn, {}))!;
    assert.equal(mcp.instructions, SUGGEST_REPLIES_PROMPT);
    const system = `đầu\n${SUGGEST_REPLIES_PROMPT}\ncuối`;
    assert.equal(applyMcpTurnPrompt(system, mcp).split(SUGGEST_REPLIES_PROMPT).length - 1, 1);
  } finally {
    await turn.close();
  }
});

test("cổng /mcp ngoài: có search_files (dặn dữ liệu không đáng tin + untrusted_fields), không có công cụ lệnh; chỉ một search_files", () => {
  const external = toolsFor(buildDataAccessContext({ db: fakeDb().db, principal: admin(), maskPersonal: false, source: McpCallSource.Http, now: NOW }), "mcp_http");
  const names = external.map((tool) => tool.name);
  for (const name of COMMAND_TOOLS) assert.ok(!names.includes(name), `${name} không được lộ ra cổng ngoài`);
  assert.equal(names.filter((name) => name === "search_files").length, 1);
  const tool = external.find((item) => item.name === "search_files")!;
  assert.ok(tool.description.includes(UNTRUSTED_NOTICE));
  assert.ok(Object.keys((tool.output as unknown as z.ZodObject).shape).includes("untrusted_fields"));
});
