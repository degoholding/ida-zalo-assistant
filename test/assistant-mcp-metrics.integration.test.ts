// Họ `metrics` qua MCP (phase 11 của kế hoạch assistant-through-mcp): AssistantService THẬT + mô hình giả có kịch bản + MySQL thật.
// Vàng: cùng câu hỏi số liệu (ma trận kỳ × khu vực × nhân viên × chia dòng) cho CÙNG câu trả lời công cụ ở hai chế độ (họ tắt / bật);
// Nhân viên web bị từ chối như cũ; MCP ngoài `metrics_summary` hỏi được theo tên chỉ tiêu + kỳ chữ.
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p11 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { foldText } from "../src/alerts/keyword-matcher.js";
import { AssistantService, type AssistantRequest } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import type { AssistantMcpBridge } from "../src/assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { CatalogKind, ContactRole, McpCallSource, UserRole } from "../src/constants.js";
import { buildDataAccessContext } from "../src/data-access/data-access-context.js";
import { DataAccessError } from "../src/data-access/data-access-errors.js";
import { metricsSummaryTool } from "../src/data-access/operations/metrics-summary-operation.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import type { Principal } from "../src/auth/principal.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-14T05:00:00Z"); // thứ 4 14/10/2026, 12:00 giờ VN
const TABLES = ["mcp_call_log", "assistant_turn", "message", "group_member", "bot_group", "zalo_group", "contact_tag", "contact", "company",
  "session_event", "bot_account", "user_group_scope", "app_user", "metric_value", "metric_source", "catalog_entry"];

type Parts = GeminiContent["parts"];
class ScriptedModel implements ModelClient {
  readonly requests: { contents: GeminiContent[]; tools: string[] }[] = [];
  constructor(private readonly turns: Parts[]) {}
  async generate(request: { contents: GeminiContent[]; tools: { name: string }[] }) {
    this.requests.push({ contents: structuredClone(request.contents), tools: request.tools.map((tool) => tool.name) });
    const turn = this.turns.shift();
    if (!turn) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: turn }, inputTokens: 10, outputTokens: 5 };
  }
}

class CountingGate extends ConcurrencyGate {
  acquires = 0;
  override acquire(): ReturnType<ConcurrencyGate["acquire"]> {
    this.acquires += 1;
    return super.acquire();
  }
}

describe("họ metrics qua MCP", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId = 0;

  before(async () => { await runMigrations(databaseUrl!); db = createPool(databaseUrl!); });
  after(async () => { await db?.end(); });

  async function addAsker(uid: string, role: UserRole, contactRole: ContactRole) {
    await db.query("INSERT INTO contact (zalo_uid, display_name, role) VALUES (?, ?, ?)", [uid, uid, contactRole]);
    const [contact] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = ?", [uid]);
    await db.query(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, 1, 0, 1)",
      [`${uid}@ida.vn`, uid, uid, role, contact[0].id]);
  }

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    botId = ((await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')"))[0] as any).insertId;
    await addAsker("u-sep", UserRole.Manager, ContactRole.DepartmentHead);
    await addAsker("u-nv", UserRole.Staff, ContactRole.DepartmentHead);
    const mapping = { date: "Ngày", staff: "Nhân viên", area: "Khu vực", metrics: [{ code: "doanh_so", label: "Doanh số", column: "Doanh số", unit: "đ", aggregate: "sum" }] };
    const [src] = await db.query<any>("INSERT INTO metric_source (name, spreadsheet_id, sheet_title, mapping, last_ok_at) VALUES ('BCSale', 'abc', 'NKCV', ?, '2026-10-14 04:30:00')", [JSON.stringify(mapping)]);
    const staffIds = new Map<string, number>();
    for (const [code, name] of [["NV01", "Nguyễn Tám"], ["NV02", "Trần Bảy"]]) {
      const [entry] = await db.query<any>("INSERT INTO catalog_entry (kind, code, name, region, expects_report) VALUES (?,?,?,?,1)", [CatalogKind.Staff, code, name, "Miền Tây"]);
      staffIds.set(name, entry.insertId);
    }
    const rows: [string, string, string, number][] = [
      ["2026-10-14", "Nguyễn Tám", "Cần Thơ", 50], ["2026-10-14", "Trần Bảy", "Cà Mau", 70], ["2026-10-13", "Nguyễn Tám", "Cần Thơ", 100],
      ["2026-10-07", "Nguyễn Tám", "Cần Thơ", 100], ["2026-10-06", "Trần Bảy", "Cà Mau", 40], ["2026-10-01", "Trần Bảy", "Cà Mau", 30],
      ["2026-09-30", "Nguyễn Tám", "Cần Thơ", 60], ["2026-09-12", "Trần Bảy", "Cà Mau", 90],
    ];
    for (const [date, staff, area, value] of rows) {
      await db.query(
        `INSERT INTO metric_value (source_id, metric_date, staff_key, staff_name, catalog_entry_id, area_key, area_name, metric_code, value) VALUES (?, ?, ?, ?, ?, ?, ?, 'doanh_so', ?)`,
        [src.insertId, date, `n:${staff}`, staff, staffIds.get(staff), foldText(area).trim(), area, value]);
    }
  });

  const service = (model: ModelClient, families: string, gate: ConcurrencyGate) => {
    const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies(families), gate };
    return new AssistantService(db, model, "gia-lap", { maxPerHour: 1000, dailyTokenCap: 100_000_000 }, () => NOW, { coreQueryTools: true, mcpBridge: bridge });
  };

  /** Hỏi một câu gọi `query_metrics`; trả đúng thứ MÔ HÌNH nhận lại (phản hồi công cụ) + tên công cụ lượt đó khai. */
  async function askMetrics(families: string, uid: string, args: Record<string, unknown>, gate: ConcurrencyGate = new ConcurrencyGate(5, 1000)) {
    const model = new ScriptedModel([[{ functionCall: { name: "query_metrics", args } }], [{ text: "xong" }]]);
    const contact = (await findContactByUid(db, uid))!;
    const request: AssistantRequest = { botAccountId: botId, contact, threadId: 1, questionMessageId: null, question: "số liệu" };
    await service(model, families, gate).answer(request);
    const response = model.requests[1].contents.at(-1)!.parts[0] as { functionResponse?: { response: unknown } };
    return { response: response.functionResponse?.response, tools: model.requests[0].tools };
  }

  test("vàng: ma trận kỳ × khu vực × nhân viên × chia dòng cho cùng câu trả lời ở hai chế độ", async () => {
    const periods: Record<string, unknown>[] = [
      { period: "today" }, { period: "yesterday" }, { period: "this_week" }, { period: "last_week" }, { period: "this_month" },
      { period: "last_month" }, { period: "custom", from: "2026-10-01", to: "2026-10-14" }, {},
    ];
    const extras: Record<string, unknown>[] = [{}, { area: "Cần Thơ" }, { staff: "Tám" }, { group_by: "staff" }, { group_by: "area" }, { group_by: "date" }, { area: "Miền Bắc" }];
    let withNumbers = 0;
    for (const period of periods) for (const extra of extras) {
      const args = { metric: "doanh số", ...period, ...extra };
      const legacy = await askMetrics("", "u-sep", args);
      const viaMcp = await askMetrics("metrics", "u-sep", args);
      assert.deepEqual(viaMcp.response, legacy.response, JSON.stringify(args));
      if (typeof (legacy.response as { total?: unknown }).total === "number") withNumbers += 1;
    }
    assert.ok(withNumbers >= 15, `ma trận phải có đủ ca có số (có ${withNumbers})`);
    // Số cụ thể (neo vào dữ liệu, không chỉ «cũ = mới»): tuần này T2 12/10 → hôm nay
    const week = (await askMetrics("metrics", "u-sep", { metric: "doanh số", period: "this_week" })).response as Record<string, unknown>;
    assert.equal(week.total, 220);
    assert.equal(week.previous_total, 140);
    assert.equal(week.previous_period, "2026-10-05 – 2026-10-07");
    assert.match(String(week.source), /BCSale, đọc lúc 11:30/);
  });

  test("ca lỗi giống nhau: chỉ tiêu lạ (kèm danh sách), nhiều chỉ tiêu, nhân viên lạ, kỳ tùy chọn sai", async () => {
    for (const args of [{ metric: "lợi nhuận" }, { metric: "" }, { metric: "doanh số", staff: "Không ai" }, { metric: "doanh số", period: "custom", from: "14/10" }]) {
      const legacy = await askMetrics("", "u-sep", args);
      const viaMcp = await askMetrics("metrics", "u-sep", args);
      assert.deepEqual(viaMcp.response, legacy.response, JSON.stringify(args));
    }
    assert.deepEqual(((await askMetrics("metrics", "u-sep", { metric: "lợi nhuận" })).response as any).available_metrics, ["Doanh số"]);
  });

  test("họ bật: có tools/call thật (cổng + nhật ký nguồn 2); họ tắt thì không", async () => {
    const off = new CountingGate(5, 1000);
    await askMetrics("", "u-sep", { metric: "doanh số" }, off);
    assert.equal(off.acquires, 0);
    const on = new CountingGate(5, 1000);
    await askMetrics("metrics", "u-sep", { metric: "doanh số" }, on);
    assert.equal(on.acquires, 1);
    assert.equal(on.inFlight, 0);
    // Dòng nhật ký có thể ghi sau khi lời gọi trả về: chờ ngắn thay vì đọc ngay
    let log: RowDataPacket[] = [];
    for (let attempt = 0; attempt < 20 && log.length === 0; attempt += 1) {
      [log] = await db.query<RowDataPacket[]>("SELECT tool, source, key_id, status FROM mcp_call_log");
      if (log.length === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(log.map((row) => [row.tool, Number(row.source), row.key_id, Number(row.status)]), [["query_metrics", McpCallSource.Assistant, null, 0]]);
  });

  test("Nhân viên web bị từ chối như cũ ở cả hai chế độ", async () => {
    const legacy = await askMetrics("", "u-nv", { metric: "doanh số" });
    const viaMcp = await askMetrics("metrics", "u-nv", { metric: "doanh số" });
    assert.deepEqual(legacy.response, { error: "Anh/chị chưa được cấp quyền xem số liệu qua bot." });
    assert.deepEqual(viaMcp.response, legacy.response);
  });

  test("MCP ngoài: metrics_summary theo tên chỉ tiêu + kỳ chữ trả số; kiểu cũ (mã + from / to) không đổi; lỗi rõ", async () => {
    const principal = (role: UserRole): Principal => ({ userId: 1, tenantId: 1, fullName: "Ngoài", email: "x@ida.vn", role, groupIds: null });
    const ctx = (role: UserRole) => buildDataAccessContext({ db, principal: principal(role), maskPersonal: false, source: McpCallSource.Http, now: NOW });
    const byName = await metricsSummaryTool.handler(ctx(UserRole.Manager), { metric_name: "doanh số", period: "this_month", group_by: "area" });
    assert.equal((byName.structured.total as { value: number }).value, 220 + 100 + 40 + 30);
    const byCode = await metricsSummaryTool.handler(ctx(UserRole.Manager), { metrics: ["doanh_so"], from: "2026-10-01", to: "2026-10-14", group_by: "area" });
    assert.deepEqual(byCode.structured.rows, byName.structured.rows, "cùng kỳ, cùng dòng");
    await assert.rejects(() => metricsSummaryTool.handler(ctx(UserRole.Manager), { metric_name: "lợi nhuận", period: "today" }),
      (error: unknown) => error instanceof DataAccessError && error.code === "invalid_value" && /Doanh số/.test(error.message));
    await assert.rejects(() => metricsSummaryTool.handler(ctx(UserRole.Manager), { metric_name: "doanh số" }),
      (error: unknown) => error instanceof DataAccessError && error.code === "invalid_value");
    assert.equal(metricsSummaryTool.available(ctx(UserRole.Staff)), false, "Nhân viên không thấy công cụ");
  });
});
