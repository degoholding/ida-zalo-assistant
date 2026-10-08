import { groupScopeSql } from "../../auth/principal.js";
import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../../constants.js";
import { listCompanies } from "../../sync/company-repository.js";
import { sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";

// Danh sách ngắn cho ô chọn / bộ lọc. Không phân trang — các bảng này nhỏ (vài chục dòng).

/** Mục «chưa gán» cho ô chọn công ty của biểu mẫu — ô chọn không biểu diễn được null nên dùng id 0. */
export const NO_COMPANY_OPTION = { id: 0, code: "", name: "— Chưa gán —", is_active: true };

export const lookupRoutes: ApiRoute[] = [
  ["GET", /^\/api\/lookups\/contact-tags$/, async ({ response, service }) => {
    const [rows] = await service.db.query<RowDataPacket[]>("SELECT DISTINCT tag FROM contact_tag ORDER BY tag LIMIT 500");
    sendOk(response, rows.map((row) => String(row.tag)));
  }],
  // ?with_none=1 → thêm mục «Chưa gán» ở đầu (cho ô chọn của biểu mẫu); ?active=1 → chỉ công ty đang dùng
  ["GET", /^\/api\/lookups\/companies$/, async ({ response, url, service }) => {
    const companies = (await listCompanies(service.db, url.searchParams.get("active") === "1"))
      .map((company) => ({ id: company.id, code: company.code, name: company.name, is_active: Boolean(company.is_active) }));
    sendOk(response, url.searchParams.get("with_none") === "1" ? [NO_COMPANY_OPTION, ...companies] : companies);
  }],
  ["GET", /^\/api\/lookups\/groups$/, async ({ response, service, principal }) => {
    const scope = groupScopeSql(principal, "id");
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT id, COALESCE(NULLIF(label, ''), name) AS name FROM zalo_group WHERE thread_type = ${ConversationType.Group}
       ${scope ? `AND ${scope.sql}` : ""} ORDER BY name`, scope?.params ?? []);
    sendOk(response, rows);
  }],
  // Mọi cuộc (nhóm + riêng) — bộ lọc màn Tệp
  ["GET", /^\/api\/lookups\/threads$/, async ({ response, service, principal }) => {
    const scope = groupScopeSql(principal, "id");
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT id, thread_type, IF(thread_type = ${ConversationType.Direct}, CONCAT('Nhắn riêng · ', name), COALESCE(NULLIF(label, ''), name)) AS name
       FROM zalo_group ${scope ? `WHERE ${scope.sql}` : ""} ORDER BY thread_type DESC, name`, scope?.params ?? []);
    sendOk(response, rows);
  }],
];
