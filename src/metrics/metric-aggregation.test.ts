import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MetricFlag } from "../constants.js";
import { resolveMetricCodes, rollupFacts, type MetricCatalogItem, type MetricFact } from "./metric-aggregation.js";

const catalog: MetricCatalogItem[] = [
  { code: "doanh_so", label: "Doanh số", unit: "đ", aggregate: "sum", sourceId: 1, sourceName: "BCSale", lastOkAt: null },
  { code: "ton_kho", label: "Tồn kho", unit: "bao", aggregate: "last", sourceId: 2, sourceName: "BC-Tồn kho", lastOkAt: null },
];

test("resolveMetricCodes matches folded label or code", () => {
  assert.deepEqual(resolveMetricCodes(catalog, "doanh so tuan nay the nao"), ["doanh_so"]);
  assert.deepEqual(resolveMetricCodes(catalog, "TỒN KHO miền Tây và doanh số"), ["doanh_so", "ton_kho"]);
  assert.deepEqual(resolveMetricCodes(catalog, "ton_kho"), ["ton_kho"]);
  assert.deepEqual(resolveMetricCodes(catalog, "thời tiết"), []);
});

const fact = (date: string, staff: string, code: string, value: number | null, flags = 0): MetricFact =>
  ({ date, staffKey: `n:${staff}`, staffName: staff, areaKey: "a", areaName: "A", code, value, flags });
const aggregates = new Map([["doanh_so", "sum" as const], ["ton_kho", "last" as const]]);

describe("rollupFacts", () => {
  test("sum adds days, compares with the previous period", () => {
    const result = rollupFacts(
      [fact("2026-10-10", "an", "doanh_so", 100), fact("2026-10-11", "an", "doanh_so", 50), fact("2026-10-11", "binh", "doanh_so", 30)],
      [fact("2026-10-08", "an", "doanh_so", 100)], aggregates, "staff",
    );
    assert.deepEqual(result.rows.map((r) => [r.label, r.value, r.previous, r.changePct]), [["an", 150, 100, 50], ["binh", 30, null, null]]);
    assert.equal(result.total, 180);
    assert.equal(result.previousTotal, 100);
  });

  test("last takes the final day then adds across staff", () => {
    const result = rollupFacts(
      [fact("2026-10-10", "an", "ton_kho", 20), fact("2026-10-11", "an", "ton_kho", 15), fact("2026-10-11", "binh", "ton_kho", 5)],
      [], aggregates, "metric", new Map([["ton_kho", "Tồn kho"]]),
    );
    assert.equal(result.rows[0].value, 20);
    assert.equal(result.rows[0].label, "Tồn kho");
  });

  test("flagged rows and null values", () => {
    const result = rollupFacts([fact("2026-10-11", "an", "doanh_so", 10, MetricFlag.Deviation), fact("2026-10-11", "binh", "doanh_so", null, MetricFlag.Unparsed)], [], aggregates, "staff");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].flagged, true);
  });

  test("group by date is chronological", () => {
    const result = rollupFacts([fact("2026-10-11", "an", "doanh_so", 5), fact("2026-10-10", "an", "doanh_so", 7)], [], aggregates, "date");
    assert.deepEqual(result.rows.map((r) => r.key), ["2026-10-10", "2026-10-11"]);
  });
});
