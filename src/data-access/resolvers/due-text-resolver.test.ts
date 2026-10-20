import assert from "node:assert/strict";
import { test } from "node:test";
import { DataAccessError } from "../data-access-errors.js";
import { DUE_UNPARSED_REASON, dueUnparsedMessage, requireDueText, requireDueTextStrict, resolveDueText } from "./due-text-resolver.js";

// Thứ 6, 09/10/2026, 10:00 giờ VN
const NOW = new Date("2026-10-09T10:00:00+07:00");
const vn = (iso: string) => new Date(`${iso}+07:00`).toISOString();
const asJson = (text: string) => {
  const due = resolveDueText(text, NOW);
  return due ? { at: due.at.toISOString(), hasTime: due.hasTime } : null;
};

test("bảng ca: chữ tự do + ISO cho đúng mốc giờ VN (chép từ task-due-parser.test)", () => {
  const table: [string, { at: string; hasTime: boolean } | null][] = [
    ["thứ 6", { at: vn("2026-10-16T00:00:00"), hasTime: false }],
    ["mai 17h", { at: vn("2026-10-10T17:00:00"), hasTime: true }],
    ["mai", { at: vn("2026-10-10T00:00:00"), hasTime: false }],
    ["17h thứ 6", { at: vn("2026-10-16T17:00:00"), hasTime: true }],
    ["20/10", { at: vn("2026-10-20T00:00:00"), hasTime: false }],
    ["cuối tuần", { at: vn("2026-10-10T00:00:00"), hasTime: false }],
    ["2026-10-16", { at: vn("2026-10-16T00:00:00"), hasTime: false }],
    ["2026-10-16T17:00:00+07:00", { at: vn("2026-10-16T17:00:00"), hasTime: true }],
    ["31/2", null],
    ["1999-01-01", null],
    ["linh tinh", null],
  ];
  for (const [text, expected] of table) assert.deepEqual(asJson(text), expected, text);
});

test("requireDueText: trống → null; không hiểu → lỗi invalid_value kèm câu bot cũ", () => {
  assert.equal(requireDueText("", NOW), null);
  assert.equal(requireDueText("   ", NOW), null);
  assert.equal(requireDueText(undefined, NOW), null);
  assert.deepEqual(requireDueText(" mai ", NOW), { at: new Date(vn("2026-10-10T00:00:00")), hasTime: false });
  assert.throws(() => requireDueText("bữa nào đó", NOW), (error: unknown) =>
    error instanceof DataAccessError && error.code === "invalid_value" && error.detail?.reason === DUE_UNPARSED_REASON && error.message === dueUnparsedMessage("bữa nào đó"));
});

test("requireDueTextStrict: trống cũng là lỗi (dời hạn cần hạn mới)", () => {
  assert.throws(() => requireDueTextStrict("", NOW), (error: unknown) => error instanceof DataAccessError && error.message === dueUnparsedMessage(""));
  assert.equal(requireDueTextStrict("thứ 6", NOW).at.toISOString(), vn("2026-10-16T00:00:00"));
});
