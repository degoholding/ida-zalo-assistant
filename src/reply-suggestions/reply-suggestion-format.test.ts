import assert from "node:assert/strict";
import { test } from "node:test";
import { ReplyTone } from "../constants.js";
import { formatNoTemplateReply, formatSourceTime, formatSuggestion } from "./reply-suggestion-format.js";
import type { GuardedDraft, SuggestionResult } from "./reply-suggestion-types.js";

const draft = (tone: ReplyTone, text: string, extra: Partial<GuardedDraft> = {}): GuardedDraft => ({ tone, text, replaced: 0, technical: 0, warnings: [], ...extra });

const result: SuggestionResult = {
  templateId: 1, templateName: "Báo giá sản phẩm", agro: false,
  // 02:12 UTC = 09:12 giờ VN, thứ Hai 12/10/2026
  source: { messageId: 1, groupName: "Nhóm ĐL Thành Công", senderName: "anh Sáu", sentAt: new Date("2026-10-12T02:12:00Z"), text: "Flowertop giá sao em", context: [] },
  drafts: [draft(ReplyTone.Formal, "Dạ bản 1"), draft(ReplyTone.Friendly, "Dạ bản 2", { replaced: 2, warnings: ["chiết khấu"] }), draft(ReplyTone.Brief, "Bản 3")],
};

test("formatSourceTime: giờ VN, thứ, ngày", () => {
  assert.equal(formatSourceTime(new Date("2026-10-12T02:12:00Z")), "09:12 T2 12/10");
});

test("formatSuggestion: header có tên mẫu, tin gốc, thứ tự tông, số chỗ cần bổ sung, lưu ý", () => {
  const { header, drafts } = formatSuggestion(result);
  assert.ok(header.startsWith("GỢI Ý TRẢ LỜI — theo mẫu «Báo giá sản phẩm»"));
  assert.ok(header.includes("Tin gốc: [Nhóm ĐL Thành Công · anh Sáu · 09:12 T2 12/10] «Flowertop giá sao em»"));
  assert.ok(header.includes("(1) lịch sự · (2) thân thiện · (3) ngắn gọn"));
  assert.ok(header.includes("Em KHÔNG gửi đi đâu."));
  assert.ok(header.includes("Chỗ «[cần bổ sung]» (2 chỗ)"));
  assert.ok(header.includes("Lưu ý: bản 2 có «chiết khấu» — mẫu không có, kiểm trước khi gửi."));
  assert.deepEqual(drafts, ["Dạ bản 1", "Dạ bản 2", "Bản 3"]);
});

test("formatSuggestion: không tin gốc → bỏ dòng; không chỗ trống → bỏ dòng cần bổ sung", () => {
  const { header } = formatSuggestion({ ...result, source: null, drafts: [draft(ReplyTone.Formal, "a"), draft(ReplyTone.Brief, "b")] });
  assert.ok(!header.includes("Tin gốc"));
  assert.ok(!header.includes("cần bổ sung"));
  assert.ok(header.includes("Em gửi 2 bản nháp"));
});

test("formatSuggestion: câu kỹ thuật BVTV có câu cần phòng kỹ thuật xác nhận", () => {
  const { header } = formatSuggestion({ ...result, agro: true, drafts: [draft(ReplyTone.Formal, "a", { technical: 1 }), draft(ReplyTone.Brief, "b")] });
  assert.ok(header.includes("Câu hỏi kỹ thuật — cần phòng kỹ thuật xác nhận trước khi trả lời khách."));
  assert.ok(header.includes("«[cần kỹ thuật xác nhận]» (1 chỗ)"));
});

test("formatSuggestion: tin gốc dài bị cắt", () => {
  const { header } = formatSuggestion({ ...result, source: { ...result.source!, text: "x".repeat(300) } });
  assert.ok(header.includes("…»"));
});

test("formatNoTemplateReply: liệt kê mẫu đang có; thư viện trống nói rõ", () => {
  const text = formatNoTemplateReply(["A", "B"]);
  assert.ok(text.includes("Chưa có mẫu ĐÃ DUYỆT hợp tình huống này. Mẫu đang dùng: «A», «B»"));
  assert.ok(formatNoTemplateReply([]).includes("Chưa có mẫu ĐÃ DUYỆT nào"));
});
