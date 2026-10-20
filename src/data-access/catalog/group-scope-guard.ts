import { DataAccessError } from "../data-access-errors.js";
import type { DataAccessContext } from "../data-access-context.js";

// Luật DỮ LIỆU «hỏi trong nhóm chỉ đọc thực thể gắn nhóm» (mọi thành viên đọc câu trả lời): đặt ở LÕI để mọi đường (đường cũ của trợ lý,
// máy chủ MCP trong tiến trình) cùng bị chặn như nhau. Cổng /mcp ngoài không đặt `groupScopeId` nên không đổi.

/** Thực thể được đọc khi hỏi trong nhóm — đều lọc theo nhóm của principal (đã thu hẹp về nhóm đang hỏi). */
export const GROUP_SCOPE_ENTITIES: readonly string[] = ["groups", "messages", "files"];

export const groupScopeEntityMessage = (): string => `Hỏi trong nhóm chỉ đọc được thực thể: ${GROUP_SCOPE_ENTITIES.join(", ")}.`;

/** Ném `forbidden` nếu đang hỏi trong nhóm mà `entity` ngoài danh sách (thiếu `entity` cũng bị chặn). */
export function assertGroupScopeEntity(ctx: DataAccessContext, entity: unknown): void {
  if (ctx.groupScopeId === undefined) return;
  if (typeof entity !== "string" || !GROUP_SCOPE_ENTITIES.includes(entity)) throw new DataAccessError("forbidden", groupScopeEntityMessage());
}
