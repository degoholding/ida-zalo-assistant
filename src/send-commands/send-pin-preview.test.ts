import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SendActionKind, SendCommandSource, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";
import { formatRequesterList } from "./send-command-preview.js";
import type { SendCommandRow, SendTargetRow } from "./send-command-types.js";
import { formatPinPreview, formatPinResultReport } from "./send-pin-preview.js";

const BODY = "Cuộc họp: Họp team bot\nLúc: 15:00 T2 12/10\nLink Google Meet: https://meet.google.com/abc-defg-hij";
const input = { id: 31, content: BODY, targets: [{ displayName: "Kho HN", secret: false }, { displayName: "Ban lãnh đạo", secret: true }] };

const target = (over: Partial<SendTargetRow>): SendTargetRow => ({
  id: 1, commandId: 31, kind: SendTargetKind.Group, key: "g:1", threadId: 1, zaloUid: null, displayName: "Kho HN", status: SendTargetStatus.Sent,
  attemptNo: 1, jobId: null, error: "", sentAt: null, ...over,
});

describe("formatPinPreview", () => {
  test("tiêu đề, nhóm đánh số (Mật), nội dung ghim NGUYÊN VĂN, dòng xác nhận 15 phút", () => {
    const text = formatPinPreview(input);
    assert.match(text, /^XEM TRƯỚC GHIM G-31\nGhim lên 2 nhóm:\n1\. Nhóm «Kho HN» \(nội bộ\)\n2\. Nhóm «Ban lãnh đạo» \(nội bộ, Mật\)/);
    assert.ok(text.includes(`Nội dung ghim: «${BODY}»`));
    assert.match(text, /Nhắn «đồng ý» trong 15 phút để ghim, «hủy» để bỏ\.$/);
  });
});

describe("formatPinResultReport", () => {
  test("x/k nhóm thành công, từng dòng «đã ghim» / «LỖI — …», gợi ý gửi lại khi có lỗi", () => {
    const text = formatPinResultReport({ id: 31 }, [target({}), target({ id: 2, displayName: "Kho HCM", status: SendTargetStatus.Failed, error: "bot đang tắt khẩn lúc tới giờ gửi" })]);
    assert.match(text, /^KẾT QUẢ GHIM G-31: 1\/2 nhóm thành công\n1\. nhóm «Kho HN»: đã ghim\n2\. nhóm «Kho HCM»: LỖI — bot đang tắt khẩn/);
    assert.match(text, /Gửi lại nơi lỗi ở màn Gửi tin trên web\./);
    assert.doesNotMatch(formatPinResultReport({ id: 31 }, [target({})]), /Gửi lại/);
  });
});

describe("«lệnh gửi»", () => {
  test("lệnh ghim có nhãn «ghim»", () => {
    const command = {
      id: 31, source: SendCommandSource.Zalo, status: SendCommandStatus.Done, actionKind: SendActionKind.Pin, body: BODY, scheduledAt: null, reminderAt: null,
    } as unknown as SendCommandRow;
    assert.match(formatRequesterList([], [{ command, targetCount: 2 }]), /G-31 · .* · ghim · 2 nơi · «Cuộc họp: Họp team bot/);
  });
});
