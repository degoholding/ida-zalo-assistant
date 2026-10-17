import { REPLY_TEMPLATE_LIST_SPEC } from "../../web/api/reply-templates-api.js";
import type { EntityDefinition } from "../entity-definition.js";

// Mẫu tin trả lời. Ai có quyền reply_template đọc đều thấy mọi mẫu của tenant (kể cả «Ngừng dùng» — lọc `status` khi cần).
export const replyTemplateEntity: EntityDefinition = {
  name: "reply_templates",
  title: "Mẫu tin trả lời",
  permission: "reply_template",
  from: "reply_template r",
  spec: () => REPLY_TEMPLATE_LIST_SPEC,
  columns: {
    id: { sql: "r.id", type: "number" },
    name: { sql: "r.name", type: "text" },
    situation: { sql: "r.situation", type: "text" },
    keywords: { sql: "r.keywords", type: "text" },
    body: { sql: "r.body", type: "text" },
    tone: { sql: "r.tone", type: "number" },
    status: { sql: "r.status", type: "number" },
    author_user_id: { sql: "r.author_user_id", type: "number" },
    author_name: { sql: "r.author_name", type: "text" },
    reviewer_name: { sql: "r.reviewer_name", type: "text" },
    review_note: { sql: "r.review_note", type: "text" },
    created_at: { sql: "r.created_at", type: "date" },
    updated_at: { sql: "r.updated_at", type: "date" },
  },
  defaultFields: ["id", "name", "situation", "tone", "status", "author_name", "updated_at"],
  baseWhere: (ctx) => ({ sql: "r.tenant_id = ?", params: [ctx.principal.tenantId] }),
  aggregate: { groupBy: ["status", "tone", "author_user_id", "author_name"], sum: [] },
};
