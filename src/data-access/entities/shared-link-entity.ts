import { ACCOUNT_FILTER_FIELD } from "../../web/api/conversation-accounts.js";
import { SHARED_LINK_LIST_SPEC } from "../../web/api/shared-links-api.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts, threadVisibilitySql } from "../visibility-guards.js";

// Link chia sẻ trong tin (phase 13.2, bảng shared_link): Google Drive / Sheets / Docs / Slides / thư mục / web khác. Cùng luật với
// entity files: phạm vi nhóm + cuộc đọc được + chặn nhóm Mật theo cờ + lọc account_id; tin đã thu hồi ẩn. url / title / host do
// người Zalo gửi → untrusted. Chỉ là link — bot KHÔNG mở link ở đây (đọc nội dung link là việc của read_link, có kiểm riêng).

export const sharedLinkEntity: EntityDefinition = {
  name: "links",
  title: "Link chia sẻ",
  permission: "file",
  from: "shared_link l JOIN message m ON m.id = l.message_id JOIN zalo_group g ON g.id = l.group_id",
  spec: () => ({ ...SHARED_LINK_LIST_SPEC, fields: { ...SHARED_LINK_LIST_SPEC.fields, account_id: ACCOUNT_FILTER_FIELD } }),
  columns: {
    id: { sql: "l.id", type: "number" },
    url: { sql: "l.url", type: "text", untrusted: true },
    title: { sql: "l.title", type: "text", untrusted: true },
    host: { sql: "l.host", type: "text", untrusted: true },
    kind: { sql: "l.kind", type: "number" },
    google_file_id: { sql: "l.google_file_id", type: "text" },
    message_id: { sql: "l.message_id", type: "number" },
    thread_id: { sql: "g.id", type: "number" },
    thread_name: { sql: "COALESCE(NULLIF(g.label, ''), g.name)", type: "text", untrusted: true },
    thread_type: { sql: "g.thread_type", type: "number" },
    sender_uid: { sql: "l.sender_uid", type: "text" },
    sender_name: { sql: "l.sender_name", type: "text", untrusted: true },
    sent_at: { sql: "l.sent_at", type: "date" },
  },
  defaultFields: ["id", "url", "kind", "title", "thread_name", "sender_name", "sent_at"],
  baseWhere: (ctx) => andParts({ sql: "m.recalled_at IS NULL", params: [] }, threadVisibilitySql(ctx, "g")),
  aggregate: { groupBy: ["kind", "host", "thread_id", "sender_uid", "sent_at"], sum: [] },
  notes: [
    "Lọc nhóm: group_id; tài khoản Zalo: account_id; tìm (`search`) trong url, title, sender_name.",
    "title thường trống (chỉ thẻ link Zalo có tiêu đề) — chưa chụp nội dung tệp Google.",
  ],
};
