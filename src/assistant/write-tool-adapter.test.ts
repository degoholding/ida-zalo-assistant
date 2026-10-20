import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallSource } from "../constants.js";
import { admin, fakeDb, makeCtx, manager, staff } from "../data-access/data-access-test-support.js";
import type { AskerAccess, AskerOrigin } from "./infra/asker-access.js";
import { buildCoreQueryTools } from "./core-tools-wiring.js";
import { WRITE_TOOLS_PROMPT } from "./core-tools-prompt.js";
import { findExecutor } from "./tool-registry.js";
import type { ToolContext } from "./tools.js";
import { assistantWriteAccess, formatDraftPreviewReply, runWriteTool, writeToolDeclarations } from "./write-tool-adapter.js";
import { parseWriteCodeCommand } from "./write-confirm-chat.js";
import { parseChatCommand } from "./chat-commands.js";

// Bộ chuyển công cụ ghi cho trợ lý: điều kiện mở (tài khoản web + tin riêng thật + không trong nhóm + vai trò Quản trị / Quản lý), danh sách
// công cụ (chỉ propose_*, KHÔNG có xác nhận — D1), cách đọc «đồng ý <mã>».

function access(principal = manager(), origin: AskerOrigin = "web_user", overrides: Partial<AskerAccess> = {}): AskerAccess {
  return { ...makeCtx(principal, { source: McpCallSource.Assistant, keyId: null, ownDirectUid: "u-asker", ownDirectThreadsOnly: true }), origin, ...overrides };
}

test("assistantWriteAccess: chỉ tài khoản web, tin riêng thật, vai trò Quản trị / Quản lý; trong nhóm / suy ra / mô phỏng web / không userId / Nhân viên → null", () => {
  assert.equal(assistantWriteAccess(access(), undefined)?.allowWrite, true);
  assert.equal(assistantWriteAccess(access(admin({ userId: 3 })), undefined)?.allowWrite, true);
  assert.equal(assistantWriteAccess(access(), 12), null, "hỏi trong nhóm");
  assert.equal(assistantWriteAccess(access(manager(), "derived_role"), undefined), null);
  assert.equal(assistantWriteAccess(access(manager(), "derived_recipient"), undefined), null);
  assert.equal(assistantWriteAccess(access(manager(), "disabled_account"), undefined), null);
  assert.equal(assistantWriteAccess(access(manager(), "web_user", { ownDirectUid: null }), undefined), null, "quản trị mô phỏng người khác từ web");
  assert.equal(assistantWriteAccess(access(manager({ userId: null })), undefined), null);
  assert.equal(assistantWriteAccess(access(staff()), undefined), null, "D3: Nhân viên chỉ đọc qua trợ lý");
});

test("writeToolDeclarations: Quản lý có đúng 3 propose_* và KHÔNG có confirm_write; Nhân viên không có gì (D1, D3)", () => {
  const names = (declarations: { name: string }[]) => declarations.map((item) => item.name).sort();
  assert.deepEqual(names(writeToolDeclarations(access(), undefined)), ["propose_contact_update", "propose_group_update", "propose_reply_template_save"]);
  assert.deepEqual(writeToolDeclarations(access(staff()), undefined), []);
  assert.deepEqual(writeToolDeclarations(access(), 12), []);
  assert.deepEqual(writeToolDeclarations(access(manager(), "derived_role"), undefined), []);
});

test("khai báo ghi qua bộ làm sạch Gemini: object, không lộ trường cấm (role / phone / kind / cờ Mật)", () => {
  const declarations = writeToolDeclarations(access(admin({ userId: 3 })), undefined);
  for (const declaration of declarations) assert.equal((declaration.parameters as { type?: string }).type, "object", declaration.name);
  const contact = JSON.stringify(declarations.find((item) => item.name === "propose_contact_update"));
  assert.ok(!/"role"|"phone"|"kind"/.test(contact), "D2: không có kind");
  assert.match(contact, /note_append/);
  const group = JSON.stringify(declarations.find((item) => item.name === "propose_group_update"));
  assert.ok(!/is_confidential|read_messages|capture_files|retention/.test(group));
});

test("buildCoreQueryTools: tắt → không gì cả; bật + đủ điều kiện → thêm propose_* và lời nhắc (không nhắc confirm_write như công cụ); trong nhóm / Nhân viên → không công cụ ghi", () => {
  assert.deepEqual(buildCoreQueryTools(access(), false, undefined), { declarations: [], prompt: "" });
  const dm = buildCoreQueryTools(access(), true, undefined);
  assert.ok(!dm.declarations.some((item) => item.name === "confirm_write"));
  assert.ok(dm.declarations.some((item) => item.name === "propose_contact_update"));
  assert.ok(dm.declarations.some((item) => item.name === "query_records"));
  assert.match(dm.prompt, /KHÔNG có công cụ xác nhận/);
  assert.ok(!buildCoreQueryTools(access(), true, 12).declarations.some((item) => item.name.startsWith("propose_")));
  const staffTools = buildCoreQueryTools(access(staff()), true, undefined);
  assert.ok(!staffTools.declarations.some((item) => item.name.startsWith("propose_")));
  assert.ok(!staffTools.prompt.includes(WRITE_TOOLS_PROMPT));
});

test("registry trợ lý: confirm_write KHÔNG có executor (mô hình bị tiêm lệnh cũng không xác nhận được); propose_* có", () => {
  assert.equal(findExecutor("confirm_write"), undefined);
  assert.equal(typeof findExecutor("propose_contact_update"), "function");
});

test("runWriteTool: không đủ điều kiện → forbidden (không chạm DB); tên ngoài danh sách ghi của trợ lý → forbidden; confirm_write → forbidden", async () => {
  const { db, queries } = fakeDb();
  const base = { ...access(), db };
  const denied = await runWriteTool("propose_contact_update", base, 12, { contact_id: 1, note: "x" });
  assert.equal((denied.response.error as { code: string }).code, "forbidden");
  const notAllowed = await runWriteTool("query_records", base, undefined, {});
  assert.equal((notAllowed.response.error as { code: string }).code, "forbidden");
  const confirm = await runWriteTool("confirm_write", base, undefined, { code: "K7Q2MX" });
  assert.equal((confirm.response.error as { code: string }).code, "forbidden");
  const staffDenied = await runWriteTool("propose_reply_template_save", { ...access(staff()), db }, undefined, { title: "Mẫu thử", body: "Nội dung mẫu đủ dài", tone: 1 });
  assert.equal((staffDenied.response.error as { code: string }).code, "forbidden");
  assert.equal(queries.length, 0);
});

test("executor propose_*: có sẵn fixedReply (lượt đã chốt câu trả lời) thì từ chối tạo thêm, không chạm DB", async () => {
  const { db, queries } = fakeDb();
  const context = { db, access: { ...access(), db }, coreQueryTools: true, fixedReply: "đã có" } as unknown as ToolContext;
  const result = await findExecutor("propose_contact_update")!(context, { contact_id: 1, note: "x" }) as { error?: string };
  assert.match(result.error ?? "", /không tạo thêm/);
  assert.equal(queries.length, 0);
});

test("formatDraftPreviewReply: bản xem trước nguyên văn + mã + cách xác nhận / hủy", () => {
  const text = formatDraftPreviewReply("Danh bạ #5 «Sáu»: Ghi chú → «mới»", "K7Q2MX");
  assert.ok(text.includes("Danh bạ #5 «Sáu»: Ghi chú → «mới»"));
  assert.match(text, /Mã xác nhận: K7Q2MX/);
  assert.match(text, /«đồng ý»/);
  assert.match(text, /«hủy»/);
});

test("parseWriteCodeCommand / parseChatCommand: «đồng ý K7Q2MX», «hủy k7q2mx», «ok mã K7Q2MX»; câu thường không phải lệnh mã", () => {
  assert.deepEqual(parseWriteCodeCommand("đồng ý K7Q2MX"), { kind: "confirm", code: "K7Q2MX" });
  assert.deepEqual(parseWriteCodeCommand("Hủy k7q2mx."), { kind: "cancel", code: "K7Q2MX" });
  assert.deepEqual(parseWriteCodeCommand("ok mã K7Q2MX"), { kind: "confirm", code: "K7Q2MX" });
  assert.equal(parseWriteCodeCommand("đồng ý"), null);
  assert.equal(parseWriteCodeCommand("đồng ý K7Q2M"), null, "thiếu ký tự");
  assert.equal(parseWriteCodeCommand("đồng ý K0Q2MX"), null, "0 không thuộc bảng chữ");
  assert.equal(parseWriteCodeCommand("tôi đồng ý K7Q2MX nhé"), null);
  assert.deepEqual(parseChatCommand("đồng ý K7Q2MX"), { kind: "confirm", code: "K7Q2MX" });
  assert.deepEqual(parseChatCommand("đồng ý"), { kind: "confirm" });
  assert.deepEqual(parseChatCommand("hủy"), { kind: "cancel" });
  assert.equal(parseChatCommand("đồng ý G-12")?.kind, "send_confirm", "mã lệnh gửi vẫn đi đường cũ");
});
