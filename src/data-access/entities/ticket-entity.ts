import { TICKET_LIST_SPEC } from "../../web/api/tickets-api.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts, sourceThreadVisibilitySql } from "../visibility-guards.js";

// Ticket báo qua bot. Phạm vi theo nhóm nguồn (chốt 17/10/2026: chặt hơn màn web hiện tại — web sẽ theo ở phase 4): ticket từ
// cuộc nhắn riêng / nhóm ngoài phạm vi không thấy; không Mật thì bỏ ticket từ nhóm Mật.
export const ticketEntity: EntityDefinition = {
  name: "tickets",
  title: "Ticket",
  permission: "ticket",
  from: "ticket t LEFT JOIN zalo_group g ON g.id = t.source_thread_id",
  spec: () => TICKET_LIST_SPEC,
  columns: {
    id: { sql: "t.id", type: "number" },
    code: { sql: "t.code", type: "text" },
    status: { sql: "t.status", type: "number" },
    title: { sql: "t.title", type: "text", untrusted: true },
    body: { sql: "t.body", type: "text", untrusted: true },
    requester_name: { sql: "t.requester_name", type: "text", untrusted: true },
    handler_name: { sql: "t.handler_name", type: "text", untrusted: true },
    resolution: { sql: "t.resolution", type: "text", untrusted: true },
    source_thread_id: { sql: "t.source_thread_id", type: "number" },
    source_thread_name: { sql: "COALESCE(NULLIF(g.label, ''), g.name)", type: "text", untrusted: true },
    created_at: { sql: "t.created_at", type: "date" },
    updated_at: { sql: "t.updated_at", type: "date" },
    accepted_at: { sql: "t.accepted_at", type: "date" },
    closed_at: { sql: "t.closed_at", type: "date" },
  },
  defaultFields: ["id", "code", "status", "title", "requester_name", "handler_name", "created_at"],
  baseWhere: (ctx) => andParts(
    { sql: "t.tenant_id = ?", params: [ctx.principal.tenantId] },
    sourceThreadVisibilitySql(ctx, "t.source_thread_id", "g"),
  ),
  aggregate: { groupBy: ["status", "requester_name", "handler_name", "source_thread_id"], sum: [] },
};
