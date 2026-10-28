// 28/10/2026 — phase 13.4 / 13.6 đầu-cuối trên MySQL THẬT + cổng /mcp HTTP thật:
//   activity_summary đúng số (tin, tệp, người, giờ tin cuối), chỉ trong phạm vi nhóm, nhóm Mật chỉ với khóa có cờ Mật, bỏ tin thu hồi / dòng sự kiện,
//   lọc tài khoản Zalo, che SĐT trong tên người gửi.
//   export_report: xlsx (ô ngày / số có định dạng) và pdf tải được qua link ký sẵn; sửa chữ ký / quá hạn → 403; khóa thu hồi → 403; quyền
//   đổi sau lúc xuất (thu hẹp phạm vi) → 403; quá trần dòng → cắt + báo; mcp_call_log có lượt gọi + lượt tải.
//   Thống kê dùng MCP (loadMcpUsage): số lượt, lỗi, p95, công cụ dùng nhiều nhất.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test_p134 node --import tsx --test test/mcp-reports.integration.test.ts

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";
import { createMcpKey, revokeMcpKey } from "../src/auth/mcp-api-key-store.js";
import type { AppConfig } from "../src/config.js";
import { BotAccountKind, McpAccessLevel, McpCallSource, McpCallStatus, MessageKind, UserRole } from "../src/constants.js";
import { EXPORT_MAX_ROWS, resetExportQuota } from "../src/data-access/operations/export-report-operation.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { logMcpCall } from "../src/mcp/mcp-call-log.js";
import { createMcpGateway, type McpGateway } from "../src/mcp/mcp-http-handler.js";
import { serveMcpReportLink, sharedReportFiles, signReportLink } from "../src/mcp/mcp-report-files.js";
import { loadMcpUsage } from "../src/web/api/mcp-usage-api.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "khoa-ky-thu-nghiem-0123456789abcdef0123456789";

describe("MCP báo cáo: activity_summary + export_report + thống kê (MySQL + HTTP thật)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let gateway: McpGateway;
  let server: http.Server;
  let base = "";
  let token = "";
  let keyId = 0;
  let userId = 0;
  const ids: Record<string, number> = {};

  const config = {
    mcp: { enabled: true, allowedHosts: ["127.0.0.1"], rateLimitPerMinute: 1000, maxConcurrentPerKey: 4, maxConcurrent: 3, queueWaitMs: 1000, badKeyLimitPerMinute: 1000, publicUrl: "", fileRaw: true },
    privacy: { maskPersonalData: true },
    sessionEncryptionKey: SECRET,
  } as unknown as AppConfig;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    gateway = createMcpGateway(db, config, {});
    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const run = async () => {
        if (url.pathname === "/mcp") return gateway.handle(request, response, "198.51.100.7");
        if (await serveMcpReportLink({ db, secret: SECRET, maskPersonalData: true, logCall: (entry) => logMcpCall(db, entry) }, url.pathname, url, request.method ?? "GET", response)) return;
        response.writeHead(404).end();
      };
      run().catch(() => response.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await gateway?.close();
    await db?.end();
  });

  const insertId = async (sql: string, params: unknown[]) => Number((await db.query<any>(sql, params))[0].insertId);

  /** Ngày hôm nay / hôm qua theo giờ VN lúc 10:00 (UTC 03:00) — không phụ thuộc giờ chạy test. */
  const vnDay = (offsetDays: number) => new Date(Date.now() + 7 * 3_600_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
  const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+07:00`);

  async function addMessage(groupId: number, sender: string, name: string, sentAt: Date, options: { kind?: number; recalled?: boolean; file?: boolean } = {}): Promise<number> {
    const messageId = await insertId(
      "INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text, recalled_at) VALUES (?, ?, ?, ?, ?, ?, 'xin chào', ?)",
      [groupId, `m-${Math.random()}`, options.kind ?? MessageKind.Text, sender, name, sentAt, options.recalled ? sentAt : null]);
    if (options.file) {
      await db.query("INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, status) VALUES (?, ?, 'a.png', 'png', 'https://f', 0)", [messageId, groupId]);
    }
    return messageId;
  }

  async function call(name: string, args: Record<string, unknown>, bearer = token): Promise<any> {
    const client = new Client({ name: "reports-it", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
    try {
      return await client.callTool({ name, arguments: args });
    } finally { await client.close(); }
  }
  const data = (result: any) => result.structuredContent as Record<string, any>;

  beforeEach(async () => {
    resetExportQuota();
    sharedReportFiles.clear();
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of ["attachment", "message", "bot_group", "bot_account", "zalo_group", "user_group_scope", "mcp_call_log", "app_user"]) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("DELETE FROM mcp_api_key");
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    userId = await insertId("INSERT INTO app_user (username, email, full_name, role, all_groups, can_view_confidential, is_active) VALUES ('sep', 'sep@ida.vn', 'Sếp IDA', ?, 0, 1, 1)", [UserRole.Manager]);
    ids.ok = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (1, 'g-ok', 'Nhóm Kho', 1)", []);
    ids.secret = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (1, 'g-mat', 'Nhóm Mật', 1, 1)", []);
    ids.other = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (1, 'g-khac', 'Nhóm khác', 1)", []);
    await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?), (?, ?)", [userId, ids.ok, userId, ids.secret]);
    ids.botA = await insertId("INSERT INTO bot_account (label, display_name, kind, is_active) VALUES ('tro-ly', 'Bot Trợ lý', ?, 1)", [BotAccountKind.Assistant]);
    ids.botB = await insertId("INSERT INTO bot_account (label, display_name, kind, is_active) VALUES ('nghe', 'Zalo sếp', ?, 1)", [BotAccountKind.Normal]);
    await db.query("INSERT INTO bot_group (bot_account_id, group_id) VALUES (?, ?), (?, ?)", [ids.botA, ids.ok, ids.botB, ids.secret]);
    const created = await createMcpKey(db, { userId, name: "khoa-bao-cao", accessLevel: McpAccessLevel.Read, days: 30, includeConfidential: false });
    token = created.token;
    keyId = created.id;

    const today = vnDay(0);
    const yesterday = vnDay(1);
    await addMessage(ids.ok, "u1", "Anh Ba 0912345678", at(today, 9));
    await addMessage(ids.ok, "u1", "Anh Ba 0912345678", at(today, 10), { file: true });
    await addMessage(ids.ok, "u2", "Chị Tư", at(today, 11));
    await addMessage(ids.ok, "u2", "Chị Tư", at(yesterday, 15));
    await addMessage(ids.ok, "u3", "Thu hồi", at(today, 12), { recalled: true });
    await addMessage(ids.ok, "", "", at(today, 13), { kind: MessageKind.System });
    await addMessage(ids.secret, "u1", "Anh Ba 0912345678", at(today, 9));
    await addMessage(ids.secret, "u5", "Mật", at(today, 9));
    await addMessage(ids.other, "u9", "Ngoài phạm vi", at(today, 9));
  });

  test("activity_summary: đúng số theo nhóm × ngày, chỉ nhóm trong phạm vi, bỏ Mật / thu hồi / sự kiện, che SĐT trong tên", async () => {
    const result = await call("activity_summary", {});
    assert.ok(!result.isError, JSON.stringify(result));
    const out = data(result);
    assert.deepEqual(out.totals.messages, 4);
    assert.deepEqual([out.totals.files, out.totals.active_senders, out.totals.threads], [1, 2, 1]);
    assert.deepEqual(out.rows.map((row: any) => [row.thread_id, row.day, row.messages, row.files, row.active_senders]),
      [[ids.ok, vnDay(0), 3, 1, 2], [ids.ok, vnDay(1), 1, 0, 1]]);
    assert.equal(out.rows[0].last_message_at, `${vnDay(0)}T11:00:00+07:00`);
    assert.equal(out.period.days, 7);

    const senders = data(await call("activity_summary", { group_by: "sender_day" }));
    const ba = senders.rows.find((row: any) => row.sender_uid === "u1");
    assert.equal(ba.messages, 2);
    assert.ok(!JSON.stringify(senders).includes("0912345678"), "tên người gửi đã che SĐT");
    assert.match(ba.sender_name, /\[SĐT \*\*\*678\]/);
  });

  test("activity_summary: khóa có cờ Mật thấy nhóm Mật; lọc tài khoản Zalo; kỳ quá 92 ngày bị từ chối", async () => {
    const secretKey = await createMcpKey(db, { userId, name: "khoa-mat", accessLevel: McpAccessLevel.Read, days: 30, includeConfidential: true });
    const withSecret = data(await call("activity_summary", { group_by: "thread_sender" }, secretKey.token));
    assert.equal(withSecret.totals.messages, 6);
    assert.ok(withSecret.rows.some((row: any) => row.thread_id === ids.secret));
    assert.ok(!withSecret.rows.some((row: any) => row.thread_id === ids.other), "ngoài phạm vi nhóm vẫn bị chặn");

    const onlyB = data(await call("activity_summary", { account_ids: [ids.botB] }, secretKey.token));
    assert.deepEqual([...new Set(onlyB.rows.map((row: any) => row.thread_id))], [ids.secret]);
    const onlyBNoSecret = data(await call("activity_summary", { account_ids: [ids.botB] }));
    assert.equal(onlyBNoSecret.totals.messages, 0, "khóa không Mật lọc theo tài khoản cũng không lộ nhóm Mật");

    const tooWide = await call("activity_summary", { from: "2026-01-01", to: "2026-10-01" });
    assert.equal(tooWide.isError, true);
    assert.match(JSON.stringify(tooWide.structuredContent ?? tooWide.content), /92/);
  });

  test("export_report xlsx: link tải đúng tệp, ô ngày / số có định dạng; sửa chữ ký / quá hạn → 403; khóa thu hồi → 403", async () => {
    const result = await call("export_report", { source: "activity_summary", args: { group_by: "thread_day" }, format: "xlsx", title: "Hoạt động tuần" });
    assert.ok(!result.isError, JSON.stringify(result));
    const out = data(result);
    assert.equal(out.rows, 2);
    assert.ok(out.download_url.startsWith(`${base}/mcp-reports/`));
    assert.ok(out.download_expires_in_seconds >= 300 && out.download_expires_in_seconds <= 900);
    const download = await fetch(out.download_url);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /\.xlsx/);
    const workbook = XLSX.read(Buffer.from(await download.arrayBuffer()), { type: "buffer", cellNF: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
    const headerIndex = rows.findIndex((row) => Array.isArray(row) && row[0] === "Ngày");
    assert.ok(headerIndex > 0, "có hàng tiêu đề cột");
    assert.deepEqual(rows[headerIndex], ["Ngày", "Mã cuộc", "Nhóm / cuộc", "Số tin", "Số tệp", "Người hoạt động", "Tin cuối"]);
    const dayCell = sheet[XLSX.utils.encode_cell({ r: headerIndex + 1, c: 0 })];
    assert.equal(dayCell.t, "n");
    assert.equal(dayCell.z, "dd/mm/yyyy");
    assert.equal(sheet[XLSX.utils.encode_cell({ r: headerIndex + 1, c: 6 })].z, "dd/mm/yyyy hh:mm");
    assert.equal(sheet[XLSX.utils.encode_cell({ r: headerIndex + 1, c: 3 })].v, 3);

    assert.equal((await fetch(out.download_url.replace(/s=.{4}/, "s=AAAA"))).status, 403);
    assert.equal((await fetch(out.download_url.replace(/s=[^&]+/, "s=ngan"))).status, 403);
    const reportToken = /\/mcp-reports\/([^?]+)/.exec(out.download_url)![1];
    assert.equal((await fetch(signReportLink(base, reportToken, keyId, Date.now() - 5000, SECRET))).status, 403, "link quá hạn");
    assert.equal((await fetch(signReportLink(base, reportToken, keyId + 999, Date.now() + 60_000, SECRET))).status, 404, "khóa khác không lấy được tệp của khóa này");

    const [logged] = await db.query<RowDataPacket[]>("SELECT tool, status, row_count FROM mcp_call_log WHERE key_id = ? ORDER BY id", [keyId]);
    assert.deepEqual(logged.map((row) => row.tool), ["export_report", "export_report_download"]);
    assert.deepEqual(logged.map((row) => Number(row.row_count)), [2, 2]);

    await revokeMcpKey(db, keyId, "test");
    assert.equal((await fetch(out.download_url)).status, 403, "khóa thu hồi thì link cũ bị chặn");
  });

  test("export_report pdf + query_records: tệp PDF thật; quyền đổi sau lúc xuất (thu hẹp phạm vi) → 403", async () => {
    const result = await call("export_report", {
      source: "query_records", format: "pdf",
      args: { entity: "messages", filters: [{ field: "thread_id", op: "eq", value: ids.ok }], fields: ["id", "sender_name", "sent_at", "text"] },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    const out = data(result);
    assert.equal(out.rows, 5, "query_records messages: mọi tin chưa thu hồi của nhóm (kể cả dòng sự kiện)");
    const download = await fetch(out.download_url);
    assert.equal(download.status, 200);
    assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 4).toString(), "%PDF");

    // Nhóm ngoài phạm vi: máy chủ chạy lại theo quyền khóa nên không ra dòng nào (không tin dữ liệu AI)
    const outside = data(await call("export_report", { source: "query_records", args: { entity: "messages", filters: [{ field: "thread_id", op: "eq", value: ids.other }] } }));
    assert.equal(outside.rows, 0);

    await db.query("DELETE FROM user_group_scope WHERE user_id = ? AND group_id = ?", [userId, ids.secret]);
    assert.equal((await fetch(out.download_url)).status, 403, "phạm vi nhóm đổi → phải xuất lại");
  });

  test("export_report: quá trần dòng thì cắt và báo truncated; tham số nguồn sai → invalid_value", async () => {
    const day = vnDay(0);
    const values = Array.from({ length: EXPORT_MAX_ROWS.pdf + 5 }, (_, index) => [ids.ok, `bulk-${index}`, 0, "u7", "Hàng loạt", at(day, 8), "x"]);
    await db.query("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES ?", [values]);
    const result = await call("export_report", {
      source: "query_records", format: "pdf", args: { entity: "messages", filters: [{ field: "thread_id", op: "eq", value: ids.ok }], fields: ["id", "sent_at"] },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(data(result).rows, EXPORT_MAX_ROWS.pdf);
    assert.equal(data(result).truncated, true);
    assert.match(data(result).notices.join(" "), /cắt/);

    const bad = await call("export_report", { source: "query_records", args: { entity: "khong-co" } });
    assert.equal(bad.isError, true);
  });

  test("thống kê dùng MCP: số lượt, lỗi, p95, công cụ dùng nhiều nhất theo khóa", async () => {
    const entry = { userId, tenantId: 1, keyId, source: McpCallSource.Http, args: {}, rowCount: 3, resultChars: 400, clientIp: null };
    for (const duration of [10, 20, 30, 40, 1000]) await logMcpCall(db, { ...entry, tool: "query_records", durationMs: duration, status: McpCallStatus.Ok });
    await logMcpCall(db, { ...entry, tool: "activity_summary", durationMs: 50, status: McpCallStatus.Error });
    await logMcpCall(db, { ...entry, keyId: null, source: McpCallSource.Assistant, tool: "whoami", durationMs: 5, status: McpCallStatus.Ok });
    const usage = await loadMcpUsage(db, 1, { days: 7, groupBy: "key", sources: [McpCallSource.Http] });
    assert.equal(usage.totals.calls, 6, "mặc định chỉ cổng ngoài");
    assert.equal(usage.totals.errors, 1);
    assert.equal(usage.totals.p95_ms, 1000);
    assert.equal(usage.daily.length, 1);
    assert.equal(usage.daily[0].subject_id, keyId);
    assert.match(usage.daily[0].subject_name, /khoa-bao-cao/);
    assert.equal(usage.daily[0].owner_name, "Sếp IDA");
    assert.equal(usage.daily[0].rows, 18);
    assert.equal(usage.daily[0].est_tokens, 600);
    assert.deepEqual(usage.top_tools.map((row) => [row.tool, row.calls]), [["query_records", 5], ["activity_summary", 1]]);
    const all = await loadMcpUsage(db, 1, { days: 7, groupBy: "user", sources: [McpCallSource.Http, McpCallSource.Assistant, McpCallSource.AssistantCommand] });
    assert.equal(all.totals.calls, 7);
    assert.equal(all.daily[0].subject_name, "Sếp IDA");
  });
});
