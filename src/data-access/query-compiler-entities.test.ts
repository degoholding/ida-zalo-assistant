import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, compileRows as compile, makeCtx, manager, rejects, staff } from "./data-access-test-support.js";

const adminCtx = makeCtx(admin());
const adminMatCtx = makeCtx(admin({ canViewConfidential: true }));
const staffCtx = makeCtx(staff());
const managerCtx = makeCtx(manager());

test("tin nhắn: bắt buộc thread_id hoặc khoảng sent_at ≤ 92 ngày chặn hai đầu", () => {
  rejects(() => compile("messages"), "missing_required_filter", /thread_id/);
  rejects(() => compile("messages", { filters: [{ field: "sender_name", op: "eq", value: "Huy" }] }), "missing_required_filter");
  rejects(() => compile("messages", { filters: [{ field: "text", op: "contains", value: "giá" }] }), "missing_required_filter");
  // thread_id phải bị RÀNG (eq / in); so lớn hơn thì chưa ràng được
  rejects(() => compile("messages", { filters: [{ field: "thread_id", op: "gt", value: 3 }] }), "missing_required_filter");
  rejects(() => compile("messages", { filters: [{ field: "sent_at", op: "lte", value: "2026-10-16" }] }), "missing_required_filter");
  const byThread = compile("messages", { filters: [{ field: "thread_id", op: "in", value: [12, 15] }] });
  assert.match(byThread.sql, /m\.recalled_at IS NULL\) AND \(\(g\.thread_type = 0 OR g\.read_messages = 1\) AND g\.is_confidential = 0\)/);
  assert.match(byThread.sql, /\(m\.group_id IN \(\?\)\)/);
  compile("messages", { filters: [{ field: "thread_id", op: "eq", value: 12 }] });
  compile("messages", { filters: [{ field: "sent_at", op: "between", value: ["2026-10-01", "2026-10-16"] }] });
  // gte không có cận trên → tính tới «bây giờ» (17/10/2026)
  compile("messages", { filters: [{ field: "sent_at", op: "gte", value: "2026-10-10" }] });
  compile("messages", { filters: [{ field: "sent_at", op: "eq", value: "2026-10-10" }] });
});

test("tin nhắn: khoảng ngày đúng 92 ngày được, 93 ngày bị chặn (range_too_wide)", () => {
  compile("messages", { filters: [{ field: "sent_at", op: "between", value: ["2026-07-18", "2026-10-17"] }] });
  rejects(() => compile("messages", { filters: [{ field: "sent_at", op: "between", value: ["2026-07-17", "2026-10-17"] }] }), "range_too_wide", /92/);
  rejects(() => compile("messages", { filters: [{ field: "sent_at", op: "gte", value: "2026-01-01" }] }), "range_too_wide");
  rejects(() => compile("messages", { filters: [{ field: "sent_at", op: "gte", value: "2026-01-01" }, { field: "sent_at", op: "lt", value: "2026-09-01" }] }), "range_too_wide");
  // Hai điều kiện cùng trường nối VÀ → lấy cận chặt: 01/01 → 01/10 nhưng cận dưới kéo lên 15/09 thì hẹp lại
  compile("messages", { filters: [{ field: "sent_at", op: "gte", value: "2026-01-01" }, { field: "sent_at", op: "gte", value: "2026-09-15" }, { field: "sent_at", op: "lt", value: "2026-10-01" }] });
  // Có thread_id thì không cần khoảng ngày (dù khoảng rộng)
  compile("messages", { filters: [{ field: "thread_id", op: "eq", value: 5 }, { field: "sent_at", op: "gte", value: "2026-01-01" }] });
});

test("tin nhắn: ctx có Mật → không lọc is_confidential; người bị khoanh → IN nhóm được gán", () => {
  const filters = [{ field: "thread_id", op: "eq" as const, value: 11 }];
  assert.doesNotMatch(compile("messages", { filters }, adminMatCtx).sql, /is_confidential/);
  assert.match(compile("messages", { filters }, staffCtx).sql, /g\.id IN \(\?\) AND g\.is_confidential = 0/);
});

test("Danh bạ: SĐT chỉ với catalog.read — cột, lọc, tìm; Nhân viên không có, Quản lý có", () => {
  rejects(() => compile("contacts", { fields: ["id", "phone"] }, staffCtx), "invalid_field", /phone/);
  rejects(() => compile("contacts", { filters: [{ field: "phone", op: "contains", value: "090" }] }, staffCtx), "invalid_field");
  assert.doesNotMatch(compile("contacts", { search: "an" }, staffCtx).sql, /c\.phone/);
  const withPhone = compile("contacts", { fields: ["id", "phone"], filters: [{ field: "phone", op: "contains", value: "090" }], search: "an" }, managerCtx);
  assert.match(withPhone.sql, /c\.phone AS `phone`/);
  assert.match(withPhone.sql, /c\.phone LIKE \?/);
});

test("Danh bạ: hàm build tự viết chỉ nhận phép nó hiểu; sắp xếp group_count dùng biểu thức đầy đủ", () => {
  assert.match(compile("contacts", { filters: [{ field: "group_id", op: "in", value: [11, 12] }] }, staffCtx).sql, /EXISTS \(SELECT 1 FROM group_member gm/);
  rejects(() => compile("contacts", { filters: [{ field: "group_id", op: "gt", value: 1 }] }), "invalid_operator");
  rejects(() => compile("contacts", { filters: [{ field: "tag", op: "gt", value: "x" }] }), "invalid_operator");
  compile("contacts", { filters: [{ field: "tag", op: "contains", value: "vip" }] });
  assert.match(compile("contacts", { sort: { field: "group_count", dir: "desc" } }).sql, /ORDER BY \(SELECT COUNT\(\*\) FROM group_member gm JOIN zalo_group zg ON zg\.id = gm\.group_id WHERE gm\.zalo_uid = c\.zalo_uid AND gm\.left_at IS NULL AND zg\.is_confidential = 0\) DESC, c\.id/);
  // Người bị khoanh: chỉ thấy người ở nhóm được gán
  const scoped = compile("contacts", {}, staffCtx);
  assert.match(scoped.sql, /EXISTS \(SELECT 1 FROM group_member gm WHERE gm\.zalo_uid = c\.zalo_uid AND gm\.group_id IN \(\?\)\)/);
  assert.deepEqual(scoped.params[0], [11, 12]);
});

test("search: thoát % _ \\, bỏ khi thực thể không có ô tìm", () => {
  const out = compile("contacts", { search: "50%_\\" }, managerCtx);
  assert.ok(out.params.includes("%50\\%\\_\\\\%"));
  rejects(() => compile("messages", { search: "x", filters: [{ field: "thread_id", op: "eq", value: 1 }] }), "invalid_value", /search/);
  // Chuỗi chỉ toàn khoảng trắng = không tìm
  assert.doesNotMatch(compile("groups", { search: "   " }).sql, /LIKE/);
});

test("Việc / ticket lọc theo NHÓM NGUỒN: người bị khoanh chỉ thấy nhóm được gán; không Mật → ẩn nhóm Mật", () => {
  for (const entity of ["tasks", "tickets"]) {
    const scoped = compile(entity, {}, staffCtx);
    assert.match(scoped.sql, /t\.tenant_id = \?\) AND \(t\.source_thread_id IN \(\?\) AND \(g\.id IS NULL OR g\.is_confidential = 0\)\)/);
    assert.deepEqual(scoped.params.slice(0, 2), [1, [11, 12]]);
    assert.doesNotMatch(compile(entity, {}, makeCtx(staff({ canViewConfidential: true }))).sql, /is_confidential/);
  }
  assert.doesNotMatch(compile("tickets", {}, adminMatCtx).sql, /source_thread_id IN/);
});

test("lệnh gửi: phạm vi theo người ra lệnh + ẩn lệnh có đích nhóm Mật; Mật bật thì không ẩn", () => {
  const out = compile("send_commands", {}, staffCtx);
  assert.match(out.sql, /c\.requester_uid = \(SELECT ct\.zalo_uid FROM app_user u JOIN contact ct/);
  assert.match(out.sql, /NOT EXISTS \(SELECT 1 FROM send_command_target tx JOIN zalo_group gx/);
  assert.doesNotMatch(compile("send_commands", {}, makeCtx(staff({ canViewConfidential: true }))).sql, /gx\.is_confidential/);
  // Không bao giờ chọn cột danh sách tệp
  rejects(() => compile("send_commands", { fields: ["attachment_ids"] }), "invalid_field");
});

test("cuộc nhắn riêng: bị khoanh phạm vi → không thấy cuộc nào; «mọi nhóm» thì thấy", () => {
  assert.match(compile("conversations", {}, staffCtx).sql, /1 = 0/);
  assert.doesNotMatch(compile("conversations", {}, makeCtx(staff({ groupIds: null }))).sql, /1 = 0/);
});

test("mọi thực thể có cột dùng chung không lộ khóa lưu trữ / đường dẫn nguồn của tệp", () => {
  rejects(() => compile("files", { fields: ["storage_key"] }), "invalid_field");
  rejects(() => compile("files", { fields: ["source_url"] }), "invalid_field");
});
