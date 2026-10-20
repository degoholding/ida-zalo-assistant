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
import { LIST_CONTACTS_DECLARATION } from "../contact-directory-tool.js";
import { sanitizeForGemini } from "../gemini-schema-sanitizer.js";
import { SEARCH_MESSAGES_DECLARATION } from "../search-messages-tool.js";
import { TOOL_DECLARATIONS } from "../tools.js";
import type { AskerAccess } from "../infra/asker-access.js";
import type { AssistantMcpBridge } from "./assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "./assistant-mcp-families.js";
import { openMcpTurn } from "./open-mcp-turn.js";
import { loadMcpTurnTools } from "./turn-tool-declarations.js";

// Họ `reads` (phase 6): khai báo cho mô hình dựng từ `tools/list` KHỚP từng chữ khai báo cũ (T3); hai mặt + trong nhóm tách bằng cấu trúc;
// cổng /mcp ngoài có thêm hai công cụ mới nhưng KHÔNG thấy công cụ riêng của trợ lý. Không DB thật.

const access = (principal: Principal, overrides: Partial<AskerAccess> = {}): AskerAccess => ({
  ...buildDataAccessContext({ db: fakeDb().db, principal, maskPersonal: false, source: McpCallSource.Assistant, now: NOW, ownDirectThreadsOnly: true, ownDirectUid: "u-1" }),
  origin: "web_user", ...overrides,
});

const rig = (principal: Principal, groupScopeId?: number) => {
  const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("reads"), gate: new ConcurrencyGate(5, 50) };
  return openMcpTurn(access(principal), bridge, { groupScopeId, coreQueryTools: true })!;
};

const LEGACY_MODEL_NAMES = ["list_groups", "get_group_messages", "find_people", "get_conversation_with_person", "list_contacts", "search_messages"];

test("khai báo họ reads dựng từ tools/list KHỚP khai báo cũ (tên, mô tả, sơ đồ tham số)", async () => {
  const turn = rig(manager());
  try {
    const mcp = (await loadMcpTurnTools(turn, {}))!;
    const legacy = [...TOOL_DECLARATIONS.filter((tool) => LEGACY_MODEL_NAMES.includes(tool.name)), LIST_CONTACTS_DECLARATION, SEARCH_MESSAGES_DECLARATION];
    assert.deepEqual(mcp.declarations.map((tool) => tool.name).sort(), [...LEGACY_MODEL_NAMES].sort());
    for (const old of legacy) {
      const fresh = mcp.declarations.find((tool) => tool.name === old.name)!;
      assert.equal(fresh.description, old.description, `${old.name}: mô tả`);
      assert.deepEqual(fresh.parameters, sanitizeForGemini(old.parameters), `${old.name}: tham số`);
    }
  } finally {
    await turn.close();
  }
});

test("mặt model: sáu công cụ; mặt lệnh: không có group_context khi không hỏi trong nhóm", async () => {
  const turn = rig(manager());
  try {
    assert.deepEqual([...(await turn.model())!.toolNames].sort(), [...LEGACY_MODEL_NAMES].sort());
    assert.equal((await turn.command())!.toolNames.size, 0);
    assert.equal(turn.errorShapeOf("find_people"), "string");
    assert.equal(turn.familyOfTool("search_messages"), "reads");
  } finally {
    await turn.close();
  }
});

test("hỏi trong nhóm: Danh bạ / người ẩn ở LÕI (chỉ list_groups, get_group_messages, search_messages); group_context chỉ ở mặt lệnh", async () => {
  const turn = rig(manager({ groupIds: [11] }), 11);
  try {
    assert.deepEqual([...(await turn.model())!.toolNames].sort(), ["get_group_messages", "list_groups", "search_messages"]);
    assert.deepEqual([...(await turn.command())!.toolNames], ["group_context"]);
    await assert.rejects(turn.callTool("assistant_model", "find_people", { name: "Lan" }), /not found/i);
    await assert.rejects(turn.callTool("assistant_model", "group_context", {}), /not found/i, "mô hình không có đường tới lệnh nhóm");
  } finally {
    await turn.close();
  }
});

test("cổng /mcp ngoài: có find_people / get_conversation_with_person mới, không có công cụ riêng của trợ lý", () => {
  const names = toolsFor(buildDataAccessContext({ db: fakeDb().db, principal: admin(), maskPersonal: false, source: McpCallSource.Http, now: NOW }), "mcp_http").map((tool) => tool.name);
  assert.ok(names.includes("find_people") && names.includes("get_conversation_with_person"));
  assert.ok(!names.includes("list_groups") && !names.includes("list_contacts") && !names.includes("get_group_messages") && !names.includes("group_context"));
  assert.equal(names.filter((name) => name === "search_messages").length, 1, "chỉ bản search_messages của cổng ngoài");
});

test("cổng /mcp ngoài: find_people / get_conversation_with_person có dặn dữ liệu không đáng tin + untrusted_fields; bản mô hình giữ chữ cũ", async () => {
  const external = toolsFor(buildDataAccessContext({ db: fakeDb().db, principal: admin(), maskPersonal: false, source: McpCallSource.Http, now: NOW }), "mcp_http");
  for (const [name, field] of [["find_people", "groups"], ["get_conversation_with_person", "messages"]]) {
    const tool = external.find((item) => item.name === name)!;
    assert.ok(tool.description.includes(UNTRUSTED_NOTICE), `${name}: thiếu UNTRUSTED_NOTICE ở cổng ngoài`);
    assert.ok(Object.keys((tool.output as unknown as z.ZodObject).shape).includes("untrusted_fields"), `${name}: output thiếu untrusted_fields`);
    assert.ok(field);
  }
  const turn = rig(manager());
  try {
    const mcp = (await loadMcpTurnTools(turn, {}))!;
    for (const name of ["find_people", "get_conversation_with_person"]) {
      assert.ok(!mcp.declarations.find((tool) => tool.name === name)!.description.includes(UNTRUSTED_NOTICE), `${name}: mô hình phải giữ chữ cũ`);
    }
    assert.equal(turn.errorShapeOf("find_people"), "string", "tra cứu theo tên lấy bản mô hình");
  } finally {
    await turn.close();
  }
});

test("bật che: tìm dãy ≥ 9 số bị từ chối invalid_value TRƯỚC khi chạm DB (BC2); thiếu query báo lỗi chữ như cũ", async () => {
  const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("reads"), gate: new ConcurrencyGate(5, 50) };
  const { db, queries } = fakeDb();
  const masked = { ...access(manager()), db, maskPersonal: true };
  const turn = openMcpTurn(masked, bridge, { coreQueryTools: true })!;
  try {
    const probe = await turn.callTool("assistant_model", "search_messages", { query: "0912345678" });
    assert.equal(probe.isError, true);
    assert.equal((probe._meta as Record<string, { code: string }>)["bot-tro-ly/error"].code, "invalid_value");
    const empty = await turn.callTool("assistant_model", "search_messages", {});
    assert.match(String((empty._meta as Record<string, { message: string }>)["bot-tro-ly/error"].message), /mentions_me/);
    assert.deepEqual(queries.filter((query) => !/mcp_call_log/.test(query.sql)), [], "không câu SQL dữ liệu nào chạy (chỉ nhật ký gọi)");
  } finally {
    await turn.close();
  }
});
