import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelClient } from "../assistant/gemini-client.js";
import type { Db } from "../db/pool.js";
import { ReplyTemplateStatus } from "../constants.js";
import { suggestReplies } from "./reply-suggestion-service.js";

// Db giả: trả hàng theo mẫu câu SQL — đủ cho đường chạy của service (không cần MySQL).
function fakeDb(handlers: Record<string, unknown[]>): Db {
  return {
    async query(sql: string) {
      for (const [needle, rows] of Object.entries(handlers)) if (sql.includes(needle)) return [rows];
      return [[]];
    },
  } as unknown as Db;
}

const templateRow = (patch: Record<string, unknown> = {}) => ({
  id: 1, tenant_id: 1, name: "Báo giá sản phẩm", situation: "Khách hỏi giá", keywords: "giá, báo giá", body: "Dạ giá [giá] /bao, áp dụng đến [ngày].",
  tone: 1, status: ReplyTemplateStatus.Approved, author_user_id: null, author_name: "", reviewer_user_id: null, reviewer_name: "", review_note: "",
  submitted_at: null, reviewed_at: null, created_at: new Date(0), updated_at: new Date(0), ...patch,
});

const messageRow = (patch: Record<string, unknown> = {}) => ({
  id: 9, group_id: 3, sender_name: "anh Sáu", sent_at: new Date("2026-10-12T02:12:00Z"), text: "Flowertop giá sao em", thread_type: 1,
  read_messages: 1, is_confidential: 0, group_name: "Nhóm ĐL", ...patch,
});

function modelReturning(text: string, calls = { count: 0 }): ModelClient {
  return { async generate() { calls.count += 1; return { content: { role: "model", parts: [{ text }] }, inputTokens: 1, outputTokens: 1 }; } };
}

const answer = JSON.stringify({ template_id: 1, drafts: [
  { tone: "formal", text: "Dạ giá 1.250.000đ /bao ạ, chiết khấu thêm" }, { tone: "friendly", text: "Giá [giá] nha anh" }, { tone: "brief", text: "Giá 450k ạ" },
] });
const deps = (db: Db, model: ModelClient) => ({ db, model, maskPersonal: true, now: new Date("2026-10-12T03:00:00Z") });

test("không có mẫu ĐÃ DUYỆT hợp → từ chối, KHÔNG gọi mô hình", async () => {
  const calls = { count: 0 };
  const out = await suggestReplies(deps(fakeDb({ "FROM reply_template": [templateRow()] }), modelReturning(answer, calls)), { tenantId: 1, question: "chào buổi sáng" });
  assert.ok("refusal" in out && out.refusal.includes("«Báo giá sản phẩm»"));
  assert.equal(calls.count, 0);
});

test("đường đầy đủ: chọn mẫu, kiểm số, dựng header + 3 bản", async () => {
  const db = fakeDb({ "FROM reply_template": [templateRow()], "FROM message m": [messageRow()] });
  const out = await suggestReplies(deps(db, modelReturning(answer)), { tenantId: 1, question: "gợi ý trả lời tin giá Flowertop", messageId: 9 });
  assert.ok("drafts" in out);
  if (!("drafts" in out)) return;
  assert.equal(out.templateId, 1);
  assert.equal(out.drafts.length, 3);
  assert.ok(out.drafts[0].includes("[cần bổ sung]") && !out.drafts[0].includes("1.250.000"));
  assert.equal(out.drafts[1], "Giá [cần bổ sung: giá] nha anh");
  assert.equal(out.drafts[2], "Giá 450k ạ".replace("450k", "[cần bổ sung]"));
  assert.ok(out.header.includes("Lưu ý: bản 1 có «chiết khấu»"));
  assert.ok(out.header.includes("Tin gốc: [Nhóm ĐL · anh Sáu"));
});

test("tin nhóm Mật bị từ chối, không gọi mô hình", async () => {
  const calls = { count: 0 };
  const db = fakeDb({ "FROM reply_template": [templateRow()], "FROM message m": [messageRow({ is_confidential: 1 })] });
  const out = await suggestReplies(deps(db, modelReturning(answer, calls)), { tenantId: 1, question: "giá", messageId: 9 });
  assert.ok("error" in out && out.error.includes("Mật"));
  assert.equal(calls.count, 0);
});

test("tin không tồn tại / ngoài nhóm đang hỏi → lỗi", async () => {
  const none = await suggestReplies(deps(fakeDb({}), modelReturning(answer)), { tenantId: 1, question: "giá", messageId: 9 });
  assert.ok("error" in none);
  const db = fakeDb({ "FROM message m": [messageRow()] });
  const out = await suggestReplies(deps(db, modelReturning(answer)), { tenantId: 1, question: "giá", messageId: 9, scopeGroupId: 77 });
  assert.ok("error" in out && out.error.includes("ngoài nhóm"));
});

test("câu BVTV → header có câu cần phòng kỹ thuật xác nhận", async () => {
  const dose = JSON.stringify({ template_id: 1, drafts: [{ tone: "formal", text: "Pha 20ml/bình nhé" }, { tone: "brief", text: "Pha 20ml/bình" }] });
  const out = await suggestReplies(deps(fakeDb({ "FROM reply_template": [templateRow()] }), modelReturning(dose)), { tenantId: 1, question: "báo giá và liều lượng pha thuốc" });
  assert.ok("drafts" in out && out.header.includes("cần phòng kỹ thuật xác nhận") && out.drafts[0].includes("[cần kỹ thuật xác nhận]"));
});

test("chạm trần 30 lượt / giờ → từ chối", async () => {
  const db = fakeDb({ "FROM assistant_turn": [{ total: 30 }] });
  const out = await suggestReplies(deps(db, modelReturning(answer)), { tenantId: 1, question: "giá", askerContactId: 4 });
  assert.ok("refusal" in out && out.refusal.includes("30"));
});

test("mô hình trả sai khuôn → error (không rò chữ thô)", async () => {
  const out = await suggestReplies(deps(fakeDb({ "FROM reply_template": [templateRow()] }), modelReturning("xin chào")), { tenantId: 1, question: "báo giá" });
  assert.ok("error" in out);
});

test("review phase 10: tin trong cuộc nhắn riêng của NGƯỜI KHÁC với bot → từ chối, không gọi mô hình; cuộc của chính người hỏi thì nhận", async () => {
  const calls = { count: 0 };
  const direct = messageRow({ thread_type: 0, zalo_group_id: "uid-khac", group_name: "" });
  const db = fakeDb({ "FROM reply_template": [templateRow()], "FROM message m": [direct] });
  const other = await suggestReplies(deps(db, modelReturning(answer, calls)), { tenantId: 1, question: "giá", messageId: 9, askerUid: "uid-toi" });
  assert.ok("error" in other && other.error.includes("người khác"));
  const noUid = await suggestReplies(deps(db, modelReturning(answer, calls)), { tenantId: 1, question: "giá", messageId: 9 });
  assert.ok("error" in noUid);
  assert.equal(calls.count, 0);
  const ownDb = fakeDb({ "FROM reply_template": [templateRow()], "FROM message m": [{ ...direct, zalo_group_id: "uid-toi" }] });
  const own = await suggestReplies(deps(ownDb, modelReturning(answer, calls)), { tenantId: 1, question: "giá", messageId: 9, askerUid: "uid-toi" });
  assert.ok("drafts" in own);
});

test("nguồn đọc tiêm (họ files qua MCP): dịch vụ không chạm DB; trần giờ / tin gốc / mẫu lấy từ reader", async () => {
  const touched: string[] = [];
  const noDb = { query: async () => { throw new Error("không được chạm DB"); } } as unknown as Db;
  const template = {
    id: 1, tenantId: 1, name: "Báo giá sản phẩm", situation: "Khách hỏi giá", keywords: ["giá", "báo giá"], body: "Dạ giá [giá] /bao, áp dụng đến [ngày].", tone: 1,
    status: ReplyTemplateStatus.Approved, authorUserId: null, authorName: "", reviewerUserId: null, reviewerName: "", reviewNote: "", submittedAt: null, reviewedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const source = { messageId: 9, groupName: "Nhóm ĐL", senderName: "anh Sáu", sentAt: new Date("2026-10-12T02:12:00Z"), text: "Flowertop giá sao em", context: [] };
  const reader = {
    hourlyCount: async () => { touched.push("hourly"); return 0; },
    loadSource: async (id: number, options: { askerUid?: string }) => { touched.push(`source:${id}:${options.askerUid}`); return { source }; },
    listApprovedTemplates: async () => { touched.push("templates"); return [template]; },
  };
  const out = await suggestReplies({ ...deps(noDb, modelReturning(answer)), reader }, { tenantId: 1, question: "gợi ý trả lời tin giá Flowertop", messageId: 9, askerContactId: 4, askerUid: "u-1" });
  assert.ok("drafts" in out && out.templateId === 1);
  assert.deepEqual(touched, ["hourly", "source:9:u-1", "templates"]);
  const capped = await suggestReplies({ ...deps(noDb, modelReturning(answer)), reader: { ...reader, hourlyCount: async () => 30 } }, { tenantId: 1, question: "giá", askerContactId: 4 });
  assert.ok("refusal" in capped && capped.refusal.includes("30"));
  const failed = await suggestReplies({ ...deps(noDb, modelReturning(answer)), reader: { ...reader, loadSource: async () => ({ error: "Tin này thuộc nhóm Mật" }) } }, { tenantId: 1, question: "giá", messageId: 9 });
  assert.ok("error" in failed && failed.error.includes("Mật"));
});
