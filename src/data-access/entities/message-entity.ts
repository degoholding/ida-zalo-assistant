import type { ListSpec } from "../../web/api/list-query.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts, threadVisibilitySql } from "../visibility-guards.js";

// Tin nhắn thô (bảng message — rất lớn). Bắt buộc lọc thread_id hoặc khoảng sent_at ≤ 92 ngày; không bao giờ trả tin đã thu hồi.
// Tìm theo từ khóa nên dùng search_messages (chỉ mục toàn văn); `text contains` ở đây quét LIKE trong khoảng đã chặn (có trần 5 giây).

const MESSAGE_RECORD_SPEC: ListSpec = {
  fields: {
    thread_id: { sql: "m.group_id", type: "number" },
    thread_type: { sql: "g.thread_type", type: "number" },
    sender_uid: { sql: "m.sender_uid", type: "text" },
    sender_name: { sql: "m.sender_name", type: "text" },
    kind: { sql: "m.kind", type: "number" },
    sent_at: { sql: "m.sent_at", type: "date" },
    text: { sql: "m.text", type: "text" },
  },
  sorts: { sent_at: "m.sent_at", id: "m.id" },
  defaultSort: { by: "sent_at", dir: "desc" },
  tieBreaker: "m.id",
};

export const messageEntity: EntityDefinition = {
  name: "messages",
  title: "Tin nhắn",
  permission: "conversation",
  from: "message m JOIN zalo_group g ON g.id = m.group_id",
  spec: () => MESSAGE_RECORD_SPEC,
  filterOps: { text: ["contains", "not_contains"] },
  columns: {
    id: { sql: "m.id", type: "number" },
    thread_id: { sql: "m.group_id", type: "number" },
    thread_name: { sql: "COALESCE(NULLIF(g.label, ''), g.name)", type: "text", untrusted: true },
    thread_type: { sql: "g.thread_type", type: "number" },
    sender_uid: { sql: "m.sender_uid", type: "text" },
    sender_name: { sql: "m.sender_name", type: "text", untrusted: true },
    kind: { sql: "m.kind", type: "number" },
    sent_at: { sql: "m.sent_at", type: "date" },
    text: { sql: "m.text", type: "text", untrusted: true },
    quote_text: { sql: "m.quote_text", type: "text", untrusted: true },
  },
  defaultFields: ["id", "thread_id", "thread_name", "sender_name", "sent_at", "text"],
  baseWhere: (ctx) => andParts({ sql: "m.recalled_at IS NULL", params: [] }, threadVisibilitySql(ctx, "g")),
  requiredFilter: { anyOf: ["thread_id", "sent_at"], maxRangeDays: 92 },
  aggregate: { groupBy: ["thread_id", "sender_uid", "sender_name", "kind", "sent_at"], sum: [] },
  notes: [
    "Bảng lớn: bắt buộc lọc thread_id (eq / in) HOẶC khoảng sent_at chặn hai đầu, tối đa 92 ngày.",
    "Gộp nhóm theo ngày: aggregate.group_by = [{ field: 'sent_at', bucket: 'day' }] (giờ VN).",
    "Tìm theo từ khóa: dùng search_messages; đọc liền mạch một cuộc: get_thread_messages.",
  ],
};
