import { ACCOUNT_FILTER_FIELD } from "../../web/api/conversation-accounts.js";
import { CONVERSATION_LIST_SPEC } from "../../web/api/conversations-api.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts, directThreadSql, groupVisibilitySql } from "../visibility-guards.js";

// Cuộc nhắn RIÊNG với bot (hộp thư của bot). Người bị khoanh phạm vi nhóm không thấy cuộc nào — chỉ quản trị / người «mọi nhóm».
export const conversationEntity: EntityDefinition = {
  name: "conversations",
  title: "Cuộc nhắn riêng với bot",
  permission: "conversation",
  from: "zalo_group g",
  // Lọc theo tài khoản Zalo (27/10/2026): cùng hàm SQL với màn Hội thoại web (conversation-accounts.ts)
  spec: () => ({ ...CONVERSATION_LIST_SPEC, fields: { ...CONVERSATION_LIST_SPEC.fields, account_id: ACCOUNT_FILTER_FIELD } }),
  columns: {
    id: { sql: "g.id", type: "number" },
    name: { sql: "g.name", type: "text", untrusted: true },
    label: { sql: "g.label", type: "text", untrusted: true },
    zalo_uid: { sql: "g.zalo_group_id", type: "text" },
    company_id: { sql: "g.company_id", type: "number" },
    message_count: { sql: "g.message_count", type: "number" },
    last_message_at: { sql: "g.last_message_at", type: "date" },
    last_text: {
      sql: "(SELECT m.text FROM message m WHERE m.group_id = g.id AND m.recalled_at IS NULL ORDER BY m.sent_at DESC, m.id DESC LIMIT 1)",
      type: "text", untrusted: true, maxChars: 500,
    },
  },
  defaultFields: ["id", "name", "zalo_uid", "message_count", "last_message_at"],
  baseWhere: (ctx) => andParts(
    // Cuộc riêng (mặc định) hoặc chỉ cuộc riêng của chính người hỏi khi `ownDirectThreadsOnly` bật
    directThreadSql(ctx, "g"),
    // Bị khoanh phạm vi → không thấy cuộc riêng nào (khác nhóm: danh sách gán chỉ chứa nhóm)
    ctx.principal.groupIds === null ? undefined : { sql: "1 = 0", params: [] },
    groupVisibilitySql(ctx, "g.id", "g.is_confidential"),
  ),
  aggregate: { groupBy: ["company_id"], sum: ["message_count"] },
  notes: ["Chỉ quản trị hoặc người được xem «mọi nhóm» thấy cuộc nhắn riêng. Đọc nội dung bằng get_thread_messages(thread_id = id).", "account_id (lọc): id tài khoản Zalo của bot — danh sách id + tên ở whoami.zalo_accounts; nhóm tính theo tài khoản còn ở trong nhóm, cuộc riêng theo tài khoản chủ cuộc."],
};
