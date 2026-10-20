import assert from "node:assert/strict";
import { test } from "node:test";
import { actReply, createdReply, failureReply, listingReply } from "./ticket-command-replies.js";

// Câu trả lời là hợp đồng với người dùng: chép NGUYÊN chuỗi của đường cũ (ticket-commands-legacy.ts). Test vàng DB so cũ / mới; đây là bản thuần không cần DB.

test("danh sách: sếp thấy ticket đang mở, người khác thấy ticket mình báo, rỗng có câu riêng", () => {
  assert.equal(listingReply({ mode: "open", lines: [] }), "Hiện không có ticket nào đang mở.");
  assert.equal(listingReply({ mode: "open", lines: ["a", "b"] }), "TICKET ĐANG MỞ (2)\na\nb\n\nNhắn «nhận T-12» / «xong T-12 <ghi chú>».");
  assert.equal(listingReply({ mode: "mine", lines: [] }), "Anh/chị chưa báo ticket nào. Báo bằng cách nhắn «báo lỗi: <nội dung>».");
  assert.equal(listingReply({ mode: "mine", lines: ["a"] }), "TICKET CỦA ANH/CHỊ (1 gần nhất)\na");
});

test("báo mới: có / không ảnh, có / không người xử lý", () => {
  const base = { outcome: "created" as const, ticket_id: 7, code: "T-0007", attachment_count: 0, handler_count: 2 };
  assert.equal(createdReply(base), "Dạ em đã ghi nhận ticket T-0007 và đã báo người xử lý.\nNhắn «T-7» để xem tình hình, «T-7: <nội dung>» để bổ sung (gửi thêm ảnh trước rồi nhắn).");
  assert.match(createdReply({ ...base, attachment_count: 3, handler_count: 0 }), /^Dạ em đã ghi nhận ticket T-0007 \(kèm 3 ảnh \/ tệp\); hiện chưa cài người xử lý — em đã lưu, quản trị sẽ xem trên màn Ticket\./);
});

test("thao tác: mỗi kết quả một câu đúng chữ cũ", () => {
  const ids = { ticket_id: 12, code: "T-0012" };
  assert.equal(actReply({ ...ids, outcome: "accepted", requester_name: "Lan" }), "Dạ anh/chị đã nhận T-0012; em đã báo Lan. Xong thì nhắn «xong T-12 <ghi chú>».");
  assert.equal(actReply({ ...ids, outcome: "closed_by_handler", requester_name: "Lan" }), "Dạ đã đóng T-0012 và báo Lan.");
  assert.equal(actReply({ ...ids, outcome: "closed_by_requester" }), "Dạ em đã đóng T-0012 theo báo của anh/chị. Còn vấn đề thì nhắn «T-12: <nội dung>» để mở lại.");
  assert.equal(actReply({ ...ids, outcome: "cancelled" }), "Dạ đã hủy T-0012.");
  assert.equal(actReply({ ...ids, outcome: "note_sent", requester_name: "Lan" }), "Dạ em đã chuyển lời nhắn tới Lan.");
  assert.equal(actReply({ ...ids, outcome: "note_added", attachment_count: 0, reopened: false }), "Dạ em đã thêm vào T-0012; người xử lý sẽ nhận được.");
  assert.equal(actReply({ ...ids, outcome: "note_added", attachment_count: 2, reopened: true }), "Dạ em đã thêm vào T-0012 (kèm 2 ảnh / tệp) và MỞ LẠI ticket; người xử lý sẽ nhận được.");
});

test("lỗi: lý do không đủ quyền → câu cũ; trạng thái sai → câu của dịch vụ; lỗi khác → null (ném tiếp)", () => {
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "not_found" }, 5), "Em không thấy ticket T-5 của anh/chị. Nhắn «ticket» để xem danh sách.");
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "handler_only" }, 5), "Chỉ người xử lý ticket mới nhận được. Quản trị thêm người xử lý ở màn Ticket.");
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "handler_or_requester" }, 5), "Chỉ người xử lý ticket (hoặc chính người báo) mới báo xong được.");
  assert.equal(failureReply({ code: "invalid_state", message: "T-0005 đã xong rồi." }, 5), "T-0005 đã xong rồi.");
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "lạ" }, 5), null);
  assert.equal(failureReply({ code: "internal", message: "Lỗi máy chủ" }, 5), null);
  assert.equal(failureReply({ code: "invalid_value", message: "x" }, null), null);
});
