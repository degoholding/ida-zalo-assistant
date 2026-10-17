import { commandScopeWhere, SEND_COMMAND_LIST_SPEC } from "../../web/api/send-commands-api.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts } from "../visibility-guards.js";

// Nhật ký lệnh gửi tin. Phạm vi như màn Gửi tin: quản trị thấy hết, vai trò khác chỉ lệnh do CHÍNH mình ra. Không Mật thì ẩn lệnh
// có nơi nhận là nhóm Mật. Không bao giờ trả danh sách tệp đính kèm.
const TARGET_COUNT = (extra: string) => `(SELECT COUNT(*) FROM send_command_target tg WHERE tg.command_id = c.id${extra})`;

export const sendCommandEntity: EntityDefinition = {
  name: "send_commands",
  title: "Lệnh gửi tin",
  permission: "send_command",
  from: "send_command c",
  spec: () => SEND_COMMAND_LIST_SPEC,
  columns: {
    id: { sql: "c.id", type: "number" },
    source: { sql: "c.source", type: "number" },
    status: { sql: "c.status", type: "number" },
    action_kind: { sql: "c.action_kind", type: "number" },
    requester_uid: { sql: "c.requester_uid", type: "text" },
    requester_name: { sql: "c.requester_name", type: "text", untrusted: true },
    body: { sql: "c.body", type: "text", untrusted: true },
    scheduled_at: { sql: "c.scheduled_at", type: "date" },
    reminder_at: { sql: "c.reminder_at", type: "date" },
    created_at: { sql: "c.created_at", type: "date" },
    cancelled_by: { sql: "c.cancelled_by", type: "text" },
    target_count: { sql: TARGET_COUNT(""), type: "number" },
    sent_count: { sql: TARGET_COUNT(" AND tg.status = 3"), type: "number" },
    failed_count: { sql: TARGET_COUNT(" AND tg.status = 4"), type: "number" },
  },
  defaultFields: ["id", "status", "action_kind", "requester_name", "body", "created_at", "target_count", "sent_count", "failed_count"],
  baseWhere: (ctx) => andParts(
    commandScopeWhere(ctx.principal),
    ctx.includeConfidential ? undefined : {
      sql: "NOT EXISTS (SELECT 1 FROM send_command_target tx JOIN zalo_group gx ON gx.id = tx.thread_id WHERE tx.command_id = c.id AND gx.is_confidential = 1)",
      params: [],
    },
  ),
  aggregate: { groupBy: ["status", "source", "action_kind", "requester_uid", "requester_name"], sum: [] },
  notes: ["Chỉ ĐỌC nhật ký; gửi tin Zalo qua MCP chưa hỗ trợ."],
};
