import { ConversationType } from "../../constants.js";
import { GROUP_LIST_SPEC } from "../../web/api/groups-api.js";
import type { EntityDefinition } from "../entity-definition.js";
import { andParts, groupVisibilitySql } from "../visibility-guards.js";

// Nhóm Zalo (không gồm cuộc nhắn riêng). Phạm vi: nhóm được gán; nhóm Mật chỉ khi ctx được Mật.
export const groupEntity: EntityDefinition = {
  name: "groups",
  title: "Nhóm Zalo",
  permission: "group",
  from: "zalo_group g LEFT JOIN company co ON co.id = g.company_id",
  spec: () => GROUP_LIST_SPEC,
  columns: {
    id: { sql: "g.id", type: "number" },
    zalo_group_id: { sql: "g.zalo_group_id", type: "text" },
    name: { sql: "g.name", type: "text", untrusted: true },
    label: { sql: "g.label", type: "text", untrusted: true },
    group_kind: { sql: "g.group_kind", type: "number" },
    company_id: { sql: "g.company_id", type: "number" },
    company_name: { sql: "co.name", type: "text" },
    member_count: { sql: "g.member_count", type: "number" },
    message_count: { sql: "g.message_count", type: "number" },
    read_messages: { sql: "g.read_messages", type: "boolean" },
    capture_files: { sql: "g.capture_files", type: "boolean" },
    retention_days: { sql: "g.retention_days", type: "number" },
    file_retention_days: { sql: "g.file_retention_days", type: "number" },
    is_confidential: { sql: "g.is_confidential", type: "boolean" },
    first_seen_at: { sql: "g.first_seen_at", type: "date" },
    last_message_at: { sql: "g.last_message_at", type: "date" },
  },
  defaultFields: ["id", "name", "label", "group_kind", "company_name", "member_count", "last_message_at"],
  baseWhere: (ctx) => andParts(
    { sql: "g.thread_type = ?", params: [ConversationType.Group] },
    groupVisibilitySql(ctx, "g.id", "g.is_confidential"),
  ),
  aggregate: { groupBy: ["group_kind", "company_id", "read_messages", "capture_files"], sum: ["message_count", "member_count"] },
  notes: ["Nhóm Mật chỉ hiện khi khóa được cấp quyền Mật (xem whoami.confidential_included)."],
};
