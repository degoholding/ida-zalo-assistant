import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactKind, ContactRole, GroupKind } from "../constants.js";
import { EMPTY_CALL_QUESTION, canCallBotInGroup, detectGroupTrigger, foldForMatch } from "./group-trigger.js";

test("canCallBotInGroup: nhóm nội bộ thì ai cũng gọi được, kể cả khách hàng / chưa phân loại / tắt cài đặt nhân sự", () => {
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Customer }, false, GroupKind.Internal), true);
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Unclassified }, false, GroupKind.Internal), true);
  // Nhóm khách hàng (và lời gọi cũ không truyền loại nhóm) giữ luật cũ
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Customer }, true, GroupKind.Customer), false);
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Customer }, true), false);
});

test("canCallBotInGroup: nhân sự / có vai trò gọi được, khách hàng thì không", () => {
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Staff }, true), true);
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Staff }, false), false);
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Customer }, true), false);
  assert.equal(canCallBotInGroup({ role: ContactRole.None, kind: ContactKind.Unclassified }, true), false);
  assert.equal(canCallBotInGroup({ role: ContactRole.Manager, kind: ContactKind.Customer }, true), true);
});

const KEYWORDS = ["bot", "bot ơi", "trợ lý ơi", "@bot"];
const detect = (text: string, mentions: { uid: string; pos: number; len: number }[] | null = null, keywords = KEYWORDS) =>
  detectGroupTrigger({ text, mentions, botUid: "bot-uid", keywords });

test("an @mention of the bot triggers and is removed from the question", () => {
  const text = "@Bảo Huỳnh recap cái báo cáo tiến độ giúp tao";
  assert.deepEqual(detect(text, [{ uid: "bot-uid", pos: 0, len: 10 }]), { question: "recap cái báo cáo tiến độ giúp tao", via: "mention" });
});

test("replying to one of the bot's messages calls the bot without a keyword", () => {
  assert.deepEqual(detectGroupTrigger({ text: "chi tiết báo cáo đó", mentions: null, botUid: "bot-uid", keywords: KEYWORDS, quotedUid: "bot-uid" }),
    { question: "chi tiết báo cáo đó", via: "reply" });
  assert.equal(detectGroupTrigger({ text: "chi tiết báo cáo đó", mentions: null, botUid: "bot-uid", keywords: KEYWORDS, quotedUid: "other" }), null);
  assert.equal(detectGroupTrigger({ text: "chi tiết báo cáo đó", mentions: null, botUid: "bot-uid", keywords: KEYWORDS, quotedUid: "" }), null);
});

test("mentioning someone else does not trigger", () => {
  assert.equal(detect("@Gia Bảo recap giúp anh", [{ uid: "other-uid", pos: 0, len: 8 }]), null);
});

test("keywords match regardless of case and Vietnamese accents", () => {
  assert.deepEqual(detect("Bot ơi, tóm tắt nhóm hôm nay"), { question: "tóm tắt nhóm hôm nay", via: "keyword" });
  assert.deepEqual(detect("BOT OI tóm tắt nhóm"), { question: "tóm tắt nhóm", via: "keyword" });
  assert.deepEqual(detect("cho anh hỏi, trợ lý ơi: còn việc gì treo?"), { question: "cho anh hỏi, còn việc gì treo?", via: "keyword" });
  assert.deepEqual(detect("@bot recap file báo giá"), { question: "recap file báo giá", via: "keyword" });
});

test("a one-word keyword calls the bot anywhere in the message as a whole word", () => {
  assert.deepEqual(detect("bot recap báo cáo cho tao"), { question: "recap báo cáo cho tao", via: "keyword" });
  assert.deepEqual(detect("Bot, tóm tắt nhóm"), { question: "tóm tắt nhóm", via: "keyword" });
  assert.deepEqual(detect("  BOT: còn việc gì treo?"), { question: "còn việc gì treo?", via: "keyword" });
  // Chốt 06/10/2026: tin có chữ «bot» ở bất kỳ đâu là gọi bot; giữa / cuối câu thì giữ nguyên câu
  assert.deepEqual(detect("cho anh hỏi bot còn việc gì treo"), { question: "cho anh hỏi bot còn việc gì treo", via: "keyword" });
  assert.deepEqual(detect("tóm tắt nhóm giúp anh nha bot"), { question: "tóm tắt nhóm giúp anh nha bot", via: "keyword" });
  // Gặp 06/10/2026: «hey bot» không gọi được bot — cho phép một câu chào ngắn đứng trước
  assert.deepEqual(detect("hey bot"), { question: EMPTY_CALL_QUESTION, via: "keyword" });
  assert.deepEqual(detect("ê bot tóm tắt nhóm"), { question: "tóm tắt nhóm", via: "keyword" });
  assert.deepEqual(detect("Chào bot, còn việc gì treo?"), { question: "còn việc gì treo?", via: "keyword" });
  assert.deepEqual(detect("alo bot"), { question: EMPTY_CALL_QUESTION, via: "keyword" });
  assert.deepEqual(detect("hey con bot"), { question: "hey con bot", via: "keyword" });
  // Từ khóa dài xét trước: «bot ơi …» bỏ cả «bot ơi», không chừa «ơi» trong câu hỏi
  assert.deepEqual(detect("bot ơi recap"), { question: "recap", via: "keyword" });
});

test("a keyword must be a whole word or phrase, not part of another word", () => {
  assert.equal(detect("robot hút bụi hỏng rồi"), null);
  assert.equal(detect("dùng chatbot khác đi"), null);
  assert.equal(detect("mã bot123 lỗi"), null);
  assert.equal(detect("robot ơi"), null);
  assert.equal(detect("bot ơii", null, ["bot ơi"]), null);
  assert.equal(detect("@botnet"), null);
});

test("ordinary messages and empty keyword lists do not trigger", () => {
  assert.equal(detect("chiều nay đổ bê tông tầng 6"), null);
  assert.equal(detect("bot ơi tóm tắt", null, []), null);
  assert.equal(detect("bot ơi tóm tắt", null, ["", " ", "x"]), null);
});

test("calling the bot without a question becomes a greeting", () => {
  assert.deepEqual(detect("bot ơi!!"), { question: EMPTY_CALL_QUESTION, via: "keyword" });
  assert.deepEqual(detect("@Bảo Huỳnh", [{ uid: "bot-uid", pos: 0, len: 10 }]), { question: EMPTY_CALL_QUESTION, via: "mention" });
});

test("mention positions beyond the text or with zero length are ignored safely", () => {
  assert.equal(detect("xin chào", [{ uid: "bot-uid", pos: 0, len: 0 }]), null);
  assert.deepEqual(detect("hi", [{ uid: "bot-uid", pos: 50, len: 5 }]), { question: "hi", via: "mention" });
});

test("folding keeps one character per input character so match positions map back", () => {
  for (const text of ["Bảo Huỳnh ĐƯỢC", "trợ lý ơi", "é tách dấu"]) {
    assert.equal(foldForMatch(text).length, Array.from(text).length);
  }
  assert.equal(foldForMatch("Đ Ơ Ư"), "d o u");
});

test("applyInternalGroupDefaults: chuyển sang nhóm nội bộ thì tự bật đọc, trừ khi nói rõ tắt", async () => {
  const { applyInternalGroupDefaults } = await import("../sync/group-repository.js");
  assert.deepEqual(applyInternalGroupDefaults({ groupKind: GroupKind.Internal }), { groupKind: GroupKind.Internal, readMessages: true });
  assert.deepEqual(applyInternalGroupDefaults({ groupKind: GroupKind.Internal, readMessages: false }),
    { groupKind: GroupKind.Internal, readMessages: false });
  assert.deepEqual(applyInternalGroupDefaults({ groupKind: GroupKind.Customer }), { groupKind: GroupKind.Customer });
  assert.deepEqual(applyInternalGroupDefaults({ label: "x" }), { label: "x" });
});
