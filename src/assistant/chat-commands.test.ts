import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactRole } from "../constants.js";
import { buildHelpText, parseChatCommand, runChatCommand } from "./chat-commands.js";

test("help is recognised with or without diacritics, including the way people actually type it", () => {
  for (const text of ["hướng dẫn", "Hướng dẫn tôi", "huong dan", "HUONG DAN SU DUNG", "/help", "menu", "hướng dẫn cho em!", "trợ giúp?"]) {
    assert.deepEqual(parseChatCommand(text), { kind: "help" }, text);
  }
});

test("ordinary questions are not swallowed as commands", () => {
  for (const text of ["hướng dẫn anh cách xuất Excel báo cáo tuần", "tóm tắt nhóm Bán hàng hôm nay", "có gì mới không",
    "ok cảm ơn em", "thêm vip", "xong", "phút chờ bao nhiêu", "cấu hình máy chủ thế nào", ""]) {
    assert.equal(parseChatCommand(text), null, text);
  }
});

test("keyword commands keep the user's diacritics in the keyword even when matched without them", () => {
  assert.deepEqual(parseChatCommand("Thêm từ khẩn Bể Bao"), { kind: "keyword", add: true, level: "urgent", keyword: "bể bao" });
  assert.deepEqual(parseChatCommand("bo tu quan trong cong no"), { kind: "keyword", add: false, level: "important", keyword: "cong no" });
  assert.deepEqual(parseChatCommand("xóa từ khóa khẩn «giận»"), { kind: "keyword", add: false, level: "urgent", keyword: "giận" });
});

test("wait, VIP, done, confirm and cancel commands", () => {
  assert.deepEqual(parseChatCommand("phút chờ 90"), { kind: "wait_minutes", vip: false, minutes: 90 });
  assert.deepEqual(parseChatCommand("phut cho vip 20 phut"), { kind: "wait_minutes", vip: true, minutes: 20 });
  assert.deepEqual(parseChatCommand("thêm vip Đại lý Minh Phát"), { kind: "vip", add: true, name: "đại lý minh phát" });
  assert.deepEqual(parseChatCommand("xong #4512"), { kind: "mark_done", messageId: 4512 });
  assert.deepEqual(parseChatCommand("Xong tin số 7"), { kind: "mark_done", messageId: 7 });
  assert.deepEqual(parseChatCommand("Đồng ý"), { kind: "confirm" });
  assert.deepEqual(parseChatCommand("ok"), { kind: "confirm" });
  assert.deepEqual(parseChatCommand("hủy"), { kind: "cancel" });
  assert.deepEqual(parseChatCommand("cấu hình"), { kind: "show_config" });
  assert.deepEqual(parseChatCommand("có gì cần xử lý?"), { kind: "list_pending" });
});

test("text with emoji or other surrogate pairs keeps argument offsets aligned", () => {
  assert.deepEqual(parseChatCommand("thêm từ khẩn hàng 🔥 cháy"), { kind: "keyword", add: true, level: "urgent", keyword: "hàng 🔥 cháy" });
});

test("help lists only the commands the asker may use", () => {
  const staff = buildHelpText(null, false);
  assert.doesNotMatch(staff, /cần xử lý|từ khẩn/);
  const recipient = buildHelpText({ uid: "u", name: "A", role: ContactRole.None, recipientId: 3 }, false);
  assert.match(recipient, /thêm vip/);
  assert.doesNotMatch(recipient, /từ khẩn/);
  const manager = buildHelpText({ uid: "u", name: "A", role: ContactRole.Manager, recipientId: null }, false);
  assert.match(manager, /thêm từ khẩn/);
  assert.doesNotMatch(manager, /thêm vip/);
  assert.match(buildHelpText(null, true), /TRONG NHÓM/);
});

test("ticket commands: report text keeps line breaks and punctuation, status / accept / done / cancel / note by number", () => {
  assert.deepEqual(parseChatCommand("Báo lỗi: máy in phòng kế toán kẹt giấy.\nĐã thử tắt mở lại?"),
    { kind: "ticket_create", text: "máy in phòng kế toán kẹt giấy.\nĐã thử tắt mở lại?" });
  assert.deepEqual(parseChatCommand("bao loi wifi kho yeu"), { kind: "ticket_create", text: "wifi kho yeu" });
  assert.deepEqual(parseChatCommand("ticket: xe giao hàng hỏng"), { kind: "ticket_create", text: "xe giao hàng hỏng" });
  assert.deepEqual(parseChatCommand("ticket"), { kind: "ticket_list" });
  assert.deepEqual(parseChatCommand("ticket của tôi"), { kind: "ticket_list" });
  assert.deepEqual(parseChatCommand("T-12"), { kind: "ticket_status", ticketId: 12 });
  assert.deepEqual(parseChatCommand("t12 sao rồi?"), { kind: "ticket_status", ticketId: 12 });
  assert.deepEqual(parseChatCommand("T-0012"), { kind: "ticket_status", ticketId: 12 });
  assert.deepEqual(parseChatCommand("nhận T-12"), { kind: "ticket_accept", ticketId: 12 });
  assert.deepEqual(parseChatCommand("Xong T-12 đã thay hộp mực."), { kind: "ticket_done", ticketId: 12, note: "đã thay hộp mực." });
  assert.deepEqual(parseChatCommand("xong t-12"), { kind: "ticket_done", ticketId: 12, note: "" });
  assert.deepEqual(parseChatCommand("hủy T-12: báo nhầm"), { kind: "ticket_cancel", ticketId: 12, note: "báo nhầm" });
  assert.deepEqual(parseChatCommand("T-12: vẫn còn lỗi anh ơi"), { kind: "ticket_note", ticketId: 12, note: "vẫn còn lỗi anh ơi" });
  // «xong 1234» (không có T) vẫn là lệnh đánh dấu tin cảnh báo, không phải ticket
  assert.deepEqual(parseChatCommand("xong 1234"), { kind: "mark_done", messageId: 1234 });
  // Lời báo quá ngắn / trống không thành ticket
  assert.equal(parseChatCommand("báo lỗi:"), null);
  assert.equal(parseChatCommand("báo lỗi: a"), null);
});

test("long ticket descriptions are accepted (other commands stay short)", () => {
  const long = "x".repeat(2500);
  assert.deepEqual(parseChatCommand(`báo lỗi: ${long}`), { kind: "ticket_create", text: long });
  assert.equal(parseChatCommand(`báo lỗi: ${"x".repeat(3100)}`), null);
});

test("help for a ticket-only user lists only ticket commands; handlers also see handler commands", () => {
  const only = buildHelpText(null, false, { ticketOnly: true });
  assert.match(only, /báo lỗi:/);
  assert.doesNotMatch(only, /Tóm tắt nhóm|cần xử lý/);
  assert.match(buildHelpText(null, false, { ticketOnly: true, ticketHandler: true }), /nhận T-12/);
});

test("brief / report requests are recognised by parseChatCommand (phase 8)", () => {
  assert.deepEqual(parseChatCommand("bản tin sáng"), { kind: "brief_request", request: "morning", variant: "standard" });
  assert.deepEqual(parseChatCommand("gửi anh báo cáo tuần nhé"), { kind: "brief_request", request: "weekly", variant: "standard" });
  // Câu dài hơn vẫn để công cụ AI export_report lo, không bị lệnh bản tin nuốt
  assert.equal(parseChatCommand("báo cáo tuần doanh số đại lý A ra Excel"), null);
});

test("runChatCommand: brief requests only run in a private chat, and only for an active recipient", async () => {
  const now = new Date("2026-10-09T08:00:00+07:00");
  // runBriefCommand trả ngay khi asker không có recipientId — không chạm trường nào của `brief`, nên để rỗng ở đây.
  const brief = {} as unknown as import("../briefs/brief-commands.js").BriefChatDeps;
  const inGroupReply = await runChatCommand(
    { db: undefined as never, asker: null, inGroup: true, now, brief }, { kind: "brief_request", request: "morning", variant: "standard" });
  assert.equal(inGroupReply, null);
  const noDepsReply = await runChatCommand(
    { db: undefined as never, asker: null, inGroup: false, now }, { kind: "brief_request", request: "morning", variant: "standard" });
  assert.equal(noDepsReply, null);
  const rejected = await runChatCommand(
    { db: undefined as never, asker: null, inGroup: false, now, brief }, { kind: "brief_request", request: "morning", variant: "standard" });
  assert.match(rejected ?? "", /Bản tin dành cho người nhận/);
});

test("help mentions «BẢN TIN, BÁO CÁO» only for an active recipient", () => {
  const recipient = buildHelpText({ uid: "u", name: "A", role: ContactRole.None, recipientId: 3 }, false);
  assert.match(recipient, /BẢN TIN, BÁO CÁO/);
  const staff = buildHelpText({ uid: "u", name: "A", role: ContactRole.Manager, recipientId: null }, false);
  assert.doesNotMatch(staff, /BẢN TIN, BÁO CÁO/);
});

test("natural ticket phrasings people actually typed (08/10/2026)", () => {
  assert.deepEqual(parseChatCommand("báo xử lý xong T1"), { kind: "ticket_done", ticketId: 1, note: "" });
  assert.deepEqual(parseChatCommand("đã xử lý xong T-12 thay dây mạng"), { kind: "ticket_done", ticketId: 12, note: "thay dây mạng" });
  assert.deepEqual(parseChatCommand("T1 xong rồi"), { kind: "ticket_done", ticketId: 1, note: "" });
  assert.deepEqual(parseChatCommand("đã nhận xử lý T3"), { kind: "ticket_accept", ticketId: 3 });
  assert.deepEqual(parseChatCommand("hiện tại có bao nhiêu ticket"), { kind: "ticket_list" });
  assert.deepEqual(parseChatCommand("có mấy ticket đang mở?"), { kind: "ticket_list" });
  assert.deepEqual(parseChatCommand("báo ticket meo meo truy cập chậm"), { kind: "ticket_create", text: "meo meo truy cập chậm" });
});
