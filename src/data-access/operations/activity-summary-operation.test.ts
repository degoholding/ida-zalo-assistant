import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { admin, fakeDb, makeCtx, manager, NOW } from "../data-access-test-support.js";
import { findTool } from "../read-tool-catalog.js";
import { runTool } from "../tool-runner.js";
import { ACTIVITY_MAX_DAYS, resolveActivityPeriod } from "./activity-summary-operation.js";
import { EXPORTS_PER_MINUTE, chargeExportQuota, resetExportQuota } from "./export-report-operation.js";

// NOW = 2026-10-17 12:00 giờ VN
const tool = (name: string) => findTool(name)!;

test("kỳ mặc định 7 ngày tới hết hôm nay (giờ VN); to tính cả ngày; ngược / quá 92 ngày / sai khuôn bị từ chối", () => {
  const period = resolveActivityPeriod({}, NOW);
  assert.deepEqual([period.from, period.to, period.days], ["2026-10-11", "2026-10-17", 7]);
  assert.equal(period.start.toISOString(), "2026-10-10T17:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-10-17T17:00:00.000Z");
  assert.equal(resolveActivityPeriod({ from: "2026-10-05", to: "2026-10-05" }, NOW).days, 1);
  // 23:30 giờ VN vẫn là «hôm nay» VN dù UTC còn ngày hôm trước / đã sang ngày sau
  assert.equal(resolveActivityPeriod({}, new Date("2026-10-17T16:30:00Z")).to, "2026-10-17");
  assert.equal(resolveActivityPeriod({}, new Date("2026-10-17T17:30:00Z")).to, "2026-10-18");
  assert.throws(() => resolveActivityPeriod({ from: "2026-10-06", to: "2026-10-05" }, NOW), /trước/);
  assert.throws(() => resolveActivityPeriod({ from: "2026-01-01", to: "2026-10-05" }, NOW), new RegExp(String(ACTIVITY_MAX_DAYS)));
  assert.equal(resolveActivityPeriod({ from: "2026-07-07", to: "2026-10-06" }, NOW).days, 92);
  for (const bad of ["2026-02-30", "17/10/2026", "2026-10-05T10:00", ""]) {
    assert.throws(() => resolveActivityPeriod({ from: bad || "x", to: "2026-10-05" }, NOW), /YYYY-MM-DD/, bad);
  }
});

test("SQL: phạm vi nhóm + chặn nhóm Mật + bỏ thu hồi / sự kiện; lọc tài khoản dùng hàm chung; mọi giá trị qua tham số", async () => {
  const { db, queries } = fakeDb((sql) => (sql.includes("GROUP BY") ? [] : [{ messages: 0 }]));
  const result = await runTool(tool("activity_summary"), makeCtx(manager(), {}, db), {
    account_ids: [3, 3], thread_ids: [11], sender_uids: ["u1"], sender_name: "Ba'; DROP", group_by: "sender_day",
  });
  assert.equal(result.isError, false, result.text);
  assert.equal(queries.length, 2);
  const [grouped, totals] = queries;
  for (const query of [grouped, totals]) {
    assert.match(query.sql, /m\.recalled_at IS NULL/);
    assert.match(query.sql, /m\.kind <> 9/);
    assert.match(query.sql, /is_confidential = 0/);
    assert.match(query.sql, /g\.id IN \(\?\)/, "phạm vi nhóm của Quản lý");
    assert.match(query.sql, /bot_group bga/, "lọc tài khoản Zalo bằng threadOfAccountsCondition");
    assert.ok(!query.sql.includes("DROP"), "chữ người gọi không vào SQL");
    assert.ok(query.params.some((param) => Array.isArray(param) && param.length === 1 && param[0] === 3), "id tài khoản bỏ trùng");
  }
  assert.match(grouped.sql, /GROUP BY m\.sender_uid/);
  assert.match(grouped.sql, /LIMIT 201/);
});

test("khóa có cờ Mật: không thêm điều kiện chặn Mật; quản trị không khoanh nhóm", async () => {
  const { db, queries } = fakeDb(() => []);
  await runTool(tool("activity_summary"), makeCtx(admin({ canViewConfidential: true }), {}, db), {});
  assert.ok(!queries[0].sql.includes("is_confidential = 0"));
  assert.ok(!/g\.id IN \(\?\)/.test(queries[0].sql));
});

test("che bật: không cho dò SĐT qua sender_name; max_rows ngoài trần bị zod chặn", async () => {
  const masked = makeCtx(manager(), { maskPersonal: true });
  const probe = await runTool(tool("activity_summary"), masked, { sender_name: "0912 345 678" });
  assert.equal(probe.errorCode, "invalid_value");
  const tooMany = await runTool(tool("activity_summary"), makeCtx(manager()), { max_rows: 5000 });
  assert.equal(tooMany.errorCode, "invalid_value");
});

test("export_report chỉ hiện khi cổng có bộ đệm báo cáo; trần lượt xuất mỗi phút theo khóa", () => {
  assert.equal(tool("export_report").available(makeCtx(manager())), false);
  const withFiles = makeCtx(manager(), { reportFiles: { publish: () => null } });
  assert.equal(tool("export_report").available(withFiles), true);
  assert.equal(tool("activity_summary").surfaces, undefined, "chỉ cổng ngoài mcp_http");
  assert.equal(tool("export_report").surfaces, undefined);
  resetExportQuota();
  for (let index = 0; index < EXPORTS_PER_MINUTE; index += 1) chargeExportQuota("k1", 1000);
  assert.throws(() => chargeExportQuota("k1", 1000), /quá nhiều/);
  chargeExportQuota("k2", 1000);
  chargeExportQuota("k1", 61_001);
  resetExportQuota();
});

test("export_report: máy chủ chưa khai gốc công khai → invalid_state; thực thể ngoài quyền hoặc args sai → invalid_value", async () => {
  resetExportQuota();
  const { db } = fakeDb((sql) => (sql.includes("GROUP BY") ? [{ thread_id: 11, thread_name: "Kho", activity_day: "2026-10-17", messages: 2, files: 0, active_senders: 1, threads: 1, last_message_at: NOW }] : [{ messages: 2 }]));
  const ctx = makeCtx(manager(), { reportFiles: { publish: () => null } }, db);
  const noBase = await runTool(tool("export_report"), ctx, { source: "activity_summary", args: {} });
  assert.equal(noBase.errorCode, "invalid_state");
  const badArgs = await runTool(tool("export_report"), ctx, { source: "activity_summary", args: { group_by: "theo_gio" } });
  assert.equal(badArgs.errorCode, "invalid_value");
  assert.match(badArgs.text, /group_by/);
  const notReadable = await runTool(tool("export_report"), ctx, { source: "query_records", args: { entity: "audit_log" } });
  assert.equal(notReadable.errorCode, "invalid_value", "thực thể ngoài quyền bị chặn ở sơ đồ của query_records");

  let published: { fileName: string; data: Buffer; rowCount: number } | null = null;
  const ok = await runTool(tool("export_report"), makeCtx(manager(), {
    maskPersonal: true, reportFiles: { publish: (file) => { published = file; return { url: "https://bot.vn/mcp-reports/x", expiresInSeconds: 600 }; } },
  }, db), { source: "activity_summary", args: {}, format: "xlsx", title: "Báo cáo gọi 0912345678" });
  assert.equal(ok.isError, false, ok.text);
  assert.ok(published);
  const file = published as unknown as { fileName: string; data: Buffer; rowCount: number };
  assert.equal(file.rowCount, 1);
  assert.match(file.fileName, /\.xlsx$/);
  assert.ok(!file.fileName.includes("0912345678"), "tên tệp đã che SĐT");
  const sheet = XLSX.read(file.data, { type: "buffer" });
  const firstCell = String(sheet.Sheets[sheet.SheetNames[0]].A1.v);
  assert.match(firstCell, /\[SĐT \*\*\*678\]/, "tiêu đề trong tệp đã che SĐT");
  resetExportQuota();
});
