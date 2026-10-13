import assert from "node:assert/strict";
import { test } from "node:test";
import { comparisonPeriod } from "./metric-comparison-period.js";
import { QUERY_METRICS_DECLARATION, resolveQueryPeriod } from "./metric-query-tool.js";

const NOW = new Date("2026-10-14T05:00:00Z"); // thứ 4 14/10/2026, giờ VN

test("kỳ: hôm nay / hôm qua / tuần này + tháng này tới hôm nay / kỳ trọn", () => {
  assert.deepEqual(resolveQueryPeriod({ period: "today" }, NOW), { from: "2026-10-14", to: "2026-10-14", label: "hôm nay (14/10/2026 – 14/10/2026)" });
  assert.equal((resolveQueryPeriod({ period: "yesterday" }, NOW) as { from: string }).from, "2026-10-13");
  assert.equal((resolveQueryPeriod({}, NOW) as { from: string }).from, "2026-10-14"); // mặc định = hôm nay
  const week = resolveQueryPeriod({ period: "this_week" }, NOW) as { from: string; to: string };
  assert.deepEqual([week.from, week.to], ["2026-10-12", "2026-10-14"]);
  const last = resolveQueryPeriod({ period: "last_week" }, NOW) as { from: string; to: string };
  assert.deepEqual([last.from, last.to], ["2026-10-05", "2026-10-11"]);
  const month = resolveQueryPeriod({ period: "this_month" }, NOW) as { from: string; to: string };
  assert.deepEqual([month.from, month.to], ["2026-10-01", "2026-10-14"]);
  const prev = resolveQueryPeriod({ period: "last_month" }, NOW) as { from: string; to: string };
  assert.deepEqual([prev.from, prev.to], ["2026-09-01", "2026-09-30"]);
});

test("review phase 10: kỳ chưa trọn so CÙNG SỐ NGÀY của kỳ trước; kỳ trọn so kỳ trọn trước", () => {
  const compare = (args: Record<string, unknown>, now = NOW) => {
    const period = resolveQueryPeriod(args, now) as { from: string; to: string; unit?: "week" | "month" };
    return comparisonPeriod(period.from, period.to, { unit: period.unit, today: "2026-10-14" });
  };
  assert.deepEqual(compare({ period: "this_month" }), { from: "2026-09-01", to: "2026-09-14" });
  assert.deepEqual(compare({ period: "this_week" }), { from: "2026-10-05", to: "2026-10-07" });
  assert.deepEqual(compare({ period: "last_month" }), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(compare({ period: "last_week" }), { from: "2026-09-28", to: "2026-10-04" });
  assert.deepEqual(compare({ period: "today" }), { from: "2026-10-13", to: "2026-10-13" });
  // Sáng T2 «tuần này» = mỗi T2 → so T2 tuần trước (không so Chủ nhật)
  const monday = resolveQueryPeriod({ period: "this_week" }, new Date("2026-10-12T02:00:00Z")) as { from: string; to: string; unit?: "week" };
  assert.deepEqual(comparisonPeriod(monday.from, monday.to, { unit: monday.unit }), { from: "2026-10-05", to: "2026-10-05" });
});

test("comparisonPeriod: suy đơn vị từ khoảng ngày (màn web), cắt tới hôm nay, tháng ngắn", () => {
  assert.deepEqual(comparisonPeriod("2026-10-01", "2026-10-31", { today: "2026-10-12" }), { from: "2026-09-01", to: "2026-09-12" });
  assert.deepEqual(comparisonPeriod("2026-09-01", "2026-09-30"), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(comparisonPeriod("2026-03-01", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(comparisonPeriod("2026-03-01", "2026-03-30"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(comparisonPeriod("2026-01-01", "2026-01-31"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(comparisonPeriod("2026-10-12", "2026-10-14"), { from: "2026-10-05", to: "2026-10-07" });
  assert.deepEqual(comparisonPeriod("2026-10-12", "2026-10-18"), { from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(comparisonPeriod("2026-10-07", "2026-10-09"), { from: "2026-10-04", to: "2026-10-06" });
  assert.deepEqual(comparisonPeriod("2026-10-12", "2026-10-12"), { from: "2026-10-11", to: "2026-10-11" });
});

test("kỳ tùy chọn kiểm from / to; kỳ lạ bị từ chối; Chủ nhật vẫn thuộc tuần T2–CN", () => {
  assert.ok("error" in (resolveQueryPeriod({ period: "custom", from: "14/10/2026" }, NOW) as object));
  assert.ok("error" in (resolveQueryPeriod({ period: "custom", from: "2026-10-14", to: "2026-10-01" }, NOW) as object));
  assert.ok("error" in (resolveQueryPeriod({ period: "quý" }, NOW) as object));
  const single = resolveQueryPeriod({ period: "custom", from: "2026-10-01" }, NOW) as { from: string; to: string };
  assert.deepEqual([single.from, single.to], ["2026-10-01", "2026-10-01"]);
  const sunday = resolveQueryPeriod({ period: "this_week" }, new Date("2026-10-18T05:00:00Z")) as { from: string; to: string };
  assert.deepEqual([sunday.from, sunday.to], ["2026-10-12", "2026-10-18"]);
});

test("khai báo công cụ: bắt buộc metric, đủ tham số theo plan", () => {
  const props = Object.keys(QUERY_METRICS_DECLARATION.parameters.properties);
  assert.deepEqual(props, ["metric", "period", "from", "to", "area", "staff", "group_by"]);
});
