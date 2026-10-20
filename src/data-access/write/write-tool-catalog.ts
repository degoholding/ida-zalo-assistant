import { alertItemHandledAction } from "../alerts/alert-write-actions.js";
import { FAMILY_ACTIONS } from "../catalog/family-catalogs.js";
import { taskRelationshipUpdate } from "../tasks/task-relationship-write-actions.js";
import { ticketRelationshipUpdate } from "../tickets/ticket-relationship-write-actions.js";
import type { AnyToolDefinition } from "../tool-definition.js";
import { confirmWriteTool } from "./confirm-write-tool.js";
import { contactUpdateAction } from "./contact-write-tools.js";
import { groupUpdateAction } from "./group-write-tools.js";
import { proposeTool } from "./propose-tool-factory.js";
import { replyTemplateSaveAction } from "./reply-template-write-tools.js";
import { taskCreateAction, taskUpdateAction } from "./task-write-tools.js";
import { ticketAction } from "./ticket-write-tools.js";
import { eraseAction, type AnyWriteAction } from "./write-action.js";

// Danh mục công cụ GHI (phase 8): 6 `propose_*` + `confirm_write`. Gộp vào `toolsFor` của danh mục chung; `available` của mỗi công cụ
// đòi ctx.allowWrite + tài khoản thật + quyền vai trò, nên khóa chỉ đọc không thấy công cụ nào ở đây.

const ACTIONS = [
  eraseAction(taskCreateAction), eraseAction(taskUpdateAction), eraseAction(ticketAction),
  eraseAction(contactUpdateAction), eraseAction(groupUpdateAction), eraseAction(replyTemplateSaveAction),
];

/**
 * Thao tác QUAN HỆ ghi ngay khi từ lệnh gõ nhưng thành NHÁP khi do mô hình khởi xướng mà mã đích không do người hỏi nêu (D-A, own-text-target-guard.ts): chỉ để «đồng ý»
 * tra được theo tên — không có công cụ `propose_*` (cổng ngoài không thấy; không có `contactActor` thì `canPropose` sai).
 */
const GUARDED_RELATIONSHIP_ACTIONS = [eraseAction(taskRelationshipUpdate), eraseAction(ticketRelationshipUpdate), eraseAction(alertItemHandledAction)];

/** Tên `propose_*` → thao tác (Map, không tra prototype). Gồm cả thao tác của các họ trợ lý để xác nhận nháp tra được; công cụ `propose_*` của họ nằm ở danh mục họ. */
export const WRITE_ACTIONS: ReadonlyMap<string, AnyWriteAction> = new Map(
  [...ACTIONS, ...FAMILY_ACTIONS, ...GUARDED_RELATIONSHIP_ACTIONS].map((action) => [action.tool, action]));

export const CONFIRM_WRITE_TOOL_NAME = "confirm_write";

export const WRITE_TOOLS: readonly AnyToolDefinition[] = [
  ...ACTIONS.map((action) => proposeTool(action)),
  confirmWriteTool(WRITE_ACTIONS),
];
