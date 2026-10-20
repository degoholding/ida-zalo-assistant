import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricCatalogItem } from "../../metrics/metric-aggregation.js";
import { fakeDb } from "../data-access-test-support.js";
import { findAreaKey, resolveMetricName } from "./metric-name-resolver.js";
import { resolveQueryPeriod } from "./metric-period-resolver.js";

// Bộ phân giải kỳ chữ + tên chỉ tiêu / khu vực của họ `metrics` (hàm thuần / «DB» giả). Ca kỳ chép từ metric-query-tool.test.ts.

const NOW = new Date("2026-10-14T05:00:00Z"); // thứ 4 14/10/2026, giờ VN
const range = (args: Record<string, unknown>, now = NOW) => resolveQueryPeriod(args, now) as { from: string; to: string; unit?: string; label: string };
const item = (code: string, label: string): MetricCatalogItem => ({ code, label, unit: "đ", sourceId: 1, sourceName: "BCSale", lastOkAt: null }) as MetricCatalogItem;

test("kỳ chữ theo giờ VN: mặc định hôm nay; tuần T2–CN; tháng này tới hôm nay; kỳ trước trọn", () => {
  assert.deepEqual(range({}), { from: "2026-10-14", to: "2026-10-14", label: "hôm nay (14/10/2026 – 14/10/2026)" });
  assert.deepEqual([range({ period: "this_week" }).from, range({ period: "this_week" }).unit], ["2026-10-12", "week"]);
  assert.deepEqual([range({ period: "last_week" }).from, range({ period: "last_week" }).to], ["2026-10-05", "2026-10-11"]);
  assert.deepEqual([range({ period: "this_month" }).from, range({ period: "this_month" }).to], ["2026-10-01", "2026-10-14"]);
  assert.deepEqual([range({ period: "last_month" }).from, range({ period: "last_month" }).to], ["2026-09-01", "2026-09-30"]);
});

test("kỳ chữ: 23:30 UTC đã là sáng hôm sau giờ VN; Chủ nhật vẫn thuộc tuần T2–CN", () => {
  assert.equal(range({ period: "today" }, new Date("2026-10-14T20:00:00Z")).from, "2026-10-15");
  assert.deepEqual([range({ period: "this_week" }, new Date("2026-10-18T05:00:00Z")).from, range({ period: "this_week" }, new Date("2026-10-18T05:00:00Z")).to], ["2026-10-12", "2026-10-18"]);
});

test("kỳ tùy chọn kiểm from / to; kỳ lạ bị từ chối", () => {
  assert.ok("error" in resolveQueryPeriod({ period: "custom", from: "14/10/2026" }, NOW));
  assert.ok("error" in resolveQueryPeriod({ period: "custom", from: "2026-10-14", to: "2026-10-01" }, NOW));
  assert.ok("error" in resolveQueryPeriod({ period: "custom", from: "2024-01-01", to: "2026-01-01" }, NOW));
  assert.ok("error" in resolveQueryPeriod({ period: "quý" }, NOW));
  assert.deepEqual([range({ period: "custom", from: "2026-10-01" }).from, range({ period: "custom", from: "2026-10-01" }).to], ["2026-10-01", "2026-10-01"]);
});

test("tên chỉ tiêu: khớp bỏ dấu / hoa thường, kèm danh sách khi không khớp; rỗng không khớp gì", () => {
  const catalog = [item("doanh_so", "Doanh số"), item("ton_kho", "Tồn kho")];
  assert.deepEqual(resolveMetricName(catalog, "DOANH SO tuần này").codes, ["doanh_so"]);
  assert.deepEqual(resolveMetricName(catalog, "ton kho").codes, ["ton_kho"]);
  const none = resolveMetricName(catalog, "lợi nhuận");
  assert.deepEqual([none.codes, none.available], [[], ["Doanh số", "Tồn kho"]]);
  assert.deepEqual(resolveMetricName(catalog, "").codes, []);
});

test("khu vực: khớp đúng / chứa → khóa; mơ hồ hoặc không có → lỗi liệt kê khu vực đang có", async () => {
  const rows = [{ area_key: "can tho", area_name: "Cần Thơ" }, { area_key: "ca mau", area_name: "Cà Mau" }, { area_key: "can gio", area_name: "Cần Giờ" }];
  const { db } = fakeDb(() => rows);
  assert.deepEqual(await findAreaKey(db, "Cần Thơ"), { key: "can tho" });
  assert.deepEqual(await findAreaKey(db, "mau"), { key: "ca mau" });
  const ambiguous = await findAreaKey(db, "can");
  assert.ok("error" in ambiguous && /Khu vực chưa rõ/.test(ambiguous.error) && /Cần Thơ/.test(ambiguous.error));
  const none = await findAreaKey(db, "Hà Nội");
  assert.ok("error" in none && /Không có khu vực/.test(none.error));
});
