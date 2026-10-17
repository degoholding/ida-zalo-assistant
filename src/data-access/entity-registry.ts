import { canUse, type DataAccessContext } from "./data-access-context.js";
import type { EntityDefinition } from "./entity-definition.js";
import { auditLogEntity } from "./entities/audit-log-entity.js";
import { catalogEntity } from "./entities/catalog-entity.js";
import { contactEntity } from "./entities/contact-entity.js";
import { conversationEntity } from "./entities/conversation-entity.js";
import { fileEntity } from "./entities/file-entity.js";
import { groupEntity } from "./entities/group-entity.js";
import { messageEntity } from "./entities/message-entity.js";
import { metricValueEntity } from "./entities/metric-value-entity.js";
import { replyTemplateEntity } from "./entities/reply-template-entity.js";
import { sendCommandEntity } from "./entities/send-command-entity.js";
import { taskEntity } from "./entities/task-entity.js";
import { ticketEntity } from "./entities/ticket-entity.js";

// Danh sách TRẮNG các thực thể truy vấn được. Bảng không có ở đây (app_user, web_session, app_setting, ai_key*, bot_account,
// recipient*, mcp_*, job, assistant_turn, brief_log, google_*) thì không thể tới được bằng bất kỳ lời gọi nào.

export const ENTITY_DEFINITIONS: readonly EntityDefinition[] = [
  groupEntity, conversationEntity, messageEntity, contactEntity, fileEntity, taskEntity, ticketEntity,
  sendCommandEntity, replyTemplateEntity, metricValueEntity, catalogEntity, auditLogEntity,
];

const BY_NAME = new Map(ENTITY_DEFINITIONS.map((def) => [def.name, def]));

export function findEntity(name: string): EntityDefinition | undefined {
  return BY_NAME.get(name);
}

/** Thực thể người gọi ĐỌC được (quyền vai trò; `audit_log` còn cần cờ xem nhật ký). */
export function readableEntities(ctx: DataAccessContext): EntityDefinition[] {
  return ENTITY_DEFINITIONS.filter((def) => canUse(ctx, def.permission, "read"));
}
