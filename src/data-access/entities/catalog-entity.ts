import { CATALOG_TENANT_ID } from "../../catalog/catalog-repository.js";
import { CATALOG_LIST_SPEC } from "../../web/api/catalog-api.js";
import type { ListSpec } from "../../web/api/list-query.js";
import type { EntityDefinition } from "../entity-definition.js";

// Bản spec khi bật «Che dữ liệu cá nhân»: bỏ SĐT khỏi cột tìm — che chỉ làm trên đầu ra, tìm theo SĐT thì dò từng số được (M2).
const CATALOG_SPEC_MASKED: ListSpec = {
  ...CATALOG_LIST_SPEC, search: { param: "q", columns: CATALOG_LIST_SPEC.search!.columns.filter((column) => column !== "e.phone") },
};

// Danh mục nhân viên / đại lý (có SĐT nên chỉ Quản trị + Quản lý — quyền catalog.read). Không trả cột `extra` (JSON tự do).
export const catalogEntity: EntityDefinition = {
  name: "catalog",
  title: "Danh mục nhân viên / đại lý",
  permission: "catalog",
  from: "catalog_entry e LEFT JOIN catalog_entry o ON o.id = e.owner_entry_id LEFT JOIN contact c ON c.id = e.contact_id",
  spec: (ctx) => (ctx.maskPersonal ? CATALOG_SPEC_MASKED : CATALOG_LIST_SPEC),
  columns: {
    id: { sql: "e.id", type: "number" },
    kind: { sql: "e.kind", type: "number" },
    code: { sql: "e.code", type: "text" },
    name: { sql: "e.name", type: "text" },
    phone: { sql: "e.phone", type: "text" },
    region: { sql: "e.region", type: "text" },
    sales_zone: { sql: "e.sales_zone", type: "text" },
    owner_code: { sql: "e.owner_code", type: "text" },
    owner_name: { sql: "o.name", type: "text" },
    is_active: { sql: "e.is_active", type: "boolean" },
    expects_report: { sql: "e.expects_report", type: "boolean" },
    contact_id: { sql: "e.contact_id", type: "number" },
    match_status: { sql: "e.match_status", type: "number" },
    updated_at: { sql: "e.updated_at", type: "date" },
  },
  defaultFields: ["id", "kind", "code", "name", "region", "sales_zone", "owner_name", "is_active"],
  baseWhere: () => ({ sql: "e.tenant_id = ?", params: [CATALOG_TENANT_ID] }),
  aggregate: { groupBy: ["kind", "region", "sales_zone", "match_status", "is_active"], sum: [] },
  notes: ["SĐT trong danh mục bị che nếu bật «Che dữ liệu cá nhân trước khi gửi AI»; khi đó cũng không tìm theo SĐT được."],
};
