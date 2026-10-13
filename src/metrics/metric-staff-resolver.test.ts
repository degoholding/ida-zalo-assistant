import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStaffIndex, resolveStaff } from "./metric-staff-resolver.js";

const index = buildStaffIndex([
  { id: 1, code: "NV01", name: "Nguyễn Văn Sáu", region: "Miền Tây", expectsReport: true },
  { id: 2, code: "NV02", name: "Trần Thị Bảy", region: "Miền Đông", expectsReport: true },
  { id: 3, code: "NV03", name: "Trần Thị Bảy", region: "Tây Nguyên", expectsReport: true },
]);

test("matches by folded name", () => {
  const found = resolveStaff(index, " nguyen van sau ", "name");
  assert.equal(found.staffKey, "e:1");
  assert.equal(found.region, "Miền Tây");
  assert.equal(found.unknown, false);
});

test("matches by code", () => assert.equal(resolveStaff(index, "nv02", "code").staffKey, "e:2"));

test("duplicate names are not guessed", () => {
  const found = resolveStaff(index, "Trần Thị Bảy", "name");
  assert.equal(found.staffKey, "n:tran thi bay");
  assert.equal(found.unknown, true);
});

test("unknown staff is flagged only when a catalog exists", () => {
  assert.equal(resolveStaff(index, "Ai Đó", "name").unknown, true);
  assert.equal(resolveStaff(buildStaffIndex([]), "Ai Đó", "name").unknown, false);
});
