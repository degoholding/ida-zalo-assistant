import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSentAtCondition, chosenDateRange, parseVnDayStart } from "./message-search-api.js";
import { parseSearchBound } from "../../assistant/search-messages-tool.js";

const iso = (date: Date | null | undefined) => date?.toISOString();

test("parseVnDayStart: ngày ô chọn = 00:00 giờ Việt Nam; chuỗi có giờ giữ nguyên; rác thì null", () => {
  assert.equal(iso(parseVnDayStart("2026-10-05")), "2026-10-04T17:00:00.000Z");
  assert.equal(iso(parseVnDayStart("2026-10-05T09:00:00+07:00")), "2026-10-05T02:00:00.000Z");
  assert.equal(parseVnDayStart("không phải ngày"), null);
});

// Review 09/10/2026: «đúng ngày» so thẳng với cột DATETIME(3) gần như không bao giờ khớp; «≤ ngày» cắt mất cả ngày đó
test("buildSentAtCondition: «đúng ngày» / «≤ ngày» / «> ngày» / «trong khoảng» lấy trọn ngày theo giờ Việt Nam", () => {
  const start = new Date("2026-10-04T17:00:00Z");
  const next = new Date("2026-10-05T17:00:00Z");
  assert.deepEqual(buildSentAtCondition("eq", ["2026-10-05"]), { sql: "(s.sent_at >= ? AND s.sent_at < ?)", params: [start, next] });
  assert.deepEqual(buildSentAtCondition("lte", ["2026-10-05"]), { sql: "s.sent_at < ?", params: [next] });
  assert.deepEqual(buildSentAtCondition("gt", ["2026-10-05"]), { sql: "s.sent_at >= ?", params: [next] });
  assert.deepEqual(buildSentAtCondition("between", ["2026-10-01", "2026-10-05"]),
    { sql: "(s.sent_at >= ? AND s.sent_at < ?)", params: [new Date("2026-09-30T17:00:00Z"), next] });
  assert.equal(buildSentAtCondition("between", ["2026-10-01"]), null);
  assert.equal(buildSentAtCondition("eq", ["rác"]), null);
  assert.equal(buildSentAtCondition("isnull", ["1"]), null);
});

// Review 09/10/2026: «≤ ngày» hoặc nối HOẶC từng làm tắt cửa sổ 90 ngày → quét LIKE toàn bộ lịch sử
test("chosenDateRange: chỉ ≥ / đúng ngày / trong khoảng / > mới là «từ ngày»; ≤ hoặc nối HOẶC thì không", () => {
  const range = (init: Record<string, string>) => chosenDateRange(new URLSearchParams(init));
  assert.equal(iso(range({ sent_at__gte: "2026-10-01" }).from), "2026-09-30T17:00:00.000Z");
  assert.equal(iso(range({ sent_at__between: "2026-10-01,2026-10-05" }).from), "2026-09-30T17:00:00.000Z");
  assert.equal(iso(range({ sent_at__gt: "2026-10-01" }).from), "2026-10-01T17:00:00.000Z");
  assert.equal(range({ sent_at__lte: "2026-10-05" }).from, undefined);
  assert.deepEqual(range({ sent_at__gte: "2026-10-01", sender_name: "a", conjunction: "or" }), {});
  assert.deepEqual(range({ q: "thép" }), { from: undefined, to: undefined });
});

// Review lần 2: chỉ chọn «≤ 05/10/2026» thì cửa sổ 90 ngày phải tính lùi từ mốc đó, không từ hôm nay (ra rỗng)
test("chosenDateRange: mốc «đến» = đầu ngày SAU ngày cuối được lấy (≤ / đúng ngày / trong khoảng), < thì chính ngày đó", () => {
  const to = (init: Record<string, string>) => iso(chosenDateRange(new URLSearchParams(init)).to);
  assert.equal(to({ sent_at__lte: "2026-10-05" }), "2026-10-05T17:00:00.000Z");
  assert.equal(to({ sent_at__lt: "2026-10-05" }), "2026-10-04T17:00:00.000Z");
  assert.equal(to({ sent_at__eq: "2026-10-05" }), "2026-10-05T17:00:00.000Z");
  assert.equal(to({ sent_at__between: "2026-10-01,2026-10-05" }), "2026-10-05T17:00:00.000Z");
  assert.equal(to({ sent_at__gte: "2026-10-01" }), undefined);
  assert.equal(to({ sent_at__lte: "rác" }), undefined);
});

test("parseSearchBound (công cụ bot): ngày trơn = đầu / cuối ngày giờ VN; sai định dạng thì null để báo lại mô hình", () => {
  assert.equal(iso(parseSearchBound("2026-03-01", "start")), "2026-02-28T17:00:00.000Z");
  assert.equal(iso(parseSearchBound("2026-03-01", "end")), "2026-03-01T16:59:59.999Z");
  assert.equal(iso(parseSearchBound("2026-03-01T08:00:00+07:00", "start")), "2026-03-01T01:00:00.000Z");
  assert.equal(parseSearchBound(undefined, "start"), undefined);
  assert.equal(parseSearchBound("  ", "start"), undefined);
  assert.equal(parseSearchBound("tuần trước", "start"), null);
});
