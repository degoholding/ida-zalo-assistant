import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMetricDateCondition, buildMetricFlagsCondition, METRIC_VALUE_LIST_SPEC } from "./metrics-api.js";
import { changePercent, parseIsoDay, parseSummaryParams } from "./metric-summary-query.js";

test("METRIC_VALUE_LIST_SPEC: khai đủ trường lọc / cột sắp xếp / cột tìm mà màn web dùng", () => {
  assert.deepEqual(Object.keys(METRIC_VALUE_LIST_SPEC.fields).sort(), ["area_key", "catalog_entry_id", "flags", "metric_code", "metric_date", "source_id"]);
  assert.deepEqual(Object.keys(METRIC_VALUE_LIST_SPEC.sorts).sort(), ["area_name", "metric_code", "metric_date", "staff_name", "value"]);
  assert.deepEqual(METRIC_VALUE_LIST_SPEC.search?.columns, ["v.staff_name", "v.area_name", "v.raw_text"]);
});

test("buildMetricDateCondition: khoảng ngày so theo chuỗi ngày, rác thì bỏ lọc", () => {
  assert.deepEqual(buildMetricDateCondition("between", ["2026-10-01", "2026-10-07"]), { sql: "v.metric_date BETWEEN ? AND ?", params: ["2026-10-01", "2026-10-07"] });
  assert.deepEqual(buildMetricDateCondition("eq", ["2026-10-05T00:00:00Z"]), { sql: "v.metric_date = ?", params: ["2026-10-05"] });
  assert.equal(buildMetricDateCondition("between", ["2026-10-01"]), null);
  assert.equal(buildMetricDateCondition("eq", ["rác"]), null);
  assert.equal(buildMetricDateCondition("contains", ["2026-10-01"]), null);
});

test("buildMetricFlagsCondition: bit cờ — bất kỳ cờ trong danh sách, 0 = sạch cờ, ne = ngược lại", () => {
  assert.deepEqual(buildMetricFlagsCondition("eq", ["1"]), { sql: "(v.flags & 1) <> 0", params: [] });
  assert.deepEqual(buildMetricFlagsCondition("in", ["2", "8"]), { sql: "(v.flags & 10) <> 0", params: [] });
  assert.deepEqual(buildMetricFlagsCondition("eq", ["0"]), { sql: "v.flags = 0", params: [] });
  assert.deepEqual(buildMetricFlagsCondition("ne", ["4"]), { sql: "NOT (v.flags & 4) <> 0", params: [] });
  assert.equal(buildMetricFlagsCondition("eq", ["99"]), null);
  assert.equal(buildMetricFlagsCondition("eq", ["x"]), null);
  assert.equal(buildMetricFlagsCondition("gt", ["1"]), null);
});

test("parseIsoDay: chỉ nhận ngày có thật", () => {
  assert.equal(parseIsoDay("2026-10-12", "Ngày"), "2026-10-12");
  assert.throws(() => parseIsoDay("2026-02-30", "Ngày"), /không hợp lệ/);
  assert.throws(() => parseIsoDay(null, "Ngày"), /không hợp lệ/);
});

test("parseSummaryParams: bắt buộc chỉ tiêu, trần 366 ngày, group_by hợp lệ", () => {
  const ok = parseSummaryParams(new URLSearchParams("metric=doanh_so,ton_kho&from=2026-10-01&to=2026-10-07&group_by=area&area=hn&staff=5"));
  assert.deepEqual(ok, { codes: ["doanh_so", "ton_kho"], from: "2026-10-01", to: "2026-10-07", areaKey: "hn", catalogEntryId: 5, groupBy: "area" });
  assert.equal(parseSummaryParams(new URLSearchParams("metric=a1&from=2026-10-01&to=2026-10-01")).groupBy, "staff");
  assert.throws(() => parseSummaryParams(new URLSearchParams("from=2026-10-01&to=2026-10-02")), /chỉ tiêu/);
  assert.throws(() => parseSummaryParams(new URLSearchParams("metric=a1&from=2025-01-01&to=2026-10-01")), /366/);
  assert.throws(() => parseSummaryParams(new URLSearchParams("metric=a1&from=2026-10-05&to=2026-10-01")), /sau hoặc trùng/);
  assert.throws(() => parseSummaryParams(new URLSearchParams("metric=a1&from=2026-10-01&to=2026-10-02&group_by=metric")), /staff, area/);
});

test("changePercent: kỳ trước bằng 0 thì không có %", () => {
  assert.equal(changePercent(150, 100), 50);
  assert.equal(changePercent(50, 100), -50);
  assert.equal(changePercent(10, 0), null);
});
