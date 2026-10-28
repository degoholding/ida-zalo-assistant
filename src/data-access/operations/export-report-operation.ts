import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { maskPersonalData, maskPersonalDataDeep } from "../../privacy/personal-data.js";
import { vnTimestamp } from "../../reports/report-exporter.js";
import { reportFileName } from "../../reports/report-table.js";
import { buildExportPdf, buildExportWorkbook, type ExportColumn, type ExportTable } from "../../reports/export-table-file.js";
import { REPORT_MAX_FILE_BYTES } from "../../mcp/mcp-report-files.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { DEFAULT_CELL_CHARS } from "../entity-definition.js";
import { findEntity, readableEntities } from "../entity-registry.js";
import { compileQuery } from "../query-compiler.js";
import { MAX_PAGE_SIZE, type QueryRequest } from "../query-dsl-schema.js";
import { runQuery } from "../query-executor.js";
import { MASK_NOTICE, clipText, shapeValue } from "../result-envelope.js";
import type { ToolDefinition } from "../tool-definition.js";
import { activitySummaryTool, collectActivitySummary, type ActivityGrouping, type ActivityInput } from "./activity-summary-operation.js";
import { queryRecordsTool } from "./query-records-operation.js";

// export_report (phase 13.4, 28/10/2026): xuất Excel / PDF từ MỘT yêu cầu đọc đã có (query_records hoặc activity_summary). AI chỉ gửi THAM SỐ —
// máy chủ chạy lại truy vấn với đúng quyền của khóa (phạm vi nhóm, nhóm Mật, cuộc riêng, cột cần quyền riêng), không nhận dữ liệu AI gửi lên. Tệp
// đi qua che SĐT / STK / CCCD theo cài đặt như kết quả công cụ, cất tạm trong bộ đệm có hạn (mcp-report-files.ts) và trả link tải ký sẵn 10 phút.
// Trần: 5 000 dòng Excel, 2 000 dòng PDF, 10 MB một tệp, vài lượt xuất mỗi phút mỗi khóa (mỗi lượt có thể chạy tới 50 trang truy vấn).

export const EXPORT_MAX_ROWS = { xlsx: 5000, pdf: 2000 } as const;
export const EXPORTS_PER_MINUTE = 6;
const TITLE_MAX = 120;

const inputSchema = z.object({
  source: z.enum(["query_records", "activity_summary"]).describe("Công cụ đọc làm nguồn dữ liệu cho tệp."),
  args: z.record(z.string(), z.unknown()).describe(
    "Đúng tham số đã (hoặc sẽ) gửi cho công cụ nguồn, vd { entity: 'tasks', filters: [...] } hoặc { from: '2026-10-01', to: '2026-10-27', group_by: 'thread_day' }. " +
    "Với query_records: page bị bỏ qua — máy chủ tự lấy mọi trang tới trần dòng; có aggregate thì xuất bảng gộp nhóm."),
  format: z.enum(["xlsx", "pdf"]).optional().describe("xlsx = Excel (mặc định, giữ định dạng ngày / số, lọc được); pdf = bảng in đơn giản."),
  title: z.string().max(TITLE_MAX).optional().describe("Tiêu đề in đầu tệp và vào tên tệp, vd 'Hoạt động nhóm tuần 43'."),
});
type ExportInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  file_name: z.string(),
  format: z.enum(["xlsx", "pdf"]),
  rows: z.number(),
  bytes: z.number(),
  truncated: z.boolean(),
  download_url: z.string(),
  download_expires_in_seconds: z.number(),
  notices: z.array(z.string()),
});
type ExportOutput = z.infer<typeof outputSchema>;

// ---- trần lượt xuất mỗi khóa mỗi phút (bộ nhớ tiến trình) ----

const exportsByKey = new Map<string, { windowStart: number; count: number }>();

export function chargeExportQuota(key: string, nowMs = Date.now()): void {
  let usage = exportsByKey.get(key);
  if (!usage || nowMs - usage.windowStart >= 60_000) {
    usage = { windowStart: nowMs, count: 0 };
    exportsByKey.set(key, usage);
  }
  if (usage.count + 1 > EXPORTS_PER_MINUTE) {
    throw new DataAccessError("rate_limited", `Xuất báo cáo quá nhiều trong một phút (tối đa ${EXPORTS_PER_MINUTE} lượt) — đợi một phút rồi thử lại.`);
  }
  usage.count += 1;
}

export function resetExportQuota(): void {
  exportsByKey.clear();
}

/** Một trang dòng thô → dòng đã ép kiểu / giờ VN / che / cắt ô (như vỏ kết quả của query_records nhưng KHÔNG cắt theo tổng ký tự). */
function shapeExportRows(ctx: DataAccessContext, entity: string, fields: string[], rows: RowDataPacket[]): Record<string, unknown>[] {
  const def = findEntity(entity)!;
  return rows.map((row) => {
    const item: Record<string, unknown> = {};
    for (const key of fields) {
      const column = def.columns[key];
      let value = shapeValue(column.type, row[key]);
      if (typeof value === "string") value = clipText(ctx.maskPersonal ? maskPersonalData(value) : value, column.maxChars ?? DEFAULT_CELL_CHARS);
      item[key] = value;
    }
    return item;
  });
}

interface CollectedTable {
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  lines: string[];
}

function parseSourceArgs<T>(tool: ToolDefinition<T, unknown>, ctx: DataAccessContext, args: Record<string, unknown>): T {
  if (!tool.available(ctx)) throw new DataAccessError("forbidden", `Khóa này không dùng được công cụ ${tool.name}.`);
  const parsed = tool.input(ctx).safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.map(String).join(".") || "(gốc)"}: ${issue.message}`).join("; ");
    throw new DataAccessError("invalid_value", `args không hợp lệ cho ${tool.name} — ${issues}`);
  }
  return parsed.data;
}

async function collectQueryRecords(ctx: DataAccessContext, request: QueryRequest, maxRows: number): Promise<CollectedTable> {
  const def = findEntity(request.entity);
  if (!def) throw new DataAccessError("unknown_entity", `Không có thực thể ${request.entity}.`, readableEntities(ctx).map((item) => item.name));
  if (!canUse(ctx, def.permission, "read")) throw new DataAccessError("forbidden", `Không đủ quyền đọc ${def.name}.`);
  if (request.aggregate) {
    const result = await runQuery(ctx, { ...request, page: undefined, include_total: false });
    if (!("groups" in result)) throw new Error("runQuery trả sai kiểu cho aggregate");
    const keys = [...(request.aggregate.group_by ?? []).map((group) => group.field), "count", ...(request.aggregate.fn === "sum" ? ["sum"] : [])];
    const rows = ctx.maskPersonal ? maskPersonalDataDeep(result.groups) : result.groups;
    return {
      columns: keys.map((key) => ({ key, label: key === "count" ? "Số dòng" : key === "sum" ? "Tổng" : key })),
      rows, truncated: result.truncated.groups, lines: [`Thực thể: ${def.title} (${def.name}), gộp nhóm`],
    };
  }
  const collected: Record<string, unknown>[] = [];
  let fields: string[] = [];
  let truncated = false;
  for (let page = 1; collected.length < maxRows; page += 1) {
    const compiled = compileQuery(def, ctx, { ...request, include_total: false, page: { size: MAX_PAGE_SIZE, number: page } });
    if (compiled.kind !== "rows") throw new Error("compileQuery trả sai kiểu");
    fields = compiled.fields;
    let rows: RowDataPacket[];
    try {
      [rows] = await ctx.db.query<RowDataPacket[]>(compiled.sql, compiled.params);
    } catch (error) {
      return translateDbError(error);
    }
    const pageRows = rows.slice(0, MAX_PAGE_SIZE);
    const room = maxRows - collected.length;
    collected.push(...shapeExportRows(ctx, def.name, fields, pageRows.slice(0, room)));
    const more = rows.length > MAX_PAGE_SIZE;
    if (pageRows.length > room || (more && collected.length >= maxRows)) truncated = true;
    if (!more) break;
  }
  return { columns: fields.map((key) => ({ key, label: key })), rows: collected, truncated, lines: [`Thực thể: ${def.title} (${def.name})`] };
}

const ACTIVITY_COLUMNS: Record<ActivityGrouping, ExportColumn[]> = {
  thread_day: [
    { key: "day", label: "Ngày" }, { key: "thread_id", label: "Mã cuộc" }, { key: "thread_name", label: "Nhóm / cuộc" }, { key: "messages", label: "Số tin" },
    { key: "files", label: "Số tệp" }, { key: "active_senders", label: "Người hoạt động" }, { key: "last_message_at", label: "Tin cuối" },
  ],
  sender_day: [
    { key: "day", label: "Ngày" }, { key: "sender_uid", label: "Mã người gửi" }, { key: "sender_name", label: "Người gửi" }, { key: "messages", label: "Số tin" },
    { key: "files", label: "Số tệp" }, { key: "threads", label: "Số cuộc" }, { key: "last_message_at", label: "Tin cuối" },
  ],
  thread_sender: [
    { key: "thread_id", label: "Mã cuộc" }, { key: "thread_name", label: "Nhóm / cuộc" }, { key: "sender_uid", label: "Mã người gửi" }, { key: "sender_name", label: "Người gửi" },
    { key: "messages", label: "Số tin" }, { key: "files", label: "Số tệp" }, { key: "last_message_at", label: "Tin cuối" },
  ],
};

async function collectActivity(ctx: DataAccessContext, input: ActivityInput, maxRows: number): Promise<CollectedTable & { period: string }> {
  const result = await collectActivitySummary(ctx, input, maxRows);
  const rows = ctx.maskPersonal ? maskPersonalDataDeep(result.rows) : result.rows;
  const { totals } = result;
  return {
    columns: ACTIVITY_COLUMNS[result.group_by], rows: rows as unknown as Record<string, unknown>[], truncated: result.truncated,
    period: `${result.period.from} → ${result.period.to}`,
    lines: [`Tổng cả kỳ: ${totals.messages} tin, ${totals.files} tệp, ${totals.active_senders} người hoạt động, ${totals.threads} cuộc`],
  };
}

export const exportReportTool: ToolDefinition<ExportInput, ExportOutput> = {
  name: "export_report",
  title: "Xuất báo cáo Excel / PDF",
  description:
    "Xuất kết quả của query_records hoặc activity_summary thành tệp Excel (xlsx, mặc định) hoặc PDF và trả download_url ký sẵn, hạn 10 phút. " +
    "Dùng khi người dùng muốn TỆP để tải / gửi / in, hoặc khi dữ liệu nhiều hơn một trang (query_records chỉ trả 100 dòng một lần; tệp lấy tới " +
    `${EXPORT_MAX_ROWS.xlsx} dòng Excel, ${EXPORT_MAX_ROWS.pdf} dòng PDF). Gửi source + args (đúng tham số của công cụ nguồn) + title — KHÔNG gửi dữ liệu: ` +
    "máy chủ tự chạy lại truy vấn theo quyền của khóa. Tệp đã che SĐT / STK / CCCD nếu cài đặt che đang bật. Đưa nguyên download_url cho người dùng; " +
    "link hết hạn thì gọi lại công cụ này.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  available: (ctx) => ctx.reportFiles !== undefined && (queryRecordsTool.available(ctx) || activitySummaryTool.available(ctx)),
  async handler(ctx, input) {
    chargeExportQuota(`k${ctx.keyId ?? 0}:u${ctx.principal.userId ?? 0}`);
    const format = input.format ?? "xlsx";
    const maxRows = EXPORT_MAX_ROWS[format];
    let collected: CollectedTable;
    let period = "";
    let entity = "messages";
    if (input.source === "query_records") {
      const request = parseSourceArgs(queryRecordsTool, ctx, input.args);
      entity = request.entity;
      collected = await collectQueryRecords(ctx, request, maxRows);
    } else {
      const activity = await collectActivity(ctx, parseSourceArgs(activitySummaryTool, ctx, input.args), maxRows);
      collected = activity;
      period = activity.period;
    }
    const rawTitle = input.title?.trim() || (input.source === "activity_summary" ? "Tổng hợp hoạt động" : "Báo cáo dữ liệu");
    const title = (ctx.maskPersonal ? maskPersonalData(rawTitle) : rawTitle).slice(0, TITLE_MAX);
    const { text: createdAt } = vnTimestamp(ctx.now);
    const notices: string[] = [];
    if (collected.truncated) notices.push(`Đã cắt ở ${maxRows.toLocaleString("vi-VN")} dòng (trần ${format === "pdf" ? "PDF" : "Excel"}) — thu hẹp bộ lọc hoặc chia kỳ để đủ dữ liệu.`);
    if (ctx.maskPersonal) notices.push(MASK_NOTICE);
    const table: ExportTable = {
      title, columns: collected.columns, rows: collected.rows,
      lines: [...(period ? [`Kỳ: ${period}`] : []), ...collected.lines, `Lập lúc ${createdAt} bởi Bot trợ lý qua MCP · ${collected.rows.length} dòng`, ...notices],
    };
    const data = format === "pdf" ? await buildExportPdf(table) : buildExportWorkbook(table);
    if (data.length > REPORT_MAX_FILE_BYTES) {
      throw new DataAccessError("invalid_value", `Tệp ${Math.round(data.length / 1024 / 1024)} MB vượt trần ${REPORT_MAX_FILE_BYTES / 1024 / 1024} MB — chọn ít cột hơn (fields) hoặc thu hẹp bộ lọc.`);
    }
    const fileName = reportFileName(title, period, ctx.principal.fullName, createdAt.slice(0, 10), format);
    const contentType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const link = ctx.reportFiles!.publish({ fileName, contentType, data, rowCount: collected.rows.length });
    if (!link) throw new DataAccessError("invalid_state", "Máy chủ chưa khai địa chỉ công khai (MCP_PUBLIC_URL) nên không tạo được link tải báo cáo.");
    const structured: ExportOutput = {
      file_name: fileName, format, rows: collected.rows.length, bytes: data.length, truncated: collected.truncated,
      download_url: link.url, download_expires_in_seconds: link.expiresInSeconds, notices,
    };
    return {
      structured, rowCount: collected.rows.length,
      summary: `Đã xuất ${fileName}: ${collected.rows.length} dòng, ${Math.max(1, Math.round(data.length / 1024))} KB${collected.truncated ? " (đã cắt)" : ""}. Link tải hạn ${Math.round(link.expiresInSeconds / 60)} phút.`,
      entity,
    };
  },
};
