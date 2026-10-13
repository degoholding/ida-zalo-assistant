import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMetricChange, formatMetricValue } from "./brief-metric-format.js";
import { formatMetricSection, type BriefMetricDigest } from "./brief-metric-section.js";

const vn = (text: string) => new Date(`${text}+07:00`);
const sales = { label: "Doanh số", unit: "tr", total: 125.4, changePct: 12 };
const stock = { label: "Tồn kho", unit: "bao", total: 3420, changePct: -5 };
const digest = (over: Partial<BriefMetricDigest> = {}): BriefMetricDigest => ({
  date: "2026-10-09", compareDate: "2026-10-08",
  metrics: [sales, stock], sourceNames: ["BCSale"], readAt: vn("2026-10-09T18:02:00"), flaggedCount: 0, missingCount: null, ...over,
});

test("formatMetricValue / formatMetricChange: số kiểu Việt, mũi tên ▲▼", () => {
  assert.equal(formatMetricValue(3420, "bao"), "3.420 bao");
  assert.equal(formatMetricValue(125.4, "tr"), "125,4 tr");
  assert.equal(formatMetricValue(7, ""), "7");
  assert.equal(formatMetricChange(12), "▲12%");
  assert.equal(formatMetricChange(-5), "▼5%");
  assert.equal(formatMetricChange(0), "không đổi");
  assert.equal(formatMetricChange(null), "");
});

test("formatMetricSection sáng: tiêu đề kèm nguồn + giờ đọc, «so <ngày>» chỉ ở dòng đầu, dòng cờ / chưa báo", () => {
  const lines = formatMetricSection(digest({ flaggedCount: 2, missingCount: 3 }), { title: "6. Số liệu hôm qua", untilOnly: false });
  assert.deepEqual(lines, [
    "6. Số liệu hôm qua (BCSale, đọc 18:02)",
    "   - Doanh số: 125,4 tr (▲12% so T5 08/10)",
    "   - Tồn kho: 3.420 bao (▼5%)",
    "   - 2 số cần xác nhận · 3 NV chưa báo",
  ]);
});

test("formatMetricSection cuối ngày: «(tới HH:MM)», không so (compareDate null) thì không % / mũi tên, không cờ thì không dòng trạng thái", () => {
  const lines = formatMetricSection(digest({ readAt: vn("2026-10-09T17:30:00"), compareDate: null }), { title: "6. Số liệu hôm nay", untilOnly: true });
  assert.equal(lines[0], "6. Số liệu hôm nay (tới 17:30)");
  assert.deepEqual(lines.slice(1), ["   - Doanh số: 125,4 tr", "   - Tồn kho: 3.420 bao"]);
});

test("formatMetricSection: tối đa 3 dòng chi tiết + «… và N nữa» (dòng trạng thái chiếm một dòng)", () => {
  const many = Array.from({ length: 4 }, (_, index) => ({ label: `Chỉ tiêu ${index + 1}`, unit: "", total: index + 1, changePct: null }));
  const withStatus = formatMetricSection(digest({ metrics: many, flaggedCount: 1 }), { title: "6. Số liệu hôm qua", untilOnly: false });
  assert.equal(withStatus.length, 1 + 2 + 1 + 1);
  assert.equal(withStatus[3], "   … và 2 nữa");
  assert.equal(withStatus[4], "   - 1 số cần xác nhận");
  const noStatus = formatMetricSection(digest({ metrics: many }), { title: "6. Số liệu hôm qua", untilOnly: false });
  assert.equal(noStatus.filter((line) => line.startsWith("   - ")).length, 3);
  assert.equal(noStatus[4], "   … và 1 nữa");
  assert.equal(noStatus[1], "   - Chỉ tiêu 1: 1");
});

test("formatMetricSection: thiếu giờ đọc / chưa báo = 0 thì không in", () => {
  const lines = formatMetricSection(digest({ readAt: null, missingCount: 0 }), { title: "6. Số liệu hôm qua", untilOnly: false });
  assert.equal(lines[0], "6. Số liệu hôm qua (BCSale)");
  assert.equal(lines.length, 3);
});
