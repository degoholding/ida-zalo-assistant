import type { RowDataPacket } from "mysql2";
import type { Principal } from "../../auth/principal.js";
import type { BriefLogFile } from "../../briefs/brief-types.js";
import { UserRole } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { ApiError, parseId, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { buildContentDisposition } from "./file-download.js";
import type { ListSpec, Operator, SqlPart } from "./list-query.js";
import { runList } from "./list-runner.js";
import { parseVnDayStart } from "./message-search-api.js";

// Màn web «Bản tin» (phase 8, phase 5 — N6): CHỈ ĐỌC. Bản tin có thể chứa dữ liệu nhóm Mật của người nhận đó nên
// KHÔNG theo phạm vi nhóm như màn khác — quản trị thấy hết, người dùng khác chỉ thấy bản tin của người nhận gắn với
// TÀI KHOẢN MÌNH (`recipient.user_id`). Tải tệp chỉ qua id `brief_log` + chỉ số trong cột `files`, không bao giờ nhận
// khóa lưu trữ thật từ người dùng (xem `plans/261009-1555-phase-08-briefs-reports/phase-05-web-brief-screen.md`).

const DAY_MS = 86_400_000;

/** «Trong khoảng» (hoặc đúng ngày / ≤ / ≥…) trên `created_at` theo giờ Việt Nam — cùng khuôn `buildDueAtCondition` của tasks-api.ts. */
export function buildBriefCreatedAtCondition(operator: Operator, values: string[]): SqlPart | null {
  const days = values.map(parseVnDayStart);
  const [first, second] = days;
  if (!first) return null;
  const next = (day: Date) => new Date(day.getTime() + DAY_MS);
  switch (operator) {
    case "eq": return { sql: "(b.created_at >= ? AND b.created_at < ?)", params: [first, next(first)] };
    case "ne": return { sql: "(b.created_at < ? OR b.created_at >= ?)", params: [first, next(first)] };
    case "gte": return { sql: "b.created_at >= ?", params: [first] };
    case "gt": return { sql: "b.created_at >= ?", params: [next(first)] };
    case "lte": return { sql: "b.created_at < ?", params: [next(first)] };
    case "lt": return { sql: "b.created_at < ?", params: [first] };
    case "between": return second ? { sql: "(b.created_at >= ? AND b.created_at < ?)", params: [first, next(second)] } : null;
    default: return null;
  }
}

export const BRIEF_LIST_SPEC: ListSpec = {
  fields: {
    recipient_id: { sql: "b.recipient_id", type: "number" },
    kind: { sql: "b.kind", type: "number" },
    trigger_source: { sql: "b.trigger_source", type: "number" },
    status: { sql: "b.status", type: "number" },
    created_at: { type: "date", build: buildBriefCreatedAtCondition },
  },
  sorts: { created_at: "b.created_at", sent_at: "b.sent_at" },
  defaultSort: { by: "created_at", dir: "desc" },
  tieBreaker: "b.id",
  search: { param: "q", columns: ["r.name", "b.period_label"] },
};

const BRIEF_FROM = "FROM brief_log b JOIN recipient r ON r.id = b.recipient_id";
const BRIEF_COLUMNS = `b.id, b.recipient_id, r.name AS recipient_name, b.kind, b.trigger_source, b.period_key, b.period_label,
  b.status, b.ai_note, b.error, b.created_at, b.sent_at, COALESCE(JSON_LENGTH(b.files), 0) AS file_count`;

/** Đuôi → kiểu nội dung tải về — chỉ hai loại báo cáo tuần / tháng tạo ra (`reportFileName` ở `src/reports/report-table.ts`). */
const BRIEF_FILE_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function briefFileContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return BRIEF_FILE_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Cột `files` của `brief_log` — mysql2 thường tự bóc JSON, nhưng vẫn phòng hờ trường hợp về dạng chuỗi (khớp cách đọc `job.payload` ở `job-queue.ts`). */
export function parseBriefFiles(raw: unknown): BriefLogFile[] {
  if (!raw) return [];
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(value) ? (value as BriefLogFile[]) : [];
}

/** Chữ chung thay lỗi thật — lỗi soạn / gửi có thể lộ chi tiết nội bộ (đường dẫn, thông báo lỗi CSDL…), chỉ quản trị
 * mới cần đọc nguyên văn để chẩn đoán (review phase 8, Low). */
const GENERIC_ERROR = "Có lỗi khi soạn / gửi — báo quản trị kiểm tra nhật ký hệ thống.";

export function decorate(rows: RowDataPacket[], isAdmin: boolean): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    recipient_id: Number(row.recipient_id), kind: Number(row.kind), trigger_source: Number(row.trigger_source),
    status: Number(row.status), file_count: Number(row.file_count),
    // ai_note rỗng = có điểm tin AI (khớp ghi chú ở migration 025_briefs.sql)
    has_ai: row.ai_note === "",
    error: row.error && !isAdmin ? GENERIC_ERROR : row.error,
  }));
}

/** Phạm vi dòng: quản trị thấy hết (trong tenant); vai trò khác chỉ thấy bản tin của người nhận gắn với TÀI KHOẢN MÌNH. */
function recipientScopeWhere(principal: Principal): SqlPart {
  let where: SqlPart = { sql: "r.tenant_id = ?", params: [principal.tenantId] };
  if (principal.role !== UserRole.Admin) where = { sql: `(${where.sql}) AND r.user_id = ?`, params: [...where.params, principal.userId] };
  return where;
}

async function getBriefDetail(db: Db, id: number, principal: Principal): Promise<Record<string, unknown>> {
  const where = recipientScopeWhere(principal);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${BRIEF_COLUMNS}, b.body, b.files ${BRIEF_FROM} WHERE b.id = ? AND (${where.sql})`, [id, ...where.params]);
  const row = rows[0];
  // Ngoài phạm vi cũng 404 — không để lộ «có bản tin này nhưng không được xem»
  if (!row) throw new ApiError(404, "not_found", "Không có bản tin này");
  const files = parseBriefFiles(row.files).map((file, index) => ({
    index, file_name: file.fileName, bytes: file.bytes, download_url: `/api/briefs/${id}/files/${index}`,
  }));
  return { ...decorate([row], principal.role === UserRole.Admin)[0], body: String(row.body ?? ""), files };
}

/** Ô lọc «Người nhận» ở bộ lọc nâng cao — chỉ trả người nhận trong phạm vi người đang xem (admin: cả tenant; người khác: chỉ chính mình). */
async function listRecipientOptions(db: Db, principal: Principal, search: string): Promise<{ id: number; name: string }[]> {
  const where = recipientScopeWhere(principal);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.name FROM recipient r WHERE (${where.sql}) AND r.name LIKE ? ORDER BY r.name LIMIT 20`,
    [...where.params, `%${search.trim()}%`]);
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
}

function parseFileIndex(raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(404, "not_found", "Không có tệp này");
  return value;
}

export const briefRoutes: ApiRoute[] = [
  ["GET", /^\/api\/briefs$/, async ({ response, url, service, principal }) => sendOk(response, await runList(service.db, url.searchParams, BRIEF_LIST_SPEC, {
    select: BRIEF_COLUMNS, from: BRIEF_FROM, baseWhere: recipientScopeWhere(principal),
    decorate: (rows) => decorate(rows, principal.role === UserRole.Admin),
  }))],

  ["GET", /^\/api\/briefs\/recipients$/, async ({ response, url, service, principal }) =>
    sendOk(response, await listRecipientOptions(service.db, principal, url.searchParams.get("q") ?? ""))],

  ["GET", /^\/api\/briefs\/(\d+)$/, async ({ response, match, service, principal }) =>
    sendOk(response, await getBriefDetail(service.db, parseId(match[1]), principal))],

  // ?inline=1 không áp dụng — PDF / Excel luôn tải về, không hiện thẳng trong trình duyệt
  ["GET", /^\/api\/briefs\/(\d+)\/files\/(\d+)$/, async ({ principal, response, match, service }) => {
    const id = parseId(match[1]);
    const index = parseFileIndex(match[2]);
    const where = recipientScopeWhere(principal);
    const [rows] = await service.db.query<RowDataPacket[]>(`SELECT b.files ${BRIEF_FROM} WHERE b.id = ? AND (${where.sql})`, [id, ...where.params]);
    const row = rows[0];
    if (!row) throw new ApiError(404, "not_found", "Không có bản tin này");
    const file = parseBriefFiles(row.files)[index];
    if (!file) throw new ApiError(404, "not_found", "Không có tệp này");
    const stream = await service.storage.read(file.storageKey);
    response.writeHead(200, {
      "Content-Type": briefFileContentType(file.fileName),
      "Cache-Control": "no-store",
      "Content-Disposition": buildContentDisposition(file.fileName, false),
    });
    stream.pipe(response);
  }],
];
