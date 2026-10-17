import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";

// H2 (review phase 8): khi «Che dữ liệu cá nhân» bật, mô hình chỉ thấy bản đã che («[SĐT ***678]»). Nếu nó chép nguyên chữ che đó vào
// nội dung cần ghi (ghi chú, tiêu đề việc, mẫu tin…) thì dữ liệu THẬT bị thay bằng chữ che và mất vĩnh viễn. Cổng ghi từ chối cả đề xuất.
// Dạng chữ che lấy đúng từ src/privacy/personal-data.ts («[SĐT|CCCD|STK ***ddd]»).

const MASK_TOKEN = /\[(?:SĐT|CCCD|STK) \*\*\*\d{3}\]/u;

/** Từ chối khi có chữ che trong bất kỳ chuỗi nào (chỉ khi bật che dữ liệu cá nhân). `label` = tên trường, để mô hình sửa đúng chỗ. */
export function assertNoMaskedText(ctx: DataAccessContext, fields: Record<string, string | readonly string[] | undefined>): void {
  if (!ctx.maskPersonal) return;
  for (const [label, value] of Object.entries(fields)) {
    const texts = value === undefined ? [] : typeof value === "string" ? [value] : value;
    if (texts.some((text) => MASK_TOKEN.test(text))) {
      throw new DataAccessError("invalid_value",
        `Trường «${label}» chứa chữ đã che dữ liệu cá nhân (vd «[SĐT ***678]») — ghi vào sẽ làm mất dữ liệu thật. Bỏ phần đã che khỏi nội dung, hoặc nhờ người dùng sửa trực tiếp trên web.`);
    }
  }
}
