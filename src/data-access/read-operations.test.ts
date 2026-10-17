import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, fakeDb, makeCtx, manager, staff } from "./data-access-test-support.js";
import { findTool } from "./read-tool-catalog.js";
import { runTool } from "./tool-runner.js";

// Công cụ miền (search_messages, get_thread_messages, get_file_text, metrics_summary) chạy trên DB giả: kiểm câu SQL sinh ra,
// chốt chặn phạm vi / Mật, giới hạn và định dạng kết quả. Không cần MySQL.

const tool = (name: string) => findTool(name)!;
const GUARD = /FROM zalo_group g WHERE g\.id = \?|FROM attachment a JOIN zalo_group g/;

/** DB giả cho công cụ có chốt chặn: câu chốt trả `visible`, câu còn lại trả `rows`. */
function guarded(visible: boolean, rows: Record<string, unknown>[]) {
  return fakeDb((sql) => (GUARD.test(sql) ? (visible ? [{ ok: 1 }] : []) : rows));
}

const searchRow = { id: 5, group_id: 12, thread_name: "KD Miền Tây", sender_name: "Huy", sent_at: new Date("2026-10-16T02:12:04Z"), text: "Báo giá Flowertop lô tháng 11" };
const lastSelect = (queries: { sql: string; params: unknown[] }[]) => queries.filter((query) => query.sql.includes("FROM message_search")).at(-1)!;

test("search_messages: người bị khoanh phạm vi → chỉ tìm trong nhóm được gán; không Mật → loại nhóm Mật; chỉ cuộc đọc được", async () => {
  const { db, queries } = fakeDb((sql) => (sql.includes("FROM message_search") ? [searchRow] : []));
  const result = await runTool(tool("search_messages"), makeCtx(staff(), {}, db), { query: "flowertop" });
  assert.equal(result.isError, false);
  const select = lastSelect(queries);
  assert.match(select.sql, /s\.group_id IN \(\?\)/);
  assert.match(select.sql, /g\.is_confidential = 0/);
  assert.match(select.sql, /\(g\.thread_type = \? OR g\.read_messages = 1\)/);
  assert.ok(select.params.some((param) => Array.isArray(param) && param.join() === "11,12"));
  const out = result.structured as { hits: Record<string, unknown>[]; untrusted_fields: string[] };
  assert.deepEqual(out.hits[0], { message_id: 5, thread_id: 12, thread_name: "KD Miền Tây", sender_name: "Huy", sent_at: "2026-10-16T09:12:04+07:00", snippet: "Báo giá Flowertop lô tháng 11" });
  assert.deepEqual(out.untrusted_fields, ["snippet", "thread_name", "sender_name"]);
  assert.equal(tool("search_messages").output.safeParse(result.structured).success, true);
});

test("search_messages: quản trị («mọi nhóm») không có điều kiện nhóm; có Mật thì không loại nhóm Mật", async () => {
  const { db, queries } = fakeDb((sql) => (sql.includes("FROM message_search") ? [searchRow] : []));
  await runTool(tool("search_messages"), makeCtx(admin({ canViewConfidential: true }), {}, db), { query: "flowertop" });
  const select = lastSelect(queries);
  assert.doesNotMatch(select.sql, /s\.group_id IN/);
  assert.doesNotMatch(select.sql, /is_confidential/);
});

test("search_messages: thread_ids giao với phạm vi được gán — nhóm ngoài phạm vi bị bỏ, giao rỗng → không kết quả", async () => {
  const { db, queries } = fakeDb((sql) => (sql.includes("FROM message_search") ? [searchRow] : []));
  await runTool(tool("search_messages"), makeCtx(staff(), {}, db), { query: "giá", thread_ids: [12, 99] });
  assert.ok(lastSelect(queries).params.some((param) => Array.isArray(param) && param.join() === "12"));
  const none = fakeDb((sql) => (sql.includes("FROM message_search") ? [searchRow] : []));
  const result = await runTool(tool("search_messages"), makeCtx(staff(), {}, none.db), { query: "giá", thread_ids: [99] });
  assert.deepEqual((result.structured as { hits: unknown[] }).hits, []);
  assert.equal(none.queries.some((query) => query.sql.includes("FROM message_search")), false);
});

test("search_messages: ngày sai → invalid_value; from / to hiểu giờ VN; to chỉ có ngày = hết ngày", async () => {
  const { db, queries } = fakeDb((sql) => (sql.includes("FROM message_search") ? [searchRow] : []));
  const ctx = makeCtx(admin(), {}, db);
  const bad = await runTool(tool("search_messages"), ctx, { query: "x", from: "hôm qua" });
  assert.equal(bad.errorCode, "invalid_value");
  await runTool(tool("search_messages"), ctx, { query: "giá", from: "2026-10-01", to: "2026-10-05" });
  const params = lastSelect(queries).params;
  assert.ok(params.some((param) => param instanceof Date && param.toISOString() === "2026-09-30T17:00:00.000Z"));
  assert.ok(params.some((param) => param instanceof Date && param.toISOString() === "2026-10-05T16:59:59.999Z"));
  assert.equal((await runTool(tool("search_messages"), ctx, { query: "" })).errorCode, "invalid_value");
  assert.equal((await runTool(tool("search_messages"), ctx, { query: "x", limit: 51 })).errorCode, "invalid_value");
});

test("get_thread_messages: cuộc ngoài phạm vi / nhóm Mật khi không Mật → not_found, không đọc tin", async () => {
  const { db, queries } = guarded(false, [{ id: 1 }]);
  const result = await runTool(tool("get_thread_messages"), makeCtx(staff(), {}, db), { thread_id: 99 });
  assert.equal(result.errorCode, "not_found");
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /g\.id IN \(\?\) AND g\.is_confidential = 0/);
});

test("get_thread_messages: mặc định tin MỚI NHẤT (truy vấn mới→cũ, trả cũ→mới), kèm tệp, không tin thu hồi", async () => {
  const rows = [
    { id: 30, sent_at: new Date("2026-10-16T03:00:00Z"), sender_uid: "u2", sender_name: "Lan", kind: 2, text: null, quote_text: null, attachment_id: 9, file_name: "bao-gia.xlsx" },
    { id: 29, sent_at: new Date("2026-10-16T02:00:00Z"), sender_uid: "u1", sender_name: "Huy", kind: 0, text: "xin chào", quote_text: "câu cũ", attachment_id: null, file_name: null },
  ];
  const { db, queries } = guarded(true, rows);
  const result = await runTool(tool("get_thread_messages"), makeCtx(staff(), {}, db), { thread_id: 12, limit: 2 });
  const out = result.structured as { items: { id: number; attachment_id: number | null; sent_at: string }[]; has_more: boolean; next: unknown };
  assert.deepEqual(out.items.map((item) => item.id), [29, 30]);
  assert.equal(out.items[1].attachment_id, 9);
  assert.equal(out.items[0].sent_at, "2026-10-16T09:00:00+07:00");
  assert.equal(out.has_more, false);
  assert.equal(out.next, null);
  const select = queries[1];
  assert.match(select.sql, /m\.recalled_at IS NULL/);
  assert.match(select.sql, /ORDER BY m\.sent_at DESC, m\.id DESC LIMIT \?/);
  assert.deepEqual(select.params, [12, 3]);
  assert.equal(tool("get_thread_messages").output.safeParse(result.structured).success, true);
});

test("get_thread_messages: còn tin cũ hơn → has_more + next.before_message_id (đọc lùi); có from → đọc xuôi + next.after_message_id", async () => {
  const mk = (id: number, at: string) => ({ id, sent_at: new Date(at), sender_uid: "u", sender_name: "A", kind: 0, text: `t${id}`, quote_text: null, attachment_id: null, file_name: null });
  const back = guarded(true, [mk(30, "2026-10-16T03:00:00Z"), mk(29, "2026-10-16T02:00:00Z"), mk(28, "2026-10-16T01:00:00Z")]);
  const backOut = (await runTool(tool("get_thread_messages"), makeCtx(admin(), {}, back.db), { thread_id: 12, limit: 2, before_message_id: 31 })).structured as
    { items: { id: number }[]; has_more: boolean; next: { before_message_id?: number } };
  assert.deepEqual(backOut.items.map((item) => item.id), [29, 30]);
  assert.equal(backOut.has_more, true);
  assert.deepEqual(backOut.next, { before_message_id: 29 });
  // queries[1] = kiểm mốc thuộc cuộc; queries[2] = câu chính — con trỏ BỘ ĐÔI (sent_at, id), không phải chỉ id (H1)
  assert.match(back.queries[1].sql, /FROM message m WHERE m\.id = \? AND m\.group_id = \?/);
  assert.match(back.queries[2].sql, /m\.sent_at < \(SELECT c\.sent_at FROM message c WHERE c\.id = \? AND c\.group_id = \?\) OR \(m\.sent_at = \(SELECT c\.sent_at FROM message c WHERE c\.id = \? AND c\.group_id = \?\) AND m\.id < \?\)/);
  assert.match(back.queries[2].sql, /ORDER BY m\.sent_at DESC, m\.id DESC/);
  assert.deepEqual(back.queries[2].params, [12, 31, 12, 31, 12, 31, 3]);
  const forward = guarded(true, [mk(10, "2026-10-01T01:00:00.250Z"), mk(11, "2026-10-01T02:00:00.500Z"), mk(12, "2026-10-01T03:00:00Z")]);
  const forwardOut = (await runTool(tool("get_thread_messages"), makeCtx(admin(), {}, forward.db), { thread_id: 12, limit: 2, from: "2026-10-01" })).structured as
    { items: { id: number }[]; has_more: boolean; next: { from?: string; after_message_id?: number }; notices: string[] };
  assert.deepEqual(forwardOut.items.map((item) => item.id), [10, 11]);
  assert.deepEqual(forwardOut.next, { after_message_id: 11, from: "2026-10-01T09:00:00.500+07:00" });
  assert.equal(forwardOut.notices.length, 1);
  assert.match(forward.queries[1].sql, /m\.sent_at >= \?[\s\S]*ORDER BY m\.sent_at ASC, m\.id ASC/);
  assert.deepEqual(forward.queries[1].params[1], new Date("2026-09-30T17:00:00Z"));
  // Trang sau của chiều xuôi: after_message_id → so bộ đôi `>` (L4: > limit tin cùng mili giây không kẹt)
  const next = guarded(true, [mk(12, "2026-10-01T03:00:00Z")]);
  await runTool(tool("get_thread_messages"), makeCtx(admin(), {}, next.db), { thread_id: 12, limit: 2, from: "2026-10-01", after_message_id: 11 });
  assert.match(next.queries[2].sql, /m\.sent_at > \(SELECT[\s\S]*m\.sent_at = \(SELECT[\s\S]*AND m\.id > \?\)[\s\S]*ORDER BY m\.sent_at ASC, m\.id ASC/);
  // Chỉ after_message_id (không from) cũng đọc xuôi; before + after cùng lúc bị từ chối; mốc không thuộc cuộc → invalid_value
  const both = await runTool(tool("get_thread_messages"), makeCtx(admin(), {}, guarded(true, []).db), { thread_id: 12, before_message_id: 5, after_message_id: 4 });
  assert.equal(both.errorCode, "invalid_value");
  const foreign = fakeDb((sql) => (/FROM zalo_group g WHERE g\.id = \?/.test(sql) ? [{ ok: 1 }] : []));
  const missing = await runTool(tool("get_thread_messages"), makeCtx(admin(), {}, foreign.db), { thread_id: 12, before_message_id: 999 });
  assert.equal(missing.errorCode, "invalid_value");
});

test("get_thread_messages: tin quá dài bị cắt 4 000 ký tự; tổng > 100 000 ký tự cắt bớt tin cuối", async () => {
  const mk = (id: number) => ({ id, sent_at: new Date("2026-10-16T03:00:00Z"), sender_uid: "u", sender_name: "A", kind: 0, text: "d".repeat(4500), quote_text: null, attachment_id: null, file_name: null });
  const { db } = guarded(true, Array.from({ length: 40 }, (_, index) => mk(100 - index)));
  const out = (await runTool(tool("get_thread_messages"), makeCtx(admin(), {}, db), { thread_id: 12, limit: 40 })).structured as
    { items: { text: string }[]; truncated: { rows: boolean; cells: boolean }; has_more: boolean };
  assert.equal(out.items[0].text.length, 4001);
  assert.equal(out.truncated.cells, true);
  assert.equal(out.truncated.rows, true);
  assert.equal(out.has_more, true);
  assert.ok(out.items.length < 40 && out.items.length >= 20);
});

test("get_thread_messages: đầu vào sai → invalid_value (limit > 300, thread_id âm, ngày sai)", async () => {
  const { db } = guarded(true, []);
  const ctx = makeCtx(admin(), {}, db);
  for (const input of [{ thread_id: 1, limit: 301 }, { thread_id: -1 }, { thread_id: 1.5 }, { thread_id: 1, from: "2026-02-30" }, {}]) {
    assert.equal((await runTool(tool("get_thread_messages"), ctx, input)).errorCode, "invalid_value", JSON.stringify(input));
  }
});

test("get_file_text: tệp ngoài phạm vi → not_found; chưa bóc chữ → not_extracted (không tự gọi Gemini)", async () => {
  const hidden = guarded(false, []);
  assert.equal((await runTool(tool("get_file_text"), makeCtx(staff(), {}, hidden.db), { attachment_id: 5 })).errorCode, "not_found");
  assert.equal(hidden.queries.length, 1);
  const raw = guarded(true, [{ file_name: "a.pdf", method: null, total: null, chunk: null }]);
  const result = await runTool(tool("get_file_text"), makeCtx(staff(), {}, raw.db), { attachment_id: 5 });
  const out = result.structured as { status: string; text: string; notices: string[]; total_chars: number };
  assert.equal(out.status, "not_extracted");
  assert.equal(out.text, "");
  assert.equal(out.notices.length, 1);
  assert.equal(raw.queries.length, 2);
});

test("get_file_text: đọc từng đoạn theo offset_chars, có next_offset_chars; unsupported / empty báo trạng thái", async () => {
  const chunk = guarded(true, [{ file_name: "bang-gia.xlsx", method: "xlsx", total: 70_000, chunk: "x".repeat(20_000) }]);
  const result = await runTool(tool("get_file_text"), makeCtx(admin(), {}, chunk.db), { attachment_id: 9, offset_chars: 10_000 });
  const out = result.structured as { status: string; has_more: boolean; next_offset_chars: number; returned_chars: number; untrusted_fields: string[]; file_name: string };
  assert.equal(out.status, "ok");
  assert.equal(out.returned_chars, 20_000);
  assert.equal(out.has_more, true);
  assert.equal(out.next_offset_chars, 30_000);
  assert.deepEqual(out.untrusted_fields, ["text", "file_name"]);
  assert.deepEqual(chunk.queries[1].params, [10_001, 20_000, 9]);
  assert.equal(tool("get_file_text").output.safeParse(result.structured).success, true);
  const last = guarded(true, [{ file_name: "a.txt", method: "text", total: 100, chunk: "y".repeat(40) }]);
  const lastOut = (await runTool(tool("get_file_text"), makeCtx(admin(), {}, last.db), { attachment_id: 1, offset_chars: 60 })).structured as { has_more: boolean; next_offset_chars: number | null };
  assert.equal(lastOut.has_more, false);
  assert.equal(lastOut.next_offset_chars, null);
  const unsupported = guarded(true, [{ file_name: "a.zip", method: "unsupported", total: 0, chunk: null }]);
  assert.equal(((await runTool(tool("get_file_text"), makeCtx(admin(), {}, unsupported.db), { attachment_id: 1 })).structured as { status: string }).status, "unsupported");
  const empty = guarded(true, [{ file_name: "a.txt", method: "text", total: 0, chunk: null }]);
  assert.equal(((await runTool(tool("get_file_text"), makeCtx(admin(), {}, empty.db), { attachment_id: 1 })).structured as { status: string }).status, "empty");
});

test("get_file_text: max_chars > 50 000 hoặc offset âm → invalid_value; che dữ liệu cá nhân áp lên chữ trong tệp", async () => {
  const { db } = guarded(true, [{ file_name: "a.txt", method: "text", total: 30, chunk: "Liên hệ 0912345678" }]);
  const ctx = makeCtx(admin(), { maskPersonal: true }, db);
  assert.equal((await runTool(tool("get_file_text"), ctx, { attachment_id: 1, max_chars: 50_001 })).errorCode, "invalid_value");
  assert.equal((await runTool(tool("get_file_text"), ctx, { attachment_id: 1, offset_chars: -1 })).errorCode, "invalid_value");
  const result = await runTool(tool("get_file_text"), ctx, { attachment_id: 1 });
  assert.equal((result.structured as { text: string }).text, "Liên hệ [SĐT ***678]");
});

test("metrics_summary: Nhân viên bị chặn; đầu vào sai → invalid_value (ngày không có thật, khoảng > 366 ngày, thiếu chỉ tiêu)", async () => {
  assert.equal((await runTool(tool("metrics_summary"), makeCtx(staff()), { metrics: ["ban_hang"], from: "2026-10-01", to: "2026-10-02" })).errorCode, "forbidden");
  const ctx = makeCtx(manager());
  const cases = [
    { metrics: ["ban_hang"], from: "2026-02-30", to: "2026-03-01" },
    { metrics: ["ban_hang"], from: "2025-01-01", to: "2026-10-01" },
    { metrics: ["ban_hang"], from: "2026-10-05", to: "2026-10-01" },
    { metrics: [], from: "2026-10-01", to: "2026-10-02" },
    { metrics: ["ban_hang"], from: "2026-10-01", to: "2026-10-02", group_by: "region" },
  ];
  for (const input of cases) assert.equal((await runTool(tool("metrics_summary"), ctx, input)).errorCode, "invalid_value", JSON.stringify(input));
});
