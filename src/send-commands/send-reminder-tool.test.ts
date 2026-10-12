import assert from "node:assert/strict";
import { test } from "node:test";
import { PROPOSE_REMINDER_DECLARATION, REMINDER_TOOL_PROMPT, runProposeReminderTool } from "./send-reminder-tool.js";

// Các nhánh chặn của công cụ propose_group_reminder không cần DB: thiếu ngữ cảnh / không đủ quyền / thiếu tham số.

const chatOf = (requester: unknown) => ({ deps: {} as never, requester: requester as never, uid: "u", name: "n", question: "q", sourceThreadId: 1 });
const ARGS = { groups: ["Kho"], title: "Họp", start_time: "2026-10-13T08:00:00+07:00" };

test("khai báo công cụ: bắt buộc groups / title / start_time, repeat là enum bốn giá trị", () => {
  assert.equal(PROPOSE_REMINDER_DECLARATION.name, "propose_group_reminder");
  const parameters = PROPOSE_REMINDER_DECLARATION.parameters as { required: string[]; properties: { repeat: { enum: string[] } } };
  assert.deepEqual(parameters.required, ["groups", "title", "start_time"]);
  assert.deepEqual(parameters.properties.repeat.enum, ["none", "daily", "weekly", "monthly"]);
  assert.match(REMINDER_TOOL_PROMPT, /KHÔNG tạo thêm cuộc họp/);
});

test("không có ngữ cảnh gửi: báo lỗi, không chốt câu trả lời", async () => {
  const outcome = await runProposeReminderTool(undefined, ARGS, new Date());
  assert.match(String(outcome.response.error), /tin riêng/);
  assert.equal(outcome.fixedReply, undefined);
});

test("người hỏi không đủ quyền: câu trả lời của lượt bị thay bằng lời từ chối", async () => {
  const outcome = await runProposeReminderTool(chatOf(null), ARGS, new Date());
  assert.match(outcome.fixedReply ?? "", /chỉ dành cho/);
});

test("thiếu nhóm / nội dung / giờ: trả lỗi cho mô hình để hỏi lại, KHÔNG chốt câu trả lời", async () => {
  const chat = chatOf({ uid: "u", name: "n", role: 1, recipientId: 1 });
  for (const args of [{ ...ARGS, groups: [] }, { ...ARGS, title: " " }, { ...ARGS, start_time: "" }, { groups: "Kho", title: "x", start_time: "y" }]) {
    const outcome = await runProposeReminderTool(chat, args, new Date());
    assert.ok(outcome.response.error, JSON.stringify(args));
    assert.equal(outcome.fixedReply, undefined);
  }
});
