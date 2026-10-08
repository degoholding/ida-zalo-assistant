import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactKind, FlagSource, GroupKind, MessagePriority } from "../constants.js";
import { classifyMessage, looksLikeQuestion, type ClassifyContext, type ClassifyInput } from "./classifier.js";
import { parseKeywordList } from "./keyword-matcher.js";

const context: ClassifyContext = {
  keywords: { urgent: parseKeywordList("gấp, khiếu nại, cháy lá"), important: parseKeywordList("công nợ, hóa đơn"), strict: parseKeywordList("la, liền, ngay") },
  recipientUids: new Set(["u-truong-phong", "u-ceo"]),
  vipUids: new Set(["u-vip"]),
  botUids: new Set(["u-bot"]),
};

const input = (overrides: Partial<ClassifyInput>): ClassifyInput => ({
  text: "", senderUid: "u-nv", senderKind: ContactKind.Staff, groupKind: GroupKind.Internal, mentionUids: [], quoteOwnerUid: null, ...overrides,
});

test("an urgent keyword makes the message urgent with a readable reason", () => {
  const decision = classifyMessage(input({ text: "Đại lý khiếu nại cháy lá, xử lý gấp" }), context);
  assert.equal(decision?.priority, MessagePriority.Urgent);
  assert.equal(decision?.pendingAi, false);
  assert.match(decision!.reason, /«khiếu nại»/);
});

test("a VIP message is important and waits on the short VIP clock, but a recipient is never treated as VIP of themselves", () => {
  const vip = classifyMessage(input({ senderUid: "u-vip", text: "Em gửi số liệu" }), context);
  assert.deepEqual([vip?.priority, vip?.wait, vip?.source], [MessagePriority.Important, "vip", FlagSource.Vip]);
  const vipRecipient = classifyMessage(input({ senderUid: "u-ceo", text: "Ok" }), { ...context, vipUids: new Set(["u-ceo"]) });
  assert.equal(vipRecipient, null);
});

test("mentioning or replying to a recipient starts their reply clock, addressed to them only", () => {
  const mention = classifyMessage(input({ text: "@Anh Phong duyệt giúp em", mentionUids: ["u-truong-phong"] }), context);
  assert.deepEqual([mention?.wait, mention?.forUid, mention?.source], ["normal", "u-truong-phong", FlagSource.Mention]);
  const reply = classifyMessage(input({ text: "dạ để em xem", quoteOwnerUid: "u-ceo" }), context);
  assert.equal(reply?.forUid, "u-ceo");
  // Người nhận tự trả lời vào tin của chính mình: không tính
  assert.equal(classifyMessage(input({ senderUid: "u-ceo", text: "bổ sung", quoteOwnerUid: "u-ceo" }), context), null);
});

test("strict words only make an AI candidate, never an alert by themselves", () => {
  const decision = classifyMessage(input({ text: "Khách la quá trời luôn" }), context);
  assert.equal(decision?.priority, MessagePriority.Normal);
  assert.equal(decision?.pendingAi, true);
  // Đã khẩn vì từ khóa khác thì không cần AI nữa
  assert.equal(classifyMessage(input({ text: "Khách la, khiếu nại gấp" }), context)?.pendingAi, false);
});

test("a customer question in a customer group waits for an answer; the same from staff or in an internal group does not", () => {
  const customer = classifyMessage(input({ text: "Đơn hàng em giao chưa vậy?", senderKind: ContactKind.Customer, groupKind: GroupKind.Customer }), context);
  assert.equal(customer?.wait, "normal");
  assert.equal(classifyMessage(input({ text: "Đơn hàng giao chưa?", groupKind: GroupKind.Customer }), context), null);
  assert.equal(classifyMessage(input({ text: "Đơn hàng giao chưa?", senderKind: ContactKind.Customer }), context), null);
});

test("plain chatter, the bot's own messages and empty text are not flagged", () => {
  assert.equal(classifyMessage(input({ text: "Chiều nay gặp anh ở gian hàng nhé" }), context), null);
  assert.equal(classifyMessage(input({ senderUid: "u-bot", text: "khiếu nại gấp" }), context), null);
  assert.equal(classifyMessage(input({ text: "   " }), context), null);
});

test("question detection", () => {
  assert.equal(looksLikeQuestion("Có hàng không"), true);
  assert.equal(looksLikeQuestion("bao giờ giao vậy?"), true);
  assert.equal(looksLikeQuestion("Em gửi rồi nhé"), false);
});
