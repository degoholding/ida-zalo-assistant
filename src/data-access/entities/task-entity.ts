import { TASK_LIST_SPEC } from "../../web/api/tasks-api.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts, sourceThreadVisibilitySql } from "../visibility-guards.js";

// Việc (checklist giao việc). Phạm vi theo NHÓM NGUỒN: người bị khoanh chỉ thấy việc phát sinh từ nhóm được gán; không Mật thì
// bỏ việc từ nhóm Mật. Khác web: không tự ẩn việc Xong / Hủy — lọc `status` khi cần.
export const taskEntity: EntityDefinition = {
  name: "tasks",
  title: "Việc",
  permission: "task",
  from: "task t LEFT JOIN zalo_group g ON g.id = t.source_thread_id",
  spec: () => TASK_LIST_SPEC,
  columns: {
    id: { sql: "t.id", type: "number" },
    code: { sql: "t.code", type: "text" },
    status: { sql: "t.status", type: "number" },
    priority: { sql: "t.priority", type: "number" },
    title: { sql: "t.title", type: "text", untrusted: true },
    assignee_contact_id: { sql: "t.assignee_contact_id", type: "number" },
    assignee_name: { sql: "t.assignee_name", type: "text", untrusted: true },
    assigner_name: { sql: "t.assigner_name", type: "text", untrusted: true },
    source: { sql: "t.source", type: "number" },
    source_thread_id: { sql: "t.source_thread_id", type: "number" },
    source_thread_name: { sql: "COALESCE(NULLIF(g.label, ''), g.name)", type: "text", untrusted: true },
    due_at: { sql: "t.due_at", type: "date" },
    due_has_time: { sql: "t.due_has_time", type: "boolean" },
    resolution: { sql: "t.resolution", type: "text", untrusted: true },
    created_at: { sql: "t.created_at", type: "date" },
    updated_at: { sql: "t.updated_at", type: "date" },
    closed_at: { sql: "t.closed_at", type: "date" },
  },
  defaultFields: ["id", "code", "status", "priority", "title", "assignee_name", "due_at", "source_thread_name"],
  baseWhere: (ctx) => andParts(
    { sql: "t.tenant_id = ?", params: [ctx.principal.tenantId] },
    sourceThreadVisibilitySql(ctx, "t.source_thread_id", "g"),
  ),
  aggregate: { groupBy: ["status", "priority", "assignee_contact_id", "assignee_name", "source", "source_thread_id"], sum: [] },
  notes: ["Lọc quá hạn: filters [{ field: 'overdue', op: 'eq', value: true }]."],
};
