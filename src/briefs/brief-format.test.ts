import assert from "node:assert/strict";
import { test } from "node:test";
import { briefLine, capBucket, clock, dayLabel, overdueDays, section, snippet, taskLine, ticketLine } from "./brief-format.js";
import type { Bucket, BriefLine } from "./brief-types.js";

const vn = (text: string) => new Date(`${text}+07:00`);
const line = (over: Partial<BriefLine> = {}): BriefLine =>
  ({ groupName: "K52", senderName: "Lan", at: vn("2026-10-09T16:40:00"),
    text: "hàng lô 3 cháy lá nhiều quá anh ơi xem gấp giúp em với anh coi liền nhé", ref: 101, ...over });

test("dayLabel: thứ 6 09/10", () => {
  assert.equal(dayLabel(vn("2026-10-09T07:30:00")), "T6 09/10");
});

test("clock: 16:40 giờ VN", () => {
  assert.equal(clock(vn("2026-10-09T16:40:00")), "16:40");
});

test("snippet: cắt còn tối đa max ký tự, gộp khoảng trắng thừa", () => {
  assert.equal(snippet("  a   b   c  ", 60), "a b c");
  const long = "x".repeat(70);
  assert.equal(snippet(long, 60), `${"x".repeat(59)}…`);
});

test("briefLine: đúng khuôn «   - [nhóm] người giờ: trích» (trích cắt ≤ 60 ký tự)", () => {
  assert.equal(briefLine(line()), "   - [K52] Lan 16:40: hàng lô 3 cháy lá nhiều quá anh ơi xem gấp giúp em với anh …");
});

test("briefLine: groupName rỗng → «riêng»", () => {
  assert.equal(briefLine(line({ groupName: "" })), "   - [riêng] Lan 16:40: hàng lô 3 cháy lá nhiều quá anh ơi xem gấp giúp em với anh …");
});

test("overdueDays: cùng ngày hôm nay → «quá hạn»; qua ngày → «quá N ngày»", () => {
  const now = vn("2026-10-09T17:00:00");
  assert.equal(overdueDays(vn("2026-10-09T08:00:00"), now), "quá hạn");
  assert.equal(overdueDays(vn("2026-10-07T08:00:00"), now), "quá 2 ngày");
});

test("taskLine / ticketLine: đúng khuôn mã V- / T-", () => {
  assert.equal(taskLine(line({ ref: 12, senderName: "Mai", text: "hợp đồng thép" }), "quá 2 ngày"), "   - V-12 Mai · hợp đồng thép · quá 2 ngày");
  assert.equal(ticketLine(line({ ref: 8, senderName: "Tuấn", text: "Đổi hàng lỗi" })), "   - T-8 Đổi hàng lỗi · Tuấn");
});

test("capBucket: top N + số còn lại tính theo total thật (không phải items.length)", () => {
  const bucket: Bucket<BriefLine> = { total: 5, items: [line({ ref: 1 }), line({ ref: 2 }), line({ ref: 3 })] };
  const capped = capBucket(bucket, 3);
  assert.equal(capped.shown.length, 3);
  assert.equal(capped.more, 2);
});

test("section: rỗng → «không có»; có dữ liệu → tiêu đề + dòng + «… và N nữa»", () => {
  assert.deepEqual(section("Việc: 0 quá hạn", [], 0), ["Việc: 0 quá hạn", "   không có"]);
  assert.deepEqual(section("Ticket mở: 5", ["   - a", "   - b", "   - c"], 5), ["Ticket mở: 5", "   - a", "   - b", "   - c", "   … và 2 nữa"]);
  assert.deepEqual(section("Ticket mở: 2", ["   - a", "   - b"], 2), ["Ticket mở: 2", "   - a", "   - b"]);
});
