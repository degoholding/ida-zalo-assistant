import type { z } from "zod/v4";
import { maxAccessLevelForRole } from "../../auth/mcp-api-key-store.js";
import type { Entity } from "../../auth/principal.js";
import { McpAccessLevel } from "../../constants.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";

// Một «thao tác ghi» của lõi: `prepare` (lúc đề xuất VÀ lúc xác nhận) kiểm đầu vào + quyền + phạm vi + Mật, đọc trạng thái hiện tại của
// đích rồi dựng bản xem trước; `execute` (chỉ lúc xác nhận) chạy qua dịch vụ có sẵn (task-service, ticket-service, patchContact…).
// Cả MCP lẫn trợ lý dùng chung — không nơi nào tự ghi SQL.

export interface WritePrepared {
  /** Câu mô tả CHÍNH XÁC điều sẽ ghi (hiển thị cho người duyệt). Có trích dữ liệu Zalo trong «…» — là dữ liệu, không phải chỉ dẫn. */
  preview: string;
  targetEntity: string;
  targetId: number | null;
  /** Dấu trạng thái đích lúc đề xuất; lúc xác nhận dựng lại — khác nhau nghĩa là đích đã bị đổi (lạc quan, báo «tạo nháp mới»). */
  stateToken: string;
}

export interface WriteExecuted {
  entity: string;
  id: number | null;
  /** Nhãn các trường đã đổi (tiếng Việt) — cho kết quả `confirm_write`. */
  changed: string[];
  message: string;
}

export interface WriteAction<P = unknown> {
  /** Tên công cụ `propose_*`; cũng là cột `mcp_write_draft.tool`. */
  tool: string;
  title: string;
  description: string;
  /** Quyền vai trò bắt buộc có `write` trên thực thể này. */
  entity: Entity;
  schema: z.ZodType<P>;
  prepare(ctx: DataAccessContext, payload: P): Promise<WritePrepared>;
  /**
   * `expectedState` = dấu trạng thái đích lúc đề xuất. Thao tác ghi lên bản ghi có sẵn PHẢI kiểm lại dấu này ngay trước khi ghi, trong
   * khóa dòng / điều kiện UPDATE (xem `write-row-lock.ts`) — không ghi đè nếu đích vừa bị đổi giữa `prepare` và lúc ghi (M1).
   */
  execute(ctx: DataAccessContext, payload: P, expectedState: string): Promise<WriteExecuted>;
}

export type AnyWriteAction = WriteAction<unknown>;

/** Vai trò được ghi qua AI (D3, 17/10/2026): chỉ Quản trị / Quản lý. Nhân viên chỉ đọc qua AI ở mọi cổng, kể cả mẫu tin. */
export const roleMayWriteViaAi = (ctx: DataAccessContext): boolean => maxAccessLevelForRole(ctx.principal.role) === McpAccessLevel.ReadWrite;

/** Ghi được qua AI = khóa / trợ lý mức đọc+ghi ∧ có tài khoản web thật (không phải principal suy ra) ∧ vai trò Quản trị / Quản lý ∧ có quyền ghi thực thể. */
export function canPropose(ctx: DataAccessContext, action: AnyWriteAction): boolean {
  return ctx.principal.userId !== null && roleMayWriteViaAi(ctx) && canUse(ctx, action.entity, "write");
}

/** Xếp nhiều thao tác khác kiểu tham số vào một danh sách. Ép kiểu ở ĐÚNG MỘT chỗ: `confirm_write` luôn kiểm `schema` trước khi gọi `prepare` / `execute`. */
export function eraseAction<P>(action: WriteAction<P>): AnyWriteAction {
  return action as unknown as AnyWriteAction;
}
