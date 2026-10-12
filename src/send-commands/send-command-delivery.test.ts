import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SendCommandSource, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";
import { buildDeliveryPayload } from "./send-command-delivery.js";
import type { SendCommandRow, SendTargetRow } from "./send-command-types.js";

// Lượt thử lại dựng payload giao MỚI từ lệnh + payload job đã lưu — phải mang theo ĐỦ tiến độ deliverContactMessage ghi, nếu
// không phần đã gửi (chữ / tệp đính kèm / tệp báo cáo) bị gửi lặp.

const command = {
  id: 12, source: SendCommandSource.Zalo, status: SendCommandStatus.Sending, body: "Chiều nay 3h họp kho", attachmentIds: [5, 6],
} as SendCommandRow;
const groupTarget = {
  id: 7, commandId: 12, kind: SendTargetKind.Group, key: "g:40", threadId: 40, zaloUid: null, displayName: "Kho HN", status: SendTargetStatus.Queued,
} as SendTargetRow;

describe("buildDeliveryPayload", () => {
  test("lượt đầu: nội dung nguyên văn + tệp, chưa có tiến độ", () => {
    const payload = buildDeliveryPayload(command, groupTarget, { targetId: 7 });
    assert.equal(payload.threadId, 40);
    assert.equal(payload.text, "Chiều nay 3h họp kho");
    assert.deepEqual(payload.attachmentIds, [5, 6]);
    assert.equal(payload.textSent, undefined);
    assert.equal(payload.sentAttachmentCount, undefined);
  });

  test("thử lại: giữ textSent + sentAttachmentCount + sentFileCount từ payload job", () => {
    const payload = buildDeliveryPayload(command, groupTarget, { targetId: 7, textSent: true, sentAttachmentCount: 1, sentFileCount: 0 });
    assert.equal(payload.textSent, true);
    assert.equal(payload.sentAttachmentCount, 1);
    assert.equal(payload.sentFileCount, 0);
  });

  test("người chưa có cuộc riêng: giao theo mã Zalo", () => {
    const person = { ...groupTarget, kind: SendTargetKind.Person, key: "u:z-1", threadId: null, zaloUid: "z-1", displayName: "Minh" } as SendTargetRow;
    const payload = buildDeliveryPayload(command, person, null);
    assert.equal(payload.threadId, undefined);
    assert.equal(payload.zaloUid, "z-1");
    assert.equal(payload.name, "Minh");
  });
});
