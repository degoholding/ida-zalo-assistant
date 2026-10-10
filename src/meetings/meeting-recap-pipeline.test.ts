import assert from "node:assert/strict";
import { test } from "node:test";
import { dueAnchorFor } from "./meeting-recap-pipeline.js";

// M7 (review 10/10/2026): hạn «mai» / «thứ 6» nói TRONG họp phải tính từ giờ HỌP, không phải lúc xử lý — tệp tải trễ /
// bị hoãn trần token tới cả ngày sau mới gỡ băng thì vẫn phải ra đúng ngày người nói đã nói.

test("dueAnchorFor: có meetingStart thì dùng giờ họp", () => {
  const meetingStart = new Date("2026-10-10T02:00:00Z");
  const driveCreatedAt = new Date("2026-10-11T08:00:00Z"); // tải trễ 1 ngày
  assert.equal(dueAnchorFor({ meetingStart, driveCreatedAt }).getTime(), meetingStart.getTime());
});

test("dueAnchorFor: cuộc họp cũ không có meetingStart → lùi về driveCreatedAt (lúc Drive ghi nhận tệp)", () => {
  const driveCreatedAt = new Date("2026-10-11T08:00:00Z");
  assert.equal(dueAnchorFor({ meetingStart: null, driveCreatedAt }).getTime(), driveCreatedAt.getTime());
});
