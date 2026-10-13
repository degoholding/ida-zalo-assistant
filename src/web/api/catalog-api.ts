import type { RowDataPacket } from "mysql2";
import { CATALOG_TENANT_ID } from "../../catalog/catalog-repository.js";
import { buildCatalogTemplate } from "../../catalog/catalog-template-workbook.js";
import { importCatalog } from "../../catalog/catalog-import-service.js";
import { confirmMatch, rematchAll, unlinkMatch } from "../../catalog/catalog-match-actions.js";
import { MAX_CATALOG_BYTES } from "../../catalog/catalog-import-parser.js";
import type { Db } from "../../db/pool.js";
import { ApiError, parseId, readJson, readRawBody, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { contactAvatarUrl } from "./contacts-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Danh mục NV / ĐL (phase 10, phase 6): danh sách + chi tiết (đọc: Quản trị, Quản lý), tải mẫu, nạp Excel, xác nhận /
// bỏ gắn liên hệ, khớp lại (ghi: chỉ quản trị — không khai luật ở route-permissions.ts).

export const CATALOG_LIST_SPEC: ListSpec = {
  fields: {
    kind: { sql: "e.kind", type: "number" },
    region: { sql: "e.region", type: "text" },
    sales_zone: { sql: "e.sales_zone", type: "text" },
    match_status: { sql: "e.match_status", type: "number" },
    is_active: { sql: "e.is_active", type: "number" },
    owner_entry_id: { sql: "e.owner_entry_id", type: "number" },
  },
  sorts: {
    code: "e.code", name: "e.name", kind: "e.kind", region: "e.region", sales_zone: "e.sales_zone", match_status: "e.match_status",
    owner_name: "o.name", updated_at: "e.updated_at",
  },
  defaultSort: { by: "code", dir: "asc" },
  tieBreaker: "e.id",
  search: { param: "q", columns: ["e.code", "e.name", "e.phone"] },
};

const CATALOG_FROM = `FROM catalog_entry e LEFT JOIN catalog_entry o ON o.id = e.owner_entry_id
  LEFT JOIN contact c ON c.id = e.contact_id`;
const CATALOG_COLUMNS = `e.id, e.kind, e.code, e.name, e.phone, e.region, e.sales_zone, e.owner_code, e.owner_entry_id, o.name AS owner_name,
  e.extra, e.is_active, e.expects_report, e.contact_id, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS contact_name,
  c.zalo_uid AS contact_zalo_uid, c.avatar_key AS contact_avatar_key, e.match_status, e.imported_at, e.updated_at`;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
  } catch {
    return fallback;
  }
}

function decorateRow(row: RowDataPacket): Record<string, unknown> {
  const { contact_avatar_key: avatarKey, contact_zalo_uid: uid, ...rest } = row;
  return {
    ...rest,
    extra: parseJsonColumn<Record<string, string>>(row.extra, {}),
    is_active: Boolean(row.is_active),
    expects_report: Boolean(row.expects_report),
    contact_avatar_url: contactAvatarUrl(uid, avatarKey),
  };
}

export function listCatalog(db: Db, params: URLSearchParams) {
  return runList(db, params, CATALOG_LIST_SPEC, {
    select: CATALOG_COLUMNS, from: CATALOG_FROM, baseWhere: { sql: "e.tenant_id = ?", params: [CATALOG_TENANT_ID] },
    decorate: (rows) => rows.map(decorateRow),
  });
}

/** Chi tiết + ứng viên khớp (tên / SĐT / loại hiện tại của liên hệ, không dùng bản chép lúc khớp). */
export async function getCatalogDetail(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${CATALOG_COLUMNS}, e.match_candidates ${CATALOG_FROM} WHERE e.id = ? AND e.tenant_id = ?`, [id, CATALOG_TENANT_ID]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có mục danh mục này");
  const { match_candidates: rawCandidates, ...rest } = rows[0];
  const stored = parseJsonColumn<{ contactId: number; score: number }[]>(rawCandidates, []);
  const ids = stored.map((item) => Number(item.contactId)).filter((value) => Number.isSafeInteger(value));
  const candidates: Record<string, unknown>[] = [];
  if (ids.length) {
    const [contacts] = await db.query<RowDataPacket[]>(
      `SELECT c.id, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name, c.kind, c.phone, c.zalo_uid, c.avatar_key,
              (SELECT e2.name FROM catalog_entry e2 WHERE e2.contact_id = c.id AND e2.id <> ?) AS linked_entry_name
       FROM contact c WHERE c.id IN (?)`, [id, ids]);
    const byId = new Map(contacts.map((contact) => [Number(contact.id), contact]));
    for (const item of stored) {
      const contact = byId.get(Number(item.contactId));
      if (!contact) continue;
      candidates.push({
        contact_id: Number(contact.id), name: contact.name, kind: contact.kind, phone: contact.phone ?? "", score: item.score,
        avatar_url: contactAvatarUrl(contact.zalo_uid, contact.avatar_key), linked_entry_name: contact.linked_entry_name ?? null,
      });
    }
  }
  return { ...decorateRow(rest as RowDataPacket), candidates };
}

export const catalogRoutes: ApiRoute[] = [
  ["GET", /^\/api\/catalog$/, async ({ response, url, service }) => sendOk(response, await listCatalog(service.db, url.searchParams))],
  ["GET", /^\/api\/catalog\/template\.xlsx$/, async ({ response }) => {
    response.writeHead(200, {
      "Content-Type": XLSX_TYPE, "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=\"mau-danh-muc-nv-dl.xlsx\"",
    });
    response.end(buildCatalogTemplate());
  }],
  ["POST", /^\/api\/catalog\/import$/, async ({ request, response, service }) => {
    const summary = await importCatalog(service.db, await readRawBody(request, MAX_CATALOG_BYTES));
    sendOk(response, summary, "Đã nạp danh mục");
  }],
  ["POST", /^\/api\/catalog\/rematch$/, async ({ response, service }) => sendOk(response, await rematchAll(service.db), "Đã khớp lại")],
  ["GET", /^\/api\/catalog\/(\d+)$/, async ({ response, match, service }) => sendOk(response, await getCatalogDetail(service.db, parseId(match[1])))],
  ["POST", /^\/api\/catalog\/(\d+)\/actions$/, async ({ request, response, match, service }) => {
    const id = parseId(match[1]);
    const body = await readJson(request);
    if (body.action === "confirm") {
      const contactId = Number(body.contact_id);
      if (!Number.isSafeInteger(contactId) || contactId <= 0) throw new ApiError(422, "validation_error", "Thiếu liên hệ cần gắn");
      await confirmMatch(service.db, id, contactId);
    } else if (body.action === "unlink") {
      await unlinkMatch(service.db, id);
    } else {
      throw new ApiError(422, "validation_error", "Hành động không hợp lệ (confirm | unlink)");
    }
    sendOk(response, await getCatalogDetail(service.db, id), "Đã lưu");
  }],
];
