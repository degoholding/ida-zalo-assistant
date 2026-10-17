import { FILE_LIST_SPEC } from "../../web/api/files-api.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts, threadVisibilitySql } from "../visibility-guards.js";

// Tệp / ảnh / video đã thấy trong các cuộc trò chuyện. KHÔNG bao giờ trả khóa lưu trữ / đường dẫn nguồn — đọc chữ trong tệp
// bằng get_file_text. Tìm (`search`) cả trong chữ đã bóc.
const SIZE_SQL = "COALESCE(a.stored_bytes, a.declared_size, 0)";

export const fileEntity: EntityDefinition = {
  name: "files",
  title: "Tệp đính kèm",
  permission: "file",
  from: `attachment a JOIN message m ON m.id = a.message_id JOIN zalo_group g ON g.id = a.group_id
    LEFT JOIN attachment_text t ON t.attachment_id = a.id`,
  spec: () => FILE_LIST_SPEC,
  columns: {
    id: { sql: "a.id", type: "number" },
    file_name: { sql: "a.file_name", type: "text", untrusted: true },
    file_ext: { sql: "a.file_ext", type: "text" },
    status: { sql: "a.status", type: "number" },
    size: { sql: SIZE_SQL, type: "number" },
    message_id: { sql: "m.id", type: "number" },
    thread_id: { sql: "g.id", type: "number" },
    thread_name: { sql: "COALESCE(NULLIF(g.label, ''), g.name)", type: "text", untrusted: true },
    thread_type: { sql: "g.thread_type", type: "number" },
    sender_name: { sql: "m.sender_name", type: "text", untrusted: true },
    sender_uid: { sql: "m.sender_uid", type: "text" },
    sent_at: { sql: "m.sent_at", type: "date" },
    has_text: { sql: "t.text IS NOT NULL", type: "boolean" },
    text_chars: { sql: "t.char_count", type: "number" },
    text_method: { sql: "t.method", type: "text" },
  },
  defaultFields: ["id", "file_name", "file_ext", "size", "thread_name", "sender_name", "sent_at", "has_text"],
  // Tệp của tin đã thu hồi cũng ẩn (cùng luật với entity messages)
  baseWhere: (ctx) => andParts({ sql: "m.recalled_at IS NULL", params: [] }, threadVisibilitySql(ctx, "g")),
  aggregate: { groupBy: ["file_ext", "status", "thread_id", "sender_uid"], sum: ["size"] },
  notes: ["Chữ trong tệp: get_file_text(attachment_id = id) — chỉ đọc chữ ĐÃ được bóc (has_text = true)."],
};
