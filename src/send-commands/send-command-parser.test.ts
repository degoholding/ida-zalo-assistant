import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSendCommand, type SendChatCommand } from "./send-command-parser.js";

const draft = (command: SendChatCommand | null) => {
  assert.equal(command?.kind, "send_draft");
  return command as Extract<SendChatCommand, { kind: "send_draft" }>;
};

test("gửi một nhóm: tách đầu / nội dung ở dấu «:» đầu tiên, giữ nguyên hoa thường và xuống dòng", () => {
  const command = draft(parseSendCommand("Gửi nhóm Kho HN: Mai họp 9h: mang BÁO CÁO\nđầy đủ"));
  assert.deepEqual(command.targetNames, ["nhóm Kho HN"]);
  assert.equal(command.body, "Mai họp 9h: mang BÁO CÁO\nđầy đủ");
  assert.equal(command.scheduleText, "");
  assert.equal(command.withRecentFiles, false);
});

test("nhiều nơi nhận: tách bằng «,» «;» «và» «với» «+»", () => {
  assert.deepEqual(draft(parseSendCommand("gửi nhóm A, anh Minh: ok")).targetNames, ["nhóm A", "anh Minh"]);
  assert.deepEqual(draft(parseSendCommand("gửi cho nhóm A và nhóm B với chị Lan; em Hùng + anh Nam: ok")).targetNames,
    ["nhóm A", "nhóm B", "chị Lan", "em Hùng", "anh Nam"]);
});

test("không dấu và có «/gui», «nhắn», «tin nhắn», «vào / tới / sang»", () => {
  assert.deepEqual(draft(parseSendCommand("/gui nhom Kho HN: hello")).targetNames, ["nhom Kho HN"]);
  assert.deepEqual(draft(parseSendCommand("nhắn tin tới anh Minh: hello")).targetNames, ["anh Minh"]);
  assert.deepEqual(draft(parseSendCommand("gui tin vao nhom A: hello")).targetNames, ["nhom A"]);
});

test("giờ hẹn đứng cuối: «lúc 8h sáng mai», «vào lúc 17h», kèm ngày đứng trước «lúc»", () => {
  const first = draft(parseSendCommand("gửi nhóm Kho HN, anh Minh lúc 8h sáng mai: họp"));
  assert.deepEqual(first.targetNames, ["nhóm Kho HN", "anh Minh"]);
  assert.equal(first.scheduleText, "8h sáng mai");
  assert.equal(draft(parseSendCommand("hẹn giờ gửi nhóm A vào lúc 17h30: x")).scheduleText, "17h30");
  const withDay = draft(parseSendCommand("gửi nhóm A thứ 6 lúc 9h: x"));
  assert.deepEqual(withDay.targetNames, ["nhóm A"]);
  assert.equal(withDay.scheduleText, "thứ 6 9h");
});

test("giờ đứng đầu: «8h sáng mai gửi nhóm A»", () => {
  const command = draft(parseSendCommand("8h sáng mai gửi nhóm A: họp"));
  assert.deepEqual(command.targetNames, ["nhóm A"]);
  assert.equal(command.scheduleText, "8h sáng mai");
});

test("giờ có dấu «:» (8:30) không bị nhận là dấu tách đầu / nội dung", () => {
  const command = draft(parseSendCommand("gửi nhóm A lúc 8:30 mai: họp"));
  assert.deepEqual(command.targetNames, ["nhóm A"]);
  assert.equal(command.body, "họp");
  assert.match(command.scheduleText, /8:30/);
});

test("«cái này / file này / ảnh này» bật cờ gửi kèm tệp, nội dung được trống", () => {
  const command = draft(parseSendCommand("gửi cái này vào nhóm A: xem giúp"));
  assert.equal(command.withRecentFiles, true);
  assert.deepEqual(command.targetNames, ["nhóm A"]);
  const emptyBody = draft(parseSendCommand("gửi file này cho anh Minh:"));
  assert.equal(emptyBody.withRecentFiles, true);
  assert.equal(emptyBody.body, "");
  assert.equal(draft(parseSendCommand("gửi tin vào nhóm A: hi")).withRecentFiles, false);
});

test("«lệnh gửi», «lệnh hẹn», «nhật ký gửi», «/hengio» là danh sách", () => {
  for (const text of ["lệnh gửi", "Lệnh hẹn", "lenh gui dang hen", "nhật ký gửi", "/hengio", "/nhatky", "lệnh gửi."]) {
    assert.deepEqual(parseSendCommand(text), { kind: "send_list" }, text);
  }
});

test("hủy lệnh có mã: «hủy G-12», «hủy lệnh G-12», «/huy G-12», «hủy lệnh G12»", () => {
  assert.deepEqual(parseSendCommand("hủy G-12"), { kind: "send_cancel", commandId: 12 });
  assert.deepEqual(parseSendCommand("huy lenh g-7"), { kind: "send_cancel", commandId: 7 });
  assert.deepEqual(parseSendCommand("/huy G-12"), { kind: "send_cancel", commandId: 12 });
  assert.deepEqual(parseSendCommand("hủy lệnh G12"), { kind: "send_cancel", commandId: 12 });
});

test("xác nhận có mã: «đồng ý G-12», «gửi G-12»", () => {
  assert.deepEqual(parseSendCommand("đồng ý G-12"), { kind: "send_confirm", commandId: 12 });
  assert.deepEqual(parseSendCommand("gửi g-3"), { kind: "send_confirm", commandId: 3 });
});

test("KHÔNG khớp: câu thường, lệnh việc / ticket, mã trần không gạch nối, thiếu «:»", () => {
  const negatives = [
    "giao Minh: làm báo giá", "báo lỗi: máy in hỏng", "gửi anh báo cáo tuần", "hủy", "đồng ý", "hủy g12", "gửi g3",
    "cảm ơn: nhé", "xin chào", "gửi nhóm A", "hôm nay: gửi nhóm A", "", "   ", "việc",
  ];
  for (const text of negatives) assert.equal(parseSendCommand(text), null, text);
});

test("đầu quá dài hoặc không có tên nơi nhận thì null", () => {
  assert.equal(parseSendCommand(`gửi ${"a".repeat(400)}: x`), null);
  assert.equal(parseSendCommand("gửi : x"), null);
  assert.equal(parseSendCommand("gửi vào: x"), null);
});

test("nội dung dài và nội dung có nhiều dấu «:» giữ nguyên văn", () => {
  const body = "Link: https://x.vn/a:b — 10:30 xong";
  assert.equal(draft(parseSendCommand(`gửi nhóm A: ${body}`)).body, body);
});
