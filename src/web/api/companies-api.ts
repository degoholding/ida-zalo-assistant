import { canSeeGroup, PASSWORD_ADMIN, type Principal } from "../../auth/principal.js";
import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { CompanyInputError, createCompany, updateCompany } from "../../sync/company-repository.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { diffFields, recordAudit } from "./audit-log.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Công ty / pháp nhân: danh sách, chi tiết (nhóm + người đã gán), thêm mới, sửa tên / trạng thái.

export const COMPANY_LIST_SPEC: ListSpec = {
  fields: {
    code: { sql: "c.code", type: "text" },
    name: { sql: "c.name", type: "text" },
    is_active: { sql: "c.is_active", type: "boolean" },
    created_at: { sql: "c.created_at", type: "date" },
  },
  sorts: { code: "c.code", name: "c.name", group_count: "group_count", contact_count: "contact_count", created_at: "c.created_at" },
  defaultSort: { by: "name", dir: "asc" },
  tieBreaker: "c.id",
  search: { param: "q", columns: ["c.code", "c.name"] },
};

const COMPANY_FROM = "FROM company c";
const COMPANY_COLUMNS = `
  c.id, c.code, c.name, c.is_active, c.created_at,
  (SELECT COUNT(*) FROM zalo_group g WHERE g.company_id = c.id AND g.thread_type = ${ConversationType.Group}) AS group_count,
  (SELECT COUNT(*) FROM contact ct WHERE ct.company_id = c.id) AS contact_count`;

const FIELD_LABELS = { name: "Tên công ty", is_active: "Đang dùng" };

function decorate(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active), group_count: Number(row.group_count), contact_count: Number(row.contact_count) }));
}

export function listCompanyRows(db: Db, params: URLSearchParams) {
  return runList(db, params, COMPANY_LIST_SPEC, { select: COMPANY_COLUMNS, from: COMPANY_FROM, decorate });
}

async function loadCompany(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COMPANY_COLUMNS} ${COMPANY_FROM} WHERE c.id = ?`, [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có công ty này");
  return decorate(rows)[0];
}

export async function getCompanyDetail(db: Db, id: number, principal: Principal = PASSWORD_ADMIN): Promise<Record<string, unknown>> {
  const company = await loadCompany(db, id);
  const [allGroups] = await db.query<RowDataPacket[]>(
    `SELECT g.id, COALESCE(NULLIF(g.label, ''), g.name) AS name, g.group_kind, g.member_count, g.read_messages,
            IF(g.avatar_key IS NULL, NULL, CONCAT('/avatars/g/', g.id)) AS avatar_url
     FROM zalo_group g WHERE g.company_id = ? AND g.thread_type = ${ConversationType.Group} ORDER BY name`, [id]);
  const groups = allGroups.filter((group) => canSeeGroup(principal, Number(group.id)));
  return { ...company, groups };
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw === "boolean") return raw;
  if (raw === 1 || raw === "1" || raw === "true") return true;
  if (raw === 0 || raw === "0" || raw === "false") return false;
  throw new ApiError(422, "validation_error", "Trạng thái chỉ nhận bật / tắt");
}

/** Lỗi nhập liệu của kho công ty (mã sai, trùng, tên trống) → 422 kèm câu của chính nó. */
async function translateInputError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CompanyInputError) throw new ApiError(422, "validation_error", error.message);
    throw error;
  }
}

export const companyRoutes: ApiRoute[] = [
  ["GET", /^\/api\/companies$/, async ({ response, url, service }) => sendOk(response, await listCompanyRows(service.db, url.searchParams))],
  ["GET", /^\/api\/companies\/(\d+)$/, async ({ response, match, service, principal }) =>
    sendOk(response, await getCompanyDetail(service.db, parseId(match[1]), principal))],
  ["POST", /^\/api\/companies$/, async ({ request, response, service }) => {
    const body = await readJson(request);
    const id = await translateInputError(() => createCompany(service.db, String(body.code ?? ""), String(body.name ?? "")));
    if (!parseBoolean(body.is_active, true)) {
      await translateInputError(() => updateCompany(service.db, id, String(body.name ?? ""), false));
    }
    await recordAudit(service.db, { entity: "company", entityId: id, action: "create" });
    sendOk(response, await getCompanyDetail(service.db, id), "Đã thêm công ty", 201);
  }],
  ["PATCH", /^\/api\/companies\/(\d+)$/, async ({ request, response, match, service }) => {
    const id = parseId(match[1]);
    const before = await loadCompany(service.db, id);
    const body = await readJson(request);
    const name = body.name === undefined ? String(before.name) : String(body.name);
    const isActive = parseBoolean(body.is_active, Boolean(before.is_active));
    await translateInputError(() => updateCompany(service.db, id, name, isActive));
    const changed = diffFields(before, { name: name.trim(), is_active: isActive }, FIELD_LABELS);
    await recordAudit(service.db, { entity: "company", entityId: id, action: "update", changedFields: changed });
    sendOk(response, await getCompanyDetail(service.db, id), "Đã lưu công ty");
  }],
];
