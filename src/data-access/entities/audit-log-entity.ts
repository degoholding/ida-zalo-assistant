import type { ListSpec } from "../../web/api/list-query.js";
import { auditScopeSql } from "../../web/api/audit-scope.js";
import type { EntityDefinition } from "../entity-definition.js";

// «Lịch sử thao tác» (audit_log). Quyền `audit.read` = quản trị hoặc cờ can_view_audit; người không phải quản trị chỉ thấy dòng
// của bản ghi họ được xem (xem audit-scope.ts); không Mật thì ẩn dòng của bản ghi gắn nhóm Mật.
const AUDIT_LOG_SPEC: ListSpec = {
  fields: {
    entity: { sql: "a.entity", type: "text" },
    entity_id: { sql: "a.entity_id", type: "number" },
    action: { sql: "a.action", type: "text" },
    actor: { sql: "a.actor", type: "text" },
    created_at: { sql: "a.created_at", type: "date" },
  },
  sorts: { created_at: "a.created_at", id: "a.id" },
  defaultSort: { by: "created_at", dir: "desc" },
  tieBreaker: "a.id",
  search: { param: "q", columns: ["a.message", "a.changed_fields", "a.actor"] },
};

export const auditLogEntity: EntityDefinition = {
  name: "audit_log",
  title: "Lịch sử thao tác",
  permission: "audit",
  from: "audit_log a",
  spec: () => AUDIT_LOG_SPEC,
  columns: {
    id: { sql: "a.id", type: "number" },
    entity: { sql: "a.entity", type: "text" },
    entity_id: { sql: "a.entity_id", type: "number" },
    action: { sql: "a.action", type: "text" },
    message: { sql: "a.message", type: "text", untrusted: true },
    changed_fields: { sql: "a.changed_fields", type: "text", untrusted: true },
    actor: { sql: "a.actor", type: "text" },
    created_at: { sql: "a.created_at", type: "date" },
  },
  defaultFields: ["id", "entity", "entity_id", "action", "message", "actor", "created_at"],
  baseWhere: (ctx) => auditScopeSql(ctx.principal, ctx.includeConfidential) ?? undefined,
  aggregate: { groupBy: ["entity", "action", "actor"], sum: [] },
  notes: ["Người không phải quản trị chỉ thấy dòng của bản ghi trong phạm vi nhóm được gán."],
};
