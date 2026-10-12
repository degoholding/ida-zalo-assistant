import assert from "node:assert/strict";
import { test } from "node:test";
import { SendCommandSource, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";
import { formatPreview, formatRequesterList, formatResultReport, formatSendTime } from "./send-command-preview.js";
import type { SendCommandRow, SendTargetRow } from "./send-command-types.js";

const base = {
  id: 12, scheduledAt: null, offHoursNote: "", body: "Mai họp 9h", attachmentNames: [],
  targets: [{ kind: SendTargetKind.Group, displayName: "Kho HN", secret: false }, { kind: SendTargetKind.Person, displayName: "Minh", secret: false }],
};

test("giờ VN: 13/10/2026 01:00 UTC = 08:00 T3 13/10", () => {
  assert.equal(formatSendTime(new Date("2026-10-13T01:00:00Z")), "08:00 T3 13/10");
});

test("xem trước gửi ngay: mã, danh sách đánh số, nội dung trong «…», dòng xác nhận 15 phút", () => {
  const text = formatPreview(base);
  assert.match(text, /LỆNH GỬI G-12/);
  assert.match(text, /1\. Nhóm «Kho HN» \(nội bộ\)/);
  assert.match(text, /2\. Anh\/chị Minh \(nhân sự\)/);
  assert.match(text, /Giờ gửi: ngay/);
  assert.match(text, /Nội dung: «Mai họp 9h»/);
  assert.match(text, /Nhắn «đồng ý» trong 15 phút để gửi, «hủy» để bỏ\./);
  assert.doesNotMatch(text, /Lưu ý|Tệp kèm/);
});

test("xem trước hẹn giờ: có giờ, cảnh báo giờ yên lặng, nhóm Mật, tệp kèm", () => {
  const text = formatPreview({
    ...base, scheduledAt: new Date("2026-10-18T01:00:00Z"), offHoursNote: "Giờ gửi rơi vào ngày nghỉ.",
    attachmentNames: ["bang-gia.pdf", "anh.png"], targets: [{ kind: SendTargetKind.Group, displayName: "Ban lãnh đạo", secret: true }],
  });
  assert.match(text, /Giờ gửi: 08:00 CN 18\/10/);
  assert.match(text, /Lưu ý: Giờ gửi rơi vào ngày nghỉ\./);
  assert.match(text, /Tệp kèm: 2 \(bang-gia\.pdf, anh\.png\)/);
  assert.match(text, /\(nội bộ, Mật\)/);
});

test("nội dung dài hơn 1.500 ký tự bị cắt kèm số ký tự còn lại; nội dung rỗng ghi «chỉ gửi tệp»", () => {
  const text = formatPreview({ ...base, body: "x".repeat(1800) });
  assert.match(text, /\(… còn 300 ký tự\)/);
  assert.match(formatPreview({ ...base, body: "", attachmentNames: ["a.pdf"] }), /\(chỉ gửi tệp\)/);
});

const command = (over: Partial<SendCommandRow> = {}): SendCommandRow => ({
  id: 12, tenantId: 1, source: SendCommandSource.Zalo, status: SendCommandStatus.Scheduled, requesterContactId: 1, requesterUid: "u1",
  requesterName: "A", createdByUserId: null, botAccountId: 1, sourceThreadId: 5, sourceMessageId: 9, body: "Mai họp 9h", attachmentIds: [],
  scheduledAt: new Date("2026-10-13T01:00:00Z"), offHoursNote: "", confirmExpiresAt: null, confirmedAt: null, cancelledAt: null,
  cancelledBy: "", reportedAt: null, createdAt: new Date(), ...over,
});
const target = (id: number, kind: SendTargetKind, name: string, status: SendTargetStatus, error = ""): SendTargetRow => ({
  id, commandId: 12, kind, key: `k${id}`, threadId: id, zaloUid: null, displayName: name, status, attemptNo: 1, jobId: null, error, sentAt: null,
});

test("báo kết quả: đếm nơi thành công, nêu lỗi từng nơi và lối gửi lại", () => {
  const text = formatResultReport(command(), [
    target(1, SendTargetKind.Group, "Kho HN", SendTargetStatus.Sent),
    target(2, SendTargetKind.Person, "Minh", SendTargetStatus.Failed, "bot đang tắt khẩn"),
    target(3, SendTargetKind.Group, "Kế toán", SendTargetStatus.Sent),
  ]);
  assert.match(text, /KẾT QUẢ LỆNH G-12: 2\/3 nơi thành công/);
  assert.match(text, /2\. anh\/chị Minh: LỖI — bot đang tắt khẩn/);
  assert.match(text, /màn Gửi tin/);
  assert.doesNotMatch(formatResultReport(command(), [target(1, SendTargetKind.Group, "Kho HN", SendTargetStatus.Sent)]), /màn Gửi tin/);
});

test("danh sách lệnh: đang hẹn + gần đây; rỗng thì báo chưa có", () => {
  assert.equal(formatRequesterList([], []), "Anh/chị chưa có lệnh gửi nào.");
  const text = formatRequesterList([{ command: command(), targetCount: 3 }], [{ command: command({ id: 11, status: SendCommandStatus.Done, scheduledAt: null }), targetCount: 1 }]);
  assert.match(text, /- G-12 · đang hẹn · 08:00 T3 13\/10 · 3 nơi · «Mai họp 9h»/);
  assert.match(text, /- G-11 · đã xong · 1 nơi/);
});
