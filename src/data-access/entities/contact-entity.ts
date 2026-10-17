import { contactListSpec } from "../../web/api/contacts-api.js";
import type { ListSpec } from "../../web/api/list-query.js";
import { contactScopeSql } from "../../web/api/scope.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import type { EntityDefinition } from "../entity-definition.js";

// Danh bạ (liên hệ Zalo). Người bị khoanh phạm vi chỉ thấy người ở ≥ 1 nhóm được gán. SĐT cần quyền đọc Danh mục (catalog.read)
// và bị che nếu bật «Che dữ liệu cá nhân trước khi gửi AI». Không có quyền SĐT thì cũng không lọc / tìm theo SĐT.

/**
 * Số nhóm người này đang ở — CHỈ đếm nhóm người gọi thấy được (trong phạm vi + không Mật khi thiếu quyền Mật); không thì con số
 * lộ cả nhóm ngoài phạm vi / nhóm Mật. Id nhóm là số nguyên từ DB, ghép thẳng vào câu (đã ép về số an toàn).
 */
function groupCountSql(ctx: DataAccessContext): string {
  const conditions = ["gm.zalo_uid = c.zalo_uid", "gm.left_at IS NULL"];
  const ids = ctx.principal.groupIds;
  if (ids) conditions.push(ids.length ? `gm.group_id IN (${ids.filter(Number.isSafeInteger).map(Number).join(",") || "0"})` : "1 = 0");
  if (!ctx.includeConfidential) conditions.push("zg.is_confidential = 0");
  return `(SELECT COUNT(*) FROM group_member gm JOIN zalo_group zg ON zg.id = gm.group_id WHERE ${conditions.join(" AND ")})`;
}

/**
 * Spec theo người gọi. SĐT (lọc / tìm) chỉ khi có quyền Danh mục VÀ không bật che dữ liệu cá nhân — che chỉ làm trên đầu ra, nên
 * cho lọc theo SĐT thì dò từng số được (M2). Lọc nhóm bị giao với phạm vi + bỏ nhóm Mật (M1).
 */
function specFor(ctx: DataAccessContext): ListSpec {
  const phone = canUse(ctx, "catalog", "read") && !ctx.maskPersonal;
  const base = contactListSpec(phone, { allowedGroupIds: ctx.principal.groupIds, hideConfidential: !ctx.includeConfidential });
  // `group_count` ở spec web là bí danh cột SELECT; lõi cho chọn cột tùy ý nên thay bằng biểu thức đầy đủ
  return { ...base, sorts: { ...base.sorts, group_count: groupCountSql(ctx) } };
}

export const contactEntity: EntityDefinition = {
  name: "contacts",
  title: "Danh bạ",
  permission: "contact",
  from: `contact c LEFT JOIN company co ON co.id = c.company_id
    LEFT JOIN catalog_entry ce ON ce.contact_id = c.id LEFT JOIN catalog_entry ow ON ow.id = ce.owner_entry_id`,
  spec: specFor,
  // Hàm lọc tự viết của web chỉ hiểu các phép này
  filterOps: { group_id: ["eq", "in", "ne", "not_in"], tag: ["eq", "ne", "contains", "in", "not_in"] },
  columns: {
    id: { sql: "c.id", type: "number" },
    zalo_uid: { sql: "c.zalo_uid", type: "text" },
    display_name: { sql: "c.display_name", type: "text", untrusted: true },
    zalo_name: { sql: "c.zalo_name", type: "text", untrusted: true },
    kind: { sql: "c.kind", type: "number" },
    role: { sql: "c.role", type: "number" },
    company_id: { sql: "c.company_id", type: "number" },
    company_name: { sql: "co.name", type: "text" },
    note: { sql: "c.note", type: "text", untrusted: true },
    phone: { sql: "c.phone", type: "text", requires: ["catalog", "read"] },
    catalog_code: { sql: "ce.code", type: "text" },
    catalog_kind: { sql: "ce.kind", type: "number" },
    region: { sql: "ce.region", type: "text" },
    sales_zone: { sql: "ce.sales_zone", type: "text" },
    owner_name: { sql: "ow.name", type: "text" },
    first_seen_at: { sql: "c.first_seen_at", type: "date" },
    last_dm_at: { sql: "c.last_dm_at", type: "date" },
    dm_count: { sql: "c.dm_count", type: "number" },
    group_count: { sql: "", sqlFor: groupCountSql, type: "number" },
  },
  defaultFields: ["id", "display_name", "kind", "company_name", "region"],
  baseWhere: (ctx) => contactScopeSql(ctx.principal) ?? undefined,
  aggregate: { groupBy: ["kind", "role", "company_id", "region", "sales_zone"], sum: [] },
  notes: ["Cột phone chỉ có với quyền xem Danh mục; bật «Che dữ liệu cá nhân» thì SĐT bị che và KHÔNG lọc / tìm theo SĐT được. group_count / lọc group_id chỉ tính nhóm bạn thấy được."],
};
