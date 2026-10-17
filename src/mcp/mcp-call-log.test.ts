import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallSource, McpCallStatus } from "../constants.js";
import { fakeDb } from "../data-access/data-access-test-support.js";
import { hashArgs, logMcpCall, redactCodes } from "./mcp-call-log.js";

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
