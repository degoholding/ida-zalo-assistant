import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallSource, McpCallStatus } from "../constants.js";
import { fakeDb } from "../data-access/data-access-test-support.js";
import { hashArgs, logMcpCall, previewArgs, redactCodes } from "./mcp-call-log.js";

test("redactCodes: chỉ confirm_write bị ẩn mã; công cụ khác giữ nguyên tham số", () => {
  assert.deepEqual(redactCodes("confirm_write", { code: "K7Q2MX" }), { code: "[đã ẩn]" });
  assert.deepEqual(redactCodes("query_records", { code: "K7Q2MX" }), { code: "K7Q2MX" });
  assert.equal(redactCodes("confirm_write", null), null);
});

test("logMcpCall: mã xác nhận không lọt vào args_preview lẫn args_hash (băm 6 ký tự dò ngược được)", async () => {
  const { db, queries } = fakeDb();
  await logMcpCall(db, {
    userId: 1, tenantId: 1, keyId: 5, source: McpCallSource.Http, tool: "confirm_write", args: { code: "K7Q2MX" }, rowCount: 0, resultChars: 0,
    durationMs: 1, status: McpCallStatus.Ok, clientIp: null,
  });
  const params = queries[0].params;
  assert.ok(!JSON.stringify(params).includes("K7Q2MX"));
  assert.ok(!params.includes(hashArgs({ code: "K7Q2MX" })));
});

test("L1: send_draft_create / file_text_store / propose_send_message chỉ ghi ĐỘ DÀI của thân tin / chữ bóc, không bao giờ nội dung", async () => {
  const cases: [string, Record<string, unknown>, string[]][] = [
    ["send_draft_create", { question: "gửi nhóm A: họp lúc 3h chiều nhé", body: "họp lúc 3h chiều nhé", target_names: ["A"] }, ["họp lúc", "gửi nhóm"]],
    ["file_text_store", { attachment_id: 5, method: "text", text: "NỘI DUNG TỆP BÍ MẬT ".repeat(10_000), summary: "tóm tắt bí mật" }, ["BÍ MẬT", "tóm tắt"]],
    ["propose_send_message", { targets: ["A"], content: "báo giá riêng cho khách" }, ["báo giá"]],
    ["send_pin_draft_create", { question: "q riêng", group_names: ["A"], content: "ghi chú ghim riêng" }, ["ghi chú", "q riêng"]],
  ];
  for (const [tool, args, secrets] of cases) {
    const { db, queries } = fakeDb();
    await logMcpCall(db, { userId: 1, tenantId: 1, keyId: null, source: McpCallSource.Assistant, tool, args, rowCount: 0, resultChars: 0, durationMs: 1, status: McpCallStatus.Ok, clientIp: null });
    const preview = String(queries[0].params[8]);
    for (const secret of secrets) assert.ok(!preview.includes(secret), `${tool}: lộ «${secret}» trong ${preview}`);
    assert.match(preview, /\[\d+ ký tự\]/, tool);
  }
  assert.equal(previewArgs({ query: "báo giá" }, "search_messages").includes("báo giá"), true, "công cụ khác giữ bản xem trước");
});

test("L1: chuỗi 200k ký tự bị cắt TRƯỚC khi chạy bộ che (không quét cả chuỗi bằng regex), bản xem trước ≤ 500", () => {
  const huge = { text: "0912345678 ".repeat(20_000) };
  const started = performance.now();
  const preview = previewArgs(huge, "some_other_tool");
  assert.ok(preview.length <= 500);
  assert.ok(performance.now() - started < 200, "cắt trước khi che");
  assert.ok(!/0912345678/.test(preview), "SĐT vẫn bị che");
});
