import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SendActionKind, SendCommandSource, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";
import { formatRequesterList } from "./send-command-preview.js";
import type { SendCommandRow, SendTargetRow } from "./send-command-types.js";
import { formatReminderPreview, formatReminderResultReport } from "./send-reminder-preview.js";

const input = {
  id: 21, title: "Họp giao ban tuần", reminderAt: new Date("2026-10-13T01:00:00Z"), repeat: 2 as const, offHoursNote: "",
  targets: [{ displayName: "Kho HN", secret: false }, { displayName: "Ban lãnh đạo", secret: true }],
};

describe("formatReminderPreview", () => {
  test("tiêu đề, nhóm đánh số, giờ nhắc VN, lặp, nội dung nguyên văn, dòng xác nhận 15 phút", () => {
    const text = formatReminderPreview(input);
    assert.match(text, /^XEM TRƯỚC NHẮC HẸN G-21/);
    assert.match(text, /Tạo nhắc hẹn Zalo cho 2 nhóm:/);
    assert.match(text, /1\. Nhóm «Kho HN» \(nội bộ\)/);
    assert.match(text, /2\. Nhóm «Ban lãnh đạo» \(nội bộ, Mật\)/);
    assert.match(text, /Nhắc lúc: 08:00 T3 13\/10/);
    assert.match(text, /Lặp: hằng tuần/);
    assert.match(text, /Nội dung nhắc: «Họp giao ban tuần»/);
    assert.match(text, /Nhắn «đồng ý» trong 15 phút để tạo, «hủy» để bỏ\./);
    assert.doesNotMatch(text, /Lưu ý/);
  });

  test("cảnh báo giờ yên lặng / ngày nghỉ hiện thành dòng Lưu ý; không lặp ghi «không lặp»", () => {
    const text = formatReminderPreview({ ...input, repeat: 0, offHoursNote: "Giờ nhắc rơi vào ngày nghỉ." });
    assert.match(text, /Lưu ý: Giờ nhắc rơi vào ngày nghỉ\./);
    assert.match(text, /Lặp: không lặp/);
  });
});

describe("formatReminderResultReport", () => {
  const target = (status: SendTargetStatus, name: string, error = ""): SendTargetRow =>
    ({ id: 1, commandId: 21, kind: SendTargetKind.Group, key: "g:1", threadId: 1, zaloUid: null, displayName: name, status, attemptNo: 1, jobId: null, error, sentAt: null });

  test("đếm nhóm thành công, từng dòng, nhắc gửi lại khi có lỗi", () => {
    const text = formatReminderResultReport({ id: 21 }, [target(SendTargetStatus.Sent, "Kho HN"), target(SendTargetStatus.Failed, "Kho HCM", "bot tắt khẩn")]);
    assert.match(text, /^KẾT QUẢ NHẮC HẸN G-21: 1\/2 nhóm thành công/);
    assert.match(text, /1\. nhóm «Kho HN»: đã tạo nhắc hẹn/);
    assert.match(text, /2\. nhóm «Kho HCM»: LỖI — bot tắt khẩn/);
    assert.match(text, /Gửi lại nơi lỗi ở màn Gửi tin/);
  });

  test("tất cả thành công thì không có dòng gửi lại", () => {
    assert.doesNotMatch(formatReminderResultReport({ id: 3 }, [target(SendTargetStatus.Sent, "A")]), /Gửi lại/);
  });
});

describe("formatRequesterList", () => {
  test("lệnh nhắc hẹn ghi rõ «nhắc hẹn» và giờ nhắc", () => {
    const command = {
      id: 21, source: SendCommandSource.Zalo, status: SendCommandStatus.Sending, actionKind: SendActionKind.Reminder,
      reminderAt: new Date("2026-10-13T01:00:00Z"), scheduledAt: null, body: "Họp giao ban tuần",
    } as SendCommandRow;
    assert.match(formatRequesterList([], [{ command, targetCount: 2 }]), /G-21 · đang gửi · nhắc hẹn · 08:00 T3 13\/10 · 2 nơi/);
  });
});
