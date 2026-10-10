import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskCommand } from "./task-command-parser.js";
import { parseChatCommand } from "../assistant/chat-commands.js";

test("danh sách việc: của tôi / nhóm / quá hạn / chờ xác nhận, có hay không dấu", () => {
  assert.deepEqual(parseTaskCommand("việc"), { kind: "task_list", scope: "mine" });
  assert.deepEqual(parseTaskCommand("Việc của em?"), { kind: "task_list", scope: "mine" });
  assert.deepEqual(parseTaskCommand("viec nhom"), { kind: "task_list", scope: "group" });
  assert.deepEqual(parseTaskCommand("việc quá hạn"), { kind: "task_list", scope: "overdue" });
  assert.deepEqual(parseTaskCommand("việc chờ xác nhận"), { kind: "task_list", scope: "proposed" });
});

test("giao việc: tên + nội dung + hạn, giữ nguyên chữ gốc (có dấu, hoa thường)", () => {
  assert.deepEqual(parseTaskCommand("giao Minh: gửi báo giá đại lý Xuân Trường hạn thứ 6"),
    { kind: "task_create", assigneeName: "Minh", title: "gửi báo giá đại lý Xuân Trường", dueText: "thứ 6" });
  assert.deepEqual(parseTaskCommand("Giao việc cho anh Nam: chốt công nợ Minh Phát, hạn: 20/10 17h"),
    { kind: "task_create", assigneeName: "anh Nam", title: "chốt công nợ Minh Phát", dueText: "20/10 17h" });
  assert.deepEqual(parseTaskCommand("giao @Lan Anh: kiểm kho cuối tháng"),
    { kind: "task_create", assigneeName: "@Lan Anh", title: "kiểm kho cuối tháng", dueText: "" });
  // «hạn» cuối cùng mới là hạn — chữ «hạn» trong nội dung giữ lại
  assert.equal((parseTaskCommand("giao Minh: gia hạn hợp đồng thép hạn mai") as { title: string }).title, "gia hạn hợp đồng thép");
});

// «giao hàng: 20 bao» là câu nói thường, không phải giao việc cho người tên «hàng»
test("giao việc: không nhầm câu thường «giao hàng: …» / thiếu nội dung", () => {
  assert.equal(parseTaskCommand("giao hàng: 20 bao NPK cho đại lý"), null);
  assert.equal(parseTaskCommand("giao Minh:"), null);
  assert.equal(parseTaskCommand("giao Minh: ok"), null);
  assert.equal(parseTaskCommand("mai giao hàng nhé"), null);
  assert.equal(parseTaskCommand("Giao Hàng Nhanh: đơn 123 tới chưa"), null);
});

// Review 09/10/2026: «v3», «ok v2», «bỏ v1» trong câu thường từng bị nuốt thành lệnh việc
test("dạng mã đứng trần (xem / ok / bỏ / ghi chú) bắt buộc «V-»; có động từ thì «V12» vẫn được; «rồi nhé» không thành ghi chú", () => {
  assert.equal(parseTaskCommand("v3"), null);
  assert.equal(parseTaskCommand("ok v2"), null);
  assert.equal(parseTaskCommand("bỏ v1"), null);
  assert.equal(parseTaskCommand("V1 - bản mới thế nào"), null);
  assert.deepEqual(parseTaskCommand("V-3"), { kind: "task_status", taskId: 3 });
  assert.deepEqual(parseTaskCommand("xong v12"), { kind: "task_done", taskId: 12, note: "" });
  assert.deepEqual(parseTaskCommand("xong V-12 rồi nhé"), { kind: "task_done", taskId: 12, note: "" });
  assert.deepEqual(parseTaskCommand("xong V-12 rồi, đã gửi mail"), { kind: "task_done", taskId: 12, note: "rồi, đã gửi mail" });
});

test("thao tác theo mã: xong / dời / giao lại / hủy / mở lại / ok / bỏ / ghi chú / xem", () => {
  assert.deepEqual(parseTaskCommand("xong V-12"), { kind: "task_done", taskId: 12, note: "" });
  assert.deepEqual(parseTaskCommand("đã xong v12: đã gửi mail cho đại lý"), { kind: "task_done", taskId: 12, note: "đã gửi mail cho đại lý" });
  assert.deepEqual(parseTaskCommand("V-0012 xong rồi"), { kind: "task_done", taskId: 12, note: "" });
  assert.deepEqual(parseTaskCommand("dời V-12 sang thứ 2 tuần sau"), { kind: "task_reschedule", taskId: 12, dueText: "thứ 2 tuần sau" });
  assert.deepEqual(parseTaskCommand("gia hạn V12 20/10"), { kind: "task_reschedule", taskId: 12, dueText: "20/10" });
  assert.deepEqual(parseTaskCommand("giao lại V-12 cho chị Lan"), { kind: "task_reassign", taskId: 12, assigneeName: "chị Lan" });
  assert.deepEqual(parseTaskCommand("hủy V-12 trùng việc"), { kind: "task_cancel", taskId: 12, note: "trùng việc" });
  assert.deepEqual(parseTaskCommand("mở lại V-12"), { kind: "task_reopen", taskId: 12, note: "" });
  assert.deepEqual(parseTaskCommand("ok V-12"), { kind: "task_confirm", taskId: 12 });
  assert.deepEqual(parseTaskCommand("Bỏ V-12."), { kind: "task_reject", taskId: 12 });
  assert.deepEqual(parseTaskCommand("V-12: khách hẹn sang tuần"), { kind: "task_note", taskId: 12, note: "khách hẹn sang tuần" });
  assert.deepEqual(parseTaskCommand("V-12 sao rồi"), { kind: "task_status", taskId: 12 });
  assert.equal(parseTaskCommand("dời V-12"), null);
});

// Tiêu chí nghiệm thu N5 (sheet IDA): «Cập nhật được bằng lệnh /xong, /doihan»
test("gõ kiểu lệnh của đặc tả IDA: /viec, /xong, /doihan, /giao", () => {
  assert.deepEqual(parseTaskCommand("/viec"), { kind: "task_list", scope: "mine" });
  assert.deepEqual(parseTaskCommand("/xong V-12"), { kind: "task_done", taskId: 12, note: "" });
  assert.deepEqual(parseTaskCommand("/doihan V-12 05/10"), { kind: "task_reschedule", taskId: 12, dueText: "05/10" });
  assert.deepEqual(parseTaskCommand("/ doi han v12 sang thứ 2"), { kind: "task_reschedule", taskId: 12, dueText: "thứ 2" });
  assert.deepEqual(parseTaskCommand("/giao Tâm: gửi báo giá ĐL Tân Phú hạn 30/10"),
    { kind: "task_create", assigneeName: "Tâm", title: "gửi báo giá ĐL Tân Phú", dueText: "30/10" });
  assert.equal(parseTaskCommand("/xong 1234"), null, "«xong <số tin>» là lệnh tin cần xử lý, không phải lệnh việc");
});

test("không đụng lệnh có sẵn: ticket T-12, «xong 1234» (tin cần xử lý), «ok» đứng một mình", () => {
  assert.equal(parseTaskCommand("xong T-12"), null);
  assert.equal(parseTaskCommand("xong 1234"), null);
  assert.equal(parseTaskCommand("ok"), null);
  assert.equal(parseChatCommand("xong T-12")?.kind, "ticket_done");
  assert.equal(parseChatCommand("xong 1234")?.kind, "mark_done");
  assert.equal(parseChatCommand("việc cần xử lý")?.kind, "list_pending");
  assert.equal(parseChatCommand("xong V-12")?.kind, "task_done");
  assert.equal(parseChatCommand("ok")?.kind, "confirm");
});

// Phase 4 (recap họp): «ok hết» / «bỏ hết» gộp xác nhận mọi đề xuất Recap của cuộc đang hỏi — không cần gõ từng mã V-n.
test("«ok hết» / «bỏ hết» (recap họp): các cách nói, không nhầm với lệnh có mã việc hoặc câu thường", () => {
  assert.deepEqual(parseTaskCommand("ok hết"), { kind: "task_confirm_recap" });
  assert.deepEqual(parseTaskCommand("Lưu hết"), { kind: "task_confirm_recap" });
  assert.deepEqual(parseTaskCommand("đồng ý hết"), { kind: "task_confirm_recap" });
  assert.deepEqual(parseTaskCommand("chốt hết."), { kind: "task_confirm_recap" });
  assert.deepEqual(parseTaskCommand("bỏ hết"), { kind: "task_reject_recap" });
  assert.deepEqual(parseTaskCommand("không phải hết"), { kind: "task_reject_recap" });
  // M3 (review 10/10/2026): «không hết» bỏ khỏi nhóm bỏ — câu nói thường (vd trả lời câu hỏi khác), rủi ro nuốt nhầm
  assert.equal(parseTaskCommand("Không hết!"), null);
  assert.equal(parseTaskCommand("không hết"), null);
  // Có mã việc thì vẫn là lệnh theo mã, không phải lệnh gộp
  assert.deepEqual(parseTaskCommand("ok V-12"), { kind: "task_confirm", taskId: 12 });
  assert.deepEqual(parseTaskCommand("bỏ V-12"), { kind: "task_reject", taskId: 12 });
  // Câu thường có chữ «hết» không bị nuốt thành lệnh
  assert.equal(parseTaskCommand("hết hàng rồi"), null);
  assert.equal(parseTaskCommand("ok hết việc chưa anh"), null);
  assert.equal(parseTaskCommand("hết"), null);
});
