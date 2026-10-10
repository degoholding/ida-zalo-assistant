import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBriefCommand } from "./brief-command-parser.js";

test("reads «bản tin sáng» with or without diacritics", () => {
  assert.deepEqual(parseBriefCommand("bản tin sáng"), { kind: "brief_request", request: "morning", variant: "standard" });
  assert.deepEqual(parseBriefCommand("ban tin sang"), { kind: "brief_request", request: "morning", variant: "standard" });
  assert.deepEqual(parseBriefCommand("Bản tin sáng nay"), { kind: "brief_request", request: "morning", variant: "standard" });
});

test("reads «bản tin cuối ngày» / «bản tin chiều» / «bản tin tối» as the evening brief", () => {
  assert.equal(parseBriefCommand("bản tin cuối ngày")?.request, "evening");
  assert.equal(parseBriefCommand("bản tin chiều")?.request, "evening");
  assert.equal(parseBriefCommand("bản tin tối")?.request, "evening");
});

test("reads bare «bản tin» as auto — morning / evening decided later by the hour", () => {
  assert.deepEqual(parseBriefCommand("bản tin"), { kind: "brief_request", request: "auto", variant: "standard" });
});

// Lỗi review phase 8: regex EVENING cũ khớp luôn «hôm nay» nên gõ buổi sáng vẫn ra bản cuối ngày — PHẢI là "auto" để
// runBriefCommand tự quyết theo giờ gọi (trước 12:00 = sáng, sau đó = cuối ngày).
test("reads «bản tin hôm nay» as auto, NOT hardcoded evening", () => {
  assert.deepEqual(parseBriefCommand("bản tin hôm nay"), { kind: "brief_request", request: "auto", variant: "standard" });
});

test("reads «báo cáo tuần» / «bc tuần» as weekly, default variant standard (last finished period)", () => {
  assert.deepEqual(parseBriefCommand("báo cáo tuần"), { kind: "brief_request", request: "weekly", variant: "standard" });
  assert.deepEqual(parseBriefCommand("bc tuần"), { kind: "brief_request", request: "weekly", variant: "standard" });
  assert.equal(parseBriefCommand("báo cáo tuần trước")?.variant, "standard");
  assert.equal(parseBriefCommand("báo cáo tuần vừa rồi")?.variant, "standard");
});

test("reads «báo cáo tuần này» / «báo cáo tuần kỳ này» as the current (unfinished) period", () => {
  const thisWeek = parseBriefCommand("báo cáo tuần này");
  assert.equal(thisWeek?.request, "weekly");
  assert.equal(thisWeek?.variant, "current");
  assert.equal(parseBriefCommand("báo cáo tuần kỳ này")?.variant, "current");
});

test("reads «báo cáo tháng» / «bc tháng» the same way as weekly", () => {
  assert.deepEqual(parseBriefCommand("báo cáo tháng"), { kind: "brief_request", request: "monthly", variant: "standard" });
  const thisMonth = parseBriefCommand("bc tháng này");
  assert.equal(thisMonth?.request, "monthly");
  assert.equal(thisMonth?.variant, "current");
});

test("accepts the documented prefixes and suffixes", () => {
  assert.equal(parseBriefCommand("gửi anh báo cáo tuần nhé")?.request, "weekly");
  assert.equal(parseBriefCommand("cho em xem bản tin sáng")?.request, "morning");
  assert.equal(parseBriefCommand("xem báo cáo tháng")?.request, "monthly");
  assert.equal(parseBriefCommand("lấy bản tin cuối ngày giúp anh")?.request, "evening");
  assert.equal(parseBriefCommand("làm báo cáo tuần trước nha")?.request, "weekly");
});

test("does not swallow a longer report request meant for the AI export_report tool", () => {
  assert.equal(parseBriefCommand("báo cáo tuần doanh số đại lý A ra Excel"), null);
  assert.equal(parseBriefCommand("xuất báo cáo tháng ra file Excel cho em"), null);
  assert.equal(parseBriefCommand("báo cáo tuần của nhóm Bán hàng"), null);
});

test("does not match ordinary sentences that merely mention «bản tin» / «báo cáo»", () => {
  assert.equal(parseBriefCommand("bản tin này hay quá anh ạ"), null);
  assert.equal(parseBriefCommand("hôm qua bản tin sáng có đúng không"), null);
  assert.equal(parseBriefCommand("báo cáo tuần sau anh gửi nhé"), null);
  assert.equal(parseBriefCommand("em thấy báo cáo rồi"), null);
});

test("does not collide with ticket / task commands", () => {
  assert.equal(parseBriefCommand("báo lỗi: bản tin sáng gửi sai số liệu"), null);
  assert.equal(parseBriefCommand("việc báo cáo tuần"), null);
  assert.equal(parseBriefCommand("xong V-12"), null);
});

test("rejects empty input and input far longer than a short phrase", () => {
  assert.equal(parseBriefCommand(""), null);
  assert.equal(parseBriefCommand("   "), null);
  assert.equal(parseBriefCommand(`báo cáo tuần ${"a".repeat(80)}`), null);
});
