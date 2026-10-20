import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { canPropose, type AnyWriteAction, type WriteExecuted } from "./write-action.js";
import { guardWrite } from "./write-errors.js";

// Ghi NGAY (không nháp) cho thao tác quan hệ có `confirmMode: "immediate"` — việc / ticket / tin cần xử lý do mô hình khởi xướng giữ ghi ngay như
// hôm nay (BC1 đã bỏ). Vẫn đủ lớp bảo vệ của nháp: kiểm `schema`, quyền (`canPropose` — cần `contactActor`), `prepare` (luật quan hệ + đích HIỆN TẠI),
// rồi `execute` với dấu trạng thái vừa dựng (kiểm lại trong khóa dòng). Không để lại dòng `mcp_write_draft`; nhật ký gọi do cổng công cụ ghi.

export async function executeImmediateWrite(ctx: DataAccessContext, action: AnyWriteAction, rawArgs: unknown): Promise<WriteExecuted> {
  if (action.confirmMode !== "immediate") throw new DataAccessError("forbidden", `Thao tác ${action.tool} cần nháp + xác nhận, không ghi ngay được.`);
  if (!canPropose(ctx, action)) throw new DataAccessError("forbidden", "Không đủ điều kiện thực hiện thao tác này.");
  const parsed = action.schema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new DataAccessError("invalid_value", `Tham số không hợp lệ: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(gốc)"}: ${issue.message}`).join("; ")}`);
  }
  const prepared = await guardWrite(() => action.prepare(ctx, parsed.data));
  return guardWrite(() => action.execute(ctx, parsed.data, prepared.stateToken));
}
