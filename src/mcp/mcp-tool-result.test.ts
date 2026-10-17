import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallStatus } from "../constants.js";
import type { ToolResult } from "../data-access/tool-runner.js";
import { hashArgs, previewArgs, stableStringify } from "./mcp-call-log.js";
import { rateLimitedResult, statusOf, toCallToolResult } from "./mcp-tool-result.js";

const ok: ToolResult = { isError: false, structured: { rows: [1] }, text: "tóm tắt", rowCount: 1, resultChars: 7, entity: "tasks" };
const failed = (errorCode: ToolResult["errorCode"]): ToolResult => ({ isError: true, structured: { error: {} }, text: "lỗi", rowCount: 0, resultChars: 3, errorCode });

test("toCallToolResult: thành công có structuredContent; lỗi chỉ có chữ + isError", () => {
  assert.deepEqual(toCallToolResult(ok), { content: [{ type: "text", text: "tóm tắt" }], structuredContent: { rows: [1] } });
  const error = toCallToolResult(failed("invalid_field"));
  assert.equal(error.isError, true);
  assert.equal(error.structuredContent, undefined);
});

test("statusOf: map mã lỗi lõi sang trạng thái nhật ký", () => {
  assert.equal(statusOf(ok), McpCallStatus.Ok);
  assert.equal(statusOf(failed("forbidden")), McpCallStatus.Denied);
  assert.equal(statusOf(failed("not_found")), McpCallStatus.Denied);
  assert.equal(statusOf(failed("invalid_field")), McpCallStatus.Invalid);
  assert.equal(statusOf(failed("range_too_wide")), McpCallStatus.Invalid);
  assert.equal(statusOf(failed("timeout")), McpCallStatus.Error);
});

test("rateLimitedResult: isError, có mã rate_limited và số giây chờ", () => {
  const result = rateLimitedResult(7, "rate");
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /rate_limited/);
  assert.match(result.content[0].text, /"retry_after_seconds":7/);
});

test("băm tham số ổn định theo thứ tự khóa; bản xem trước che SĐT và cắt 500 ký tự", () => {
  assert.equal(hashArgs({ a: 1, b: { y: 2, x: [1, 2] } }), hashArgs({ b: { x: [1, 2], y: 2 }, a: 1 }));
  assert.notEqual(hashArgs({ a: 1 }), hashArgs({ a: 2 }));
  assert.equal(hashArgs({ a: 1, b: undefined }), hashArgs({ a: 1 }));
  assert.equal(stableStringify(undefined), "null");
  assert.ok(!previewArgs({ q: "gọi 0912345678 nhé" }).includes("0912345678"));
  assert.equal(previewArgs({ q: "x".repeat(2000) }).length, 500);
});
