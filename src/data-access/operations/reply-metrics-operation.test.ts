import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, fakeDb, makeCtx, manager } from "../data-access-test-support.js";
import { findTool, toolsFor } from "../read-tool-catalog.js";
import { runTool } from "../tool-runner.js";
import type { ReplyOutput } from "./reply-metrics-operation.js";

// Phase 15 — reply_metrics đọc bảng reply_metric_daily (NOW = 2026-10-17 12:00 giờ VN)
const tool = () => findTool("reply_metrics")!;

test("có trong danh mục cổng ngoài; Quản lý dùng được", () => {
  assert.ok(toolsFor(makeCtx(manager())).some((definition) => definition.name === "reply_metrics"));
  assert.equal(tool().surfaces, undefined, "chỉ mặt mcp_http");
});

test("SQL lớp tổng: responder_uid = '', phạm vi nhóm + chặn Mật, lọc tài khoản dùng hàm chung, kỳ là ngày; tổng không lọc theo người", async () => {
  const { db, queries } = fakeDb((sql) => (sql.includes("GROUP BY") ? [] : [{ episodes: 0 }]));
  const result = await runTool(tool(), makeCtx(manager(), {}, db), { thread_ids: [11, 11], account_ids: [3], responder_name: "Lan" });
  assert.equal(result.isError, false, result.text);
  assert.equal(queries.length, 2);
  const [grouped, totals] = queries;
  for (const query of [grouped, totals]) {
    assert.match(query.sql, /r\.responder_uid = ''/);
    assert.match(query.sql, /is_confidential = 0/);
    assert.match(query.sql, /g\.id IN \(\?\)/);
    assert.match(query.sql, /bot_group bga/);
    assert.ok(!query.sql.includes("responder_name LIKE"), "lớp tổng không lọc theo tên người");
    assert.deepEqual(query.params.slice(0, 2), ["2026-10-11", "2026-10-17"]);
  }
  assert.match(grouped.sql, /GROUP BY r\.group_id, r\.metric_date/);
  assert.match(grouped.sql, /LIMIT 201/);
});

test("kiểu responder: lớp người (<> ''), lọc tên qua tham số, tổng vẫn đọc lớp tổng; che bật chặn dò SĐT", async () => {
  const { db, queries } = fakeDb((sql) => (sql.includes("GROUP BY") ? [{
    thread_id: null, thread_name: null, responder_uid: "s1", responder_name: "Lan", metric_day: null,
    customer_messages: 0, episodes: 0, answered: 4, answered_late: 1, open_episodes: 0, open_overdue: 0,
    wait_sum_sec: 4 * 1800, wait_max_sec: 7200, work_wait_sum_sec: 4 * 600, work_wait_max_sec: 3000, staff_messages: 9, assistant_replies: 0,
    sla_minutes: 120, computed_at: new Date("2026-10-17T04:30:00Z"),
  }] : [{ episodes: 6, answered: 5, answered_late: 1, open_episodes: 1, open_overdue: 1, sla_minutes: 120, computed_at: new Date("2026-10-17T04:30:00Z") }]));
  const result = await runTool(tool(), makeCtx(admin(), {}, db), { group_by: "responder", responder_name: "La'n" });
  assert.equal(result.isError, false, result.text);
  const [grouped, totals] = queries;
  assert.match(grouped.sql, /r\.responder_uid <> ''/);
  assert.match(grouped.sql, /r\.responder_name LIKE \?/);
  assert.ok(grouped.params.includes("%La''n%") || grouped.params.includes("%La'n%"), "tên qua tham số, không nối chuỗi");
  assert.match(totals.sql, /r\.responder_uid = ''/);
  const out = result.structured as ReplyOutput;
  assert.equal(out.rows[0].responder_name, "Lan");
  assert.equal(out.rows[0].on_time_rate, 0.75);
  assert.equal(out.rows[0].avg_wait_minutes, 30);
  assert.equal(out.rows[0].avg_work_wait_minutes, 10);
  assert.equal(out.rows[0].max_work_wait_minutes, 50);
  assert.equal(out.totals.on_time_rate, 0.8);
  assert.equal(out.sla_minutes, 120);
  assert.equal(out.computed_at, "2026-10-17T11:30:00+07:00");
  assert.ok(out.notices.some((notice) => notice.includes("lớp tổng")));
  assert.match(result.text, /6 lượt khách chờ/);

  const probe = await runTool(tool(), makeCtx(manager(), { maskPersonal: true }), { group_by: "responder", responder_name: "0912 345 678" });
  assert.equal(probe.errorCode, "invalid_value");
});

test("kỳ rỗng → thông báo chưa có số liệu; tỷ lệ / trung bình null khi chưa lượt nào", async () => {
  const { db } = fakeDb((sql) => (sql.includes("GROUP BY") ? [] : [{ episodes: 0, answered: 0 }]));
  const result = await runTool(tool(), makeCtx(admin(), {}, db), { group_by: "day" });
  const out = result.structured as ReplyOutput;
  assert.equal(out.totals.on_time_rate, null);
  assert.equal(out.totals.avg_work_wait_minutes, null);
  assert.ok(out.notices.some((notice) => notice.includes("Chưa có số liệu")));
});
