import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildNoFakeActionPrompt } from "./no-fake-action-prompt.js";

describe("buildNoFakeActionPrompt", () => {
  test("mọi nơi: chỉ nói «đã làm» khi công cụ vừa thành công trong lượt, không gọi create_meeting lần hai", () => {
    for (const options of [{ inGroup: false, canProposeReminder: true }, { inGroup: false, canProposeReminder: false }, { inGroup: true, canProposeReminder: false }]) {
      const text = buildNoFakeActionPrompt(options);
      assert.match(text, /VỪA trả kết quả thành công TRONG CHÍNH LƯỢT NÀY/);
      assert.match(text, /không có công cụ phù hợp|KHÔNG có công cụ phù hợp/);
      assert.match(text, /create_meeting lần hai/);
      assert.match(text, /NHẮC HẸN cho cuộc họp đó/);
    }
  });

  test("tin riêng có công cụ: chỉ propose_group_reminder; ghim / bình chọn / hủy nhắc hẹn → gọi em trong nhóm đó", () => {
    const text = buildNoFakeActionPrompt({ inGroup: false, canProposeReminder: true });
    assert.match(text, /propose_group_reminder/);
    assert.match(text, /gọi em trong nhóm đó/);
    assert.match(text, /Ghim ghi chú, tạo bình chọn, xem \/ hủy nhắc hẹn/);
  });

  test("tin riêng không có công cụ: nhắc hẹn nhóm cũng bảo gọi em trong nhóm", () => {
    const text = buildNoFakeActionPrompt({ inGroup: false, canProposeReminder: false });
    assert.doesNotMatch(text, /propose_group_reminder/);
    assert.match(text, /gọi em ngay trong nhóm đó/);
  });

  test("trong nhóm: chỉ làm việc của chính nhóm, không có chỉ dẫn tin riêng", () => {
    const text = buildNoFakeActionPrompt({ inGroup: true, canProposeReminder: false });
    assert.match(text, /CHÍNH nhóm này/);
    assert.doesNotMatch(text, /gọi em trong nhóm đó/);
  });
});

describe("buildNoFakeActionPrompt — lời mời họp", () => {
  test("tin riêng có công cụ: dùng propose_meeting_announcement, không bảo tự dán link", () => {
    const text = buildNoFakeActionPrompt({ inGroup: false, canProposeReminder: true, canAnnounceMeeting: true });
    assert.match(text, /propose_meeting_announcement/);
    assert.match(text, /KHÔNG bảo người hỏi tự dán link/);
  });

  test("không có công cụ: không nhắc tên công cụ", () => {
    assert.doesNotMatch(buildNoFakeActionPrompt({ inGroup: false, canProposeReminder: true }), /propose_meeting_announcement/);
    assert.doesNotMatch(buildNoFakeActionPrompt({ inGroup: true, canProposeReminder: false, canAnnounceMeeting: true }), /propose_meeting_announcement/);
  });
});
