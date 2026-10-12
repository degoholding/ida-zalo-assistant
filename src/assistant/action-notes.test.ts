import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addActionNote, recordActionNotes, type ActionNoteHolder } from "./action-notes.js";

const record = (tool: string, args: Record<string, unknown>, result: Record<string, unknown>): string[] => {
  const holder: ActionNoteHolder = {};
  recordActionNotes(holder, tool, args, result);
  return holder.actionNotes ?? [];
};

describe("action-notes: dòng việc đã làm thật do máy chủ dựng", () => {
  test("tạo / sửa việc thành công → lấy nguyên câu của lệnh; từ chối hoặc chỉ xem thì không ghi", () => {
    const ok = "Dạ đã ghi V-12: Gửi báo giá — Minh — hạn T6 16/10.";
    assert.deepEqual(record("create_task", {}, { result: ok }), [ok]);
    assert.deepEqual(record("task_action", { action: "reassign" }, { result: "Dạ đã giao lại V-12 cho Minh." }), ["Dạ đã giao lại V-12 cho Minh."]);
    assert.deepEqual(record("task_action", { action: "status" }, { result: "Dạ ... (mô tả việc)" }), []);
    assert.deepEqual(record("create_task", {}, { result: "Chỉ nhân sự công ty mới giao việc qua bot được." }), []);
    assert.deepEqual(record("create_task", {}, { result: null }), []);
    assert.deepEqual(record("create_task", {}, { error: "Thiếu nội dung việc." }), []);
  });

  test("ticket: chỉ giữ dòng đầu (bỏ dòng hướng dẫn); danh sách / từ chối không ghi", () => {
    const reply = "Dạ em đã ghi nhận ticket T-0008 và đã báo người xử lý.\nNhắn «T-8» để xem tình hình.";
    assert.deepEqual(record("create_ticket", {}, { result: reply }), ["Dạ em đã ghi nhận ticket T-0008 và đã báo người xử lý."]);
    assert.deepEqual(record("ticket_action", { action: "done" }, { result: "Dạ đã đóng T-0008 và báo Lan." }), ["Dạ đã đóng T-0008 và báo Lan."]);
    assert.deepEqual(record("ticket_action", { action: "status" }, { result: "Dạ ..." }), []);
    assert.deepEqual(record("ticket_action", { action: "done" }, { result: "Em không thấy ticket T-9 của anh/chị." }), []);
  });

  test("save_recap_tasks: liệt kê việc đã lưu; saved = 0 thì không ghi", () => {
    assert.deepEqual(record("save_recap_tasks", {}, { saved: 2, tasks: ["V-1 A — Minh — hạn 16/10", "V-2 B — Lan — hạn 17/10"] }),
      ["Đã lưu 2 việc vào checklist:\n- V-1 A — Minh — hạn 16/10\n- V-2 B — Lan — hạn 17/10"]);
    assert.deepEqual(record("save_recap_tasks", {}, { saved: 0, note: "đã lưu từ trước" }), []);
  });

  test("xuất báo cáo: link Sheets / tệp Excel / PDF; lỗi thì không ghi", () => {
    assert.deepEqual(record("export_report", {}, { format: "sheets", link: "https://docs.google.com/x" }), ["Đã xuất báo cáo lên Google Sheets: https://docs.google.com/x"]);
    assert.deepEqual(record("export_report", {}, { format: "excel", file_name: "bc.xlsx", will_send_file: true }), ["Đã tạo tệp Excel «bc.xlsx», em gửi kèm ngay sau tin này."]);
    assert.deepEqual(record("create_summary_pdf", {}, { format: "pdf", file_name: "tom-tat.pdf", will_send_file: true }), ["Đã tạo tệp PDF «tom-tat.pdf», em gửi kèm ngay sau tin này."]);
    assert.deepEqual(record("export_report", {}, { error: "Lượt này đã xuất báo cáo rồi." }), []);
  });

  test("bản tin, họp, recap Drive", () => {
    assert.deepEqual(record("send_brief", {}, { queued: true, label: "báo cáo tuần" }), ["Đã xếp gửi báo cáo tuần cho anh/chị qua tin nhắn riêng."]);
    assert.deepEqual(record("send_brief", {}, { error: "từ chối" }), []);
    assert.deepEqual(record("cancel_meeting", {}, { done: "đã xóa cuộc họp khỏi Google Calendar", id: "ev1" }), ["Đã xóa cuộc họp khỏi Google Calendar."]);
    assert.deepEqual(record("create_meeting", {}, { title: "Họp", time_vn: "08:00 13/10/2026", meet_link: "https://meet.google.com/a" }),
      ["Đã tạo cuộc họp Google Meet «Họp» lúc 08:00 13/10/2026: https://meet.google.com/a"]);
    assert.deepEqual(record("recap_drive_recording", {}, { status: "queued", reply: "Dạ em đang nghe bản ghi «họp»." }), ["Dạ em đang nghe bản ghi «họp»."]);
    assert.deepEqual(record("recap_drive_recording", {}, { status: "processing", reply: "đang xử lý" }), []);
  });

  test("công cụ chỉ đọc không ghi; ghi trùng nguyên văn chỉ một dòng", () => {
    assert.deepEqual(record("list_tasks", {}, { result: "Dạ ..." }), []);
    const holder: ActionNoteHolder = {};
    addActionNote(holder, "Đã tạo ticket T-8");
    addActionNote(holder, "Đã tạo ticket T-8");
    addActionNote(holder, "   ");
    assert.deepEqual(holder.actionNotes, ["Đã tạo ticket T-8"]);
  });
});
