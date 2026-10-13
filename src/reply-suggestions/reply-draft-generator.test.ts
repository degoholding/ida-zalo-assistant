import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelClient } from "../assistant/gemini-client.js";
import { ReplyTone } from "../constants.js";
import { buildDraftUserText, generateDrafts, parseDraftAnswer, ReplyGenerationError } from "./reply-draft-generator.js";
import { makeTemplate } from "./reply-template-fixture.js";

const json = (drafts: unknown[], id: unknown = 1) => JSON.stringify({ template_id: id, drafts });
const three = [{ tone: "formal", text: "A" }, { tone: "friendly", text: "B" }, { tone: "brief", text: "C" }];

test("parseDraftAnswer: JSON sạch → 3 bản theo thứ tự tông", () => {
  const parsed = parseDraftAnswer(json([three[2], three[0], three[1]]), [1, 2]);
  assert.equal(parsed?.templateId, 1);
  assert.deepEqual(parsed?.drafts.map((draft) => draft.tone), [ReplyTone.Formal, ReplyTone.Friendly, ReplyTone.Brief]);
});

test("parseDraftAnswer: bọc ```json ... ``` vẫn đọc được", () => {
  assert.equal(parseDraftAnswer("```json\n" + json(three) + "\n```", [1])?.drafts.length, 3);
});

test("parseDraftAnswer: id mẫu ngoài lô → null", () => {
  assert.equal(parseDraftAnswer(json(three, 99), [1, 2]), null);
  assert.equal(parseDraftAnswer(json(three, "abc"), [1, 2]), null);
});

test("parseDraftAnswer: thiếu template_id mà chỉ có 1 ứng viên → dùng ứng viên đó", () => {
  assert.equal(parseDraftAnswer(JSON.stringify({ drafts: three }), [7])?.templateId, 7);
  assert.equal(parseDraftAnswer(JSON.stringify({ drafts: three }), [7, 8]), null);
});

test("parseDraftAnswer: tông trùng → bỏ bản trùng; còn < 2 bản → null", () => {
  assert.equal(parseDraftAnswer(json([three[0], { tone: "formal", text: "X" }, three[1]]), [1])?.drafts.length, 2);
  assert.equal(parseDraftAnswer(json([three[0], { tone: "formal", text: "X" }]), [1]), null);
});

test("parseDraftAnswer: bản rỗng / quá 1.000 ký tự / tông lạ bị bỏ", () => {
  const drafts = [three[0], { tone: "friendly", text: "   " }, { tone: "brief", text: "x".repeat(1001) }, { tone: "weird", text: "Z" }];
  assert.equal(parseDraftAnswer(json(drafts), [1]), null);
});

test("parseDraftAnswer: không phải JSON → null", () => {
  assert.equal(parseDraftAnswer("xin lỗi tôi không làm được", [1]), null);
  assert.equal(parseDraftAnswer("{hỏng", [1]), null);
});

function fakeModel(answers: string[], calls: { count: number } = { count: 0 }): ModelClient {
  return {
    async generate() {
      const text = answers[Math.min(calls.count, answers.length - 1)];
      calls.count += 1;
      return { content: { role: "model", parts: [{ text }] }, inputTokens: 10, outputTokens: 5 };
    },
  };
}

const input = { candidates: [makeTemplate({ id: 1, name: "Báo giá" })], question: "trả lời tin giá", source: null };

test("generateDrafts: sai khuôn lần 1, đúng lần 2 → trả bản nháp, cộng token cả hai lần", async () => {
  const calls = { count: 0 };
  const usage = { inputTokens: 0, outputTokens: 0 };
  const parsed = await generateDrafts({ model: fakeModel(["không phải json", json(three)], calls), usage }, input);
  assert.equal(parsed.drafts.length, 3);
  assert.equal(calls.count, 2);
  assert.deepEqual(usage, { inputTokens: 20, outputTokens: 10 });
});

test("generateDrafts: sai khuôn hai lần → ReplyGenerationError", async () => {
  await assert.rejects(generateDrafts({ model: fakeModel(["x"]) }, input), ReplyGenerationError);
});

test("generateDrafts: mô hình ném lỗi → ReplyGenerationError", async () => {
  const model: ModelClient = { async generate() { throw new Error("503"); } };
  await assert.rejects(generateDrafts({ model }, input), ReplyGenerationError);
});

test("buildDraftUserText: có ứng viên, tin gốc, ngữ cảnh, câu hỏi", () => {
  const text = buildDraftUserText({
    ...input,
    source: { messageId: 5, groupName: "Nhóm ĐL", senderName: "anh Sáu", sentAt: new Date(0), text: "Flowertop giá sao em",
      context: [{ senderName: "em", sentAt: new Date(0), text: "chào anh" }] },
  });
  for (const part of ["#1 «Báo giá»", "Flowertop giá sao em", "(trước đó) em: chào anh", "YÊU CẦU CỦA NHÂN VIÊN: trả lời tin giá"]) assert.ok(text.includes(part), part);
});
