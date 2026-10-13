import assert from "node:assert/strict";
import { test } from "node:test";
import { metricPdfLines, metricSummaryLine } from "./periodic-report-metric-format.js";
import { periodDays } from "./periodic-report-metric-stats.js";
import type { PeriodicMetricSummary } from "./periodic-report-types.js";

const figure = (index: number, changePct: number | null) =>
  ({ code: `c${index}`, label: `Chỉ tiêu ${index}`, unit: "tr", current: 100 * index, previous: null, changePct });
const summary = (count: number, flaggedCount = 0): PeriodicMetricSummary => ({
  metrics: Array.from({ length: count }, (_, i) => figure(i + 1, i === 0 ? 8 : null)), staff: [], areas: [], flaggedCount,
});

test("metricSummaryLine: ≤ 4 chỉ tiêu, ▲ theo %, kèm số cần xác nhận", () => {
  assert.equal(metricSummaryLine(summary(2)), "Số liệu: Chỉ tiêu 1 100 tr (▲8%) · Chỉ tiêu 2 200 tr");
  const line = metricSummaryLine(summary(6, 2));
  assert.ok(!line.includes("Chỉ tiêu 5"));
  assert.ok(line.endsWith("· 2 số cần xác nhận"));
});

test("metricPdfLines: ≤ 4 chỉ tiêu + 1 dòng cờ", () => {
  assert.equal(metricPdfLines(summary(6)).length, 4);
  const lines = metricPdfLines(summary(6, 1));
  assert.equal(lines.length, 5);
  assert.equal(lines[0], "Chỉ tiêu 1: 100 tr (▲8% so kỳ trước)");
});

test("periodDays: nửa khoảng mở [from, to) → ngày cuối là ngày trước 00:00 của `to`", () => {
  const days = periodDays({ from: new Date("2026-10-04T17:00:00Z"), to: new Date("2026-10-11T17:00:00Z") });
  assert.deepEqual(days, { from: "2026-10-05", to: "2026-10-11" });
});
