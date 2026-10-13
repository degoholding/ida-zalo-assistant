import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { columnLetterToIndex, resolveColumns, validateMapping } from "./metric-mapping.js";

const valid = {
  date: "Ngày", staff: "Nhân viên", area: "Khu vực",
  metrics: [{ code: "doanh_so", label: "Doanh số", column: "Doanh số (đ)", unit: "đ", aggregate: "sum" }, { code: "ton_kho", column: "H", aggregate: "last" }],
};

describe("validateMapping", () => {
  test("accepts a valid mapping and applies defaults", () => {
    const result = validateMapping(valid);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.mapping.staffBy, "name");
      assert.equal(result.mapping.metrics[1].label, "ton_kho");
    }
  });
  test("accepts JSON text", () => assert.ok(validateMapping(JSON.stringify(valid)).ok));
  test("rejects bad input with Vietnamese messages", () => {
    assert.match((validateMapping("{") as { error: string }).error, /JSON/);
    assert.match((validateMapping({ ...valid, date: "" }) as { error: string }).error, /Ngày/);
    assert.match((validateMapping({ ...valid, metrics: [] }) as { error: string }).error, /chỉ tiêu/);
    assert.match((validateMapping({ ...valid, metrics: [{ code: "A b", column: "x" }] }) as { error: string }).error, /mã/);
    assert.match((validateMapping({ ...valid, metrics: [valid.metrics[0], valid.metrics[0]] }) as { error: string }).error, /trùng/);
    assert.match((validateMapping({ ...valid, staff_by: "x" }) as { error: string }).error, /staff_by/);
    assert.match((validateMapping({ ...valid, metrics: [{ code: "ab", column: "x", aggregate: "avg" }] }) as { error: string }).error, /aggregate/);
  });
});

describe("resolveColumns", () => {
  const mapping = (validateMapping(valid) as { mapping: never }).mapping;
  test("matches by folded header and by column letter", () => {
    const result = resolveColumns(["STT", " ngay ", "Nhan  vien", "khu vuc", "Doanh so (d)", "", "", "x"], mapping);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.columns.date, 1);
      assert.equal(result.columns.staff, 2);
      assert.equal(result.columns.area, 3);
      assert.deepEqual(result.columns.metrics.map((m) => m.index), [4, 7]);
    }
  });
  test("reports missing column with the headers present", () => {
    const result = resolveColumns(["Ngày", "Nhân viên", "Khu vực"], mapping, 2);
    assert.ok(!result.ok);
    if (!result.ok) assert.match(result.error, /Không thấy cột «Doanh số \(đ\)».*dòng tiêu đề 2.*có: Ngày, Nhân viên/);
  });
  test("column letters", () => {
    assert.equal(columnLetterToIndex("A"), 0);
    assert.equal(columnLetterToIndex("aa"), 26);
    assert.equal(columnLetterToIndex("ZZ"), 701);
    assert.equal(columnLetterToIndex("AAA"), -1);
  });
});
