import assert from "node:assert/strict";
import { test } from "node:test";
import { sendFamilyCatalog } from "../catalog/send-family-tools.js";
import type { DataAccessContext } from "../data-access-context.js";
import type { ContactActor } from "../actors/contact-actor.js";
import { registerSendTurn, recordResolvedSendContext } from "../../send-commands/send-turn-registry.js";
import { ContactRole } from "../../constants.js";

// Bề mặt của họ `send` (không cần DB): không công cụ nào lên cổng /mcp ngoài (quyết định 9), công cụ mô hình không có xác nhận / lệnh, và `available` đòi chủ thể + sổ lượt.

const tools = sendFamilyCatalog.tools;
const byName = (name: string) => tools.find((tool) => tool.name === name)!;
const MODEL = ["propose_send_message", "propose_group_reminder"];

test("mọi công cụ họ send chỉ ở mặt trợ lý, có khai họ; mặt mô hình chỉ có hai công cụ đề xuất", () => {
  for (const tool of tools) {
    assert.equal(tool.family, "send", tool.name);
    assert.ok(tool.surfaces && !tool.surfaces.includes("mcp_http"), `${tool.name} lộ ra mcp_http`);
  }
  assert.deepEqual(tools.filter((tool) => tool.surfaces!.includes("assistant_model")).map((tool) => tool.name).sort(), [...MODEL].sort());
  assert.ok(MODEL.every((name) => byName(name).blocksAfterFixedReply === true && byName(name).assistantErrorShape === "string"));
});

test("available: không chủ thể liên hệ → ẩn hết; có đăng ký nhưng chưa phân giải / người hỏi không đủ quyền → công cụ mô hình ẩn, công cụ lệnh hiện", () => {
  const bare = { } as DataAccessContext;
  for (const tool of tools) assert.equal(tool.available(bare), false, `${tool.name} không được hiện khi thiếu chủ thể`);
  const actor = { contactId: 1, uid: "u", name: "n", contactRole: 0, groupId: null } as unknown as ContactActor;
  const ctx = { contactActor: actor } as DataAccessContext;
  registerSendTurn(actor, { question: "gửi nhóm A: hi", deps: { calendar: {} as never } });
  assert.ok(byName("send_draft_create").available(ctx) && byName("send_context").available(ctx));
  assert.equal(byName("propose_send_message").available(ctx), false, "chưa phân giải send_context");
  recordResolvedSendContext(actor, { zaloThread: true, requester: null });
  assert.equal(byName("propose_send_message").available(ctx), false, "không đủ quyền");
  recordResolvedSendContext(actor, { zaloThread: true, requester: { uid: "u", name: "n", role: ContactRole.Manager, recipientId: null } });
  assert.ok(MODEL.every((name) => byName(name).available(ctx)));
  assert.equal(byName("propose_send_message").available({ contactActor: { ...actor, groupId: 5 } } as DataAccessContext), false, "hỏi trong nhóm thì ẩn");
});

test("lời nhắc của họ chỉ mang hai lời nhắc của công cụ lên máy chủ (gửi, nhắc hẹn); ghim / lời mời họp / bản tin ở lại system prompt", () => {
  for (const marker of ["propose_send_message", "propose_group_reminder"]) assert.ok(sendFamilyCatalog.instructions.includes(marker), marker);
  for (const marker of ["propose_group_pin", "propose_meeting_announcement", "send_brief"]) assert.ok(!sendFamilyCatalog.instructions.includes(marker), marker);
  assert.deepEqual(sendFamilyCatalog.actions, []);
});
