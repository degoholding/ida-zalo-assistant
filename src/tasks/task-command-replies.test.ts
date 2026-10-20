import assert from "node:assert/strict";
import { test } from "node:test";
import { actReply, createdReply, failureReply, LIST_LIMIT, listingReply, recapDecisionReply } from "./task-command-replies.js";

// Câu trả lời là hợp đồng với người dùng — chép nguyên từ đường cũ (task-commands-legacy.ts); test vàng DB so cũ / mới, test này khóa từng chuỗi.

test("danh sách: tiêu đề theo phạm vi, đếm, dòng gợi ý; trống thì câu riêng", () => {
  const lines = ["V-1 a", "V-2 b"];
  assert.equal(listingReply({ scope: "mine", in_group: false, lines, first_code: "V-1" }),
    "VIỆC CỦA ANH/CHỊ (đang phụ trách hoặc đã giao) (2)\nV-1 a\nV-2 b\n\nNhắn «xong V-1», «dời V-1 <hạn>», «V-1» để xem chi tiết.");
  assert.match(listingReply({ scope: "group", in_group: true, lines, first_code: "V-1" }), /^VIỆC CỦA NHÓM \(2\)/);
  assert.match(listingReply({ scope: "group", in_group: false, lines, first_code: "V-1" }), /^VIỆC ĐANG LÀM \(2\)/);
  assert.match(listingReply({ scope: "overdue", in_group: false, lines, first_code: "V-1" }), /^VIỆC QUÁ HẠN/);
  assert.match(listingReply({ scope: "proposed", in_group: false, lines, first_code: "V-1" }), /Nhắn «ok V-1» để lưu, «bỏ V-1» nếu không phải việc\.$/);
  const full = Array.from({ length: LIST_LIMIT }, (_, index) => `V-${index} x`);
  assert.match(listingReply({ scope: "mine", in_group: false, lines: full, first_code: "V-0" }), /\(30\+, 30 việc gần hạn nhất\)/);
  assert.equal(listingReply({ scope: "mine", in_group: false, lines: [], first_code: null }), "Không có việc nào.");
  assert.equal(listingReply({ scope: "proposed", in_group: false, lines: [], first_code: null }), "Không có đề xuất nào chờ xác nhận.");
});

test("giao việc: có báo người phụ trách / chưa có hạn", () => {
  const base = { outcome: "created" as const, code: "V-31", title: "gửi báo giá", assignee_name: "Minh", due_label: "T6 23/10", has_due: true, notified: true };
  assert.equal(createdReply(base), "Dạ đã ghi V-31: gửi báo giá — Minh — hạn T6 23/10; em đã báo Minh.");
  assert.equal(createdReply({ ...base, notified: false, has_due: false, due_label: "chưa có" }),
    "Dạ đã ghi V-31: gửi báo giá — Minh — hạn chưa có. Chưa có hạn: nhắn «dời V-31 <hạn>» để đặt.");
});

test("thao tác: từng kết quả", () => {
  assert.equal(actReply({ outcome: "done", code: "V-1", notified_name: "Lan" }), "Dạ đã đánh xong V-1 và báo Lan.");
  assert.equal(actReply({ outcome: "done", code: "V-1", notified_name: null }), "Dạ đã đánh xong V-1.");
  assert.equal(actReply({ outcome: "noted", code: "V-1" }), "Dạ em đã ghi chú vào V-1.");
  assert.equal(actReply({ outcome: "rescheduled", code: "V-1", due_label: "T6 23/10" }), "Dạ đã đổi hạn V-1 thành T6 23/10.");
  assert.equal(actReply({ outcome: "reassigned", code: "V-1", assignee_name: "Minh" }), "Dạ đã giao lại V-1 cho Minh.");
  assert.equal(actReply({ outcome: "cancelled", code: "V-1" }), "Dạ đã hủy V-1.");
  assert.equal(actReply({ outcome: "reopened", code: "V-1" }), "Dạ đã mở lại V-1.");
  assert.equal(actReply({ outcome: "confirmed", code: "V-1", notified_name: "Minh" }), "Dạ đã lưu V-1 vào checklist và báo Minh.");
  assert.equal(actReply({ outcome: "confirmed", code: "V-1", notified_name: null }), "Dạ đã lưu V-1 vào checklist (chưa có người phụ trách — nhắn «giao lại V-1 <tên>»).");
  assert.equal(actReply({ outcome: "rejected", code: "V-1" }), "Dạ em đã bỏ đề xuất V-1.");
});

test("«ok hết» / «bỏ hết»: không khớp → null; không còn gì; đã lưu / đã bỏ", () => {
  assert.equal(recapDecisionReply({ outcome: "none" }), null);
  assert.equal(recapDecisionReply({ outcome: "none_left", confirm: true }), "Không còn đề xuất nào để lưu (có thể vừa được xử lý).");
  assert.equal(recapDecisionReply({ outcome: "none_left", confirm: false }), "Không còn đề xuất nào để bỏ (có thể vừa được xử lý).");
  assert.equal(recapDecisionReply({ outcome: "decided", confirm: true, codes: ["V-1", "V-2"] }), "Dạ đã lưu 2 việc vào checklist: V-1, V-2.");
  assert.equal(recapDecisionReply({ outcome: "decided", confirm: false, codes: ["V-3"] }), "Dạ đã bỏ 1 đề xuất: V-3.");
});

test("lỗi nghiệp vụ → câu bot; lỗi hệ thống / tham số → null", () => {
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "not_found" }, 12), "Em không thấy việc V-12 của anh/chị. Nhắn «việc» để xem danh sách.");
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "manage_only" }, 12), "Anh/chị không có quyền làm việc này — chỉ người giao việc hoặc quản lý.");
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "staff_only" }, null), "Chỉ nhân sự công ty mới giao việc qua bot được.");
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "work_done" }, 1), "Chỉ người phụ trách, người giao hoặc quản lý mới báo xong được.");
  assert.equal(failureReply({ code: "not_allowed", message: "", reason: "work_note" }, 1), "Chỉ người phụ trách, người giao hoặc quản lý mới ghi chú được.");
  assert.equal(failureReply({ code: "invalid_state", message: "V-1 vừa được cập nhật." }, 1), "V-1 vừa được cập nhật.");
  assert.equal(failureReply({ code: "ambiguous", message: "Có 2 người tên Minh" }, null), "Có 2 người tên Minh");
  assert.equal(failureReply({ code: "not_found", message: "Em không tìm thấy ai" }, null), "Em không tìm thấy ai");
  assert.equal(failureReply({ code: "invalid_value", message: "Em chưa hiểu hạn", reason: "due_unparsed" }, 1), "Em chưa hiểu hạn");
  assert.equal(failureReply({ code: "invalid_value", message: "Tham số sai" }, 1), null);
  assert.equal(failureReply({ code: "forbidden", message: "x" }, 1), null);
  assert.equal(failureReply({ code: "not_allowed", message: "x", reason: "lạ" }, 1), null);
});
