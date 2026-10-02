import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSentAtMs } from "./imports-api.js";

// Giờ xuất tệp thật của lượt nhập 02/10/2026
const EXPORTED_MS = Date.parse("2026-10-02T06:53:00.000Z");

test("prefers the IndexedDB send time when present", () => {
  assert.equal(resolveSentAtMs({ sendDttm: "1790000000000", cliMsgId: "1790391868086" }, EXPORTED_MS), 1790000000000);
  assert.equal(resolveSentAtMs({ sendDttm: 1790000000000, cliMsgId: "" }, EXPORTED_MS), 1790000000000);
});

// Lỗi gặp thật 02/10/2026: tệp xuất trên Edge không có sendDttm nào, mọi tin bị ghi giờ xuất tệp
test("falls back to cliMsgId, which Zalo sets to the sender clock in ms", () => {
  assert.equal(resolveSentAtMs({ sendDttm: null, cliMsgId: "1790391868086" }, EXPORTED_MS), 1790391868086);
  assert.equal(new Date(resolveSentAtMs({ sendDttm: null, cliMsgId: "1790391868086" }, EXPORTED_MS)).toISOString().slice(0, 10), "2026-09-26");
});

test("treats zero, negative and garbage send times as missing", () => {
  for (const sendDttm of [0, "0", -5, "abc", "", undefined, null]) {
    assert.equal(resolveSentAtMs({ sendDttm, cliMsgId: "1790391868086" }, EXPORTED_MS), 1790391868086);
  }
});

test("rejects cliMsgId values that cannot be a timestamp and uses the export time", () => {
  // Mã tuần tự nhỏ, mốc trước 2012, mốc ở tương lai xa, chữ, rỗng
  for (const cliMsgId of ["123", "1000000000000", String(EXPORTED_MS + 2 * 86_400_000), "abc", "", undefined]) {
    assert.equal(resolveSentAtMs({ sendDttm: null, cliMsgId }, EXPORTED_MS), EXPORTED_MS, `cliMsgId=${cliMsgId}`);
  }
});

test("tolerates a sender clock running up to a day ahead", () => {
  const ahead = EXPORTED_MS + 3 * 60 * 60 * 1000;
  assert.equal(resolveSentAtMs({ sendDttm: null, cliMsgId: String(ahead) }, EXPORTED_MS), ahead);
});
