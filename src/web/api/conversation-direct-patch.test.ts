import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDirectThreadPatch } from "./conversations-api.js";

test("PATCH cuộc riêng: nhận read_messages / capture_files dạng boolean, 0/1, chuỗi", () => {
  assert.deepEqual(parseDirectThreadPatch({ read_messages: false }), { readMessages: false });
  assert.deepEqual(parseDirectThreadPatch({ read_messages: "1", capture_files: 0 }), { readMessages: true, captureFiles: false });
});

test("PATCH cuộc riêng: thân rỗng, chỉ có trường lạ hoặc giá trị lạ đều 422 — không lặng lẽ bật lại đọc", () => {
  for (const body of [{}, { label: "x" }, { read_messages: "off" }, { read_messages: null }, { capture_files: 2 }]) {
    assert.throws(() => parseDirectThreadPatch(body as Record<string, unknown>), (error: { status?: number }) => error.status === 422);
  }
});
