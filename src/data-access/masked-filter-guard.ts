import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError } from "./data-access-errors.js";

// Chống «dò» dữ liệu cá nhân bằng bộ lọc / tìm kiếm khi bật «Che dữ liệu cá nhân trước khi gửi AI»: che chỉ làm trên ĐẦU RA,
// nên nếu cho lọc `contains "0912"` thì có / không dòng = lộ từng chữ số. Khi che bật, một giá trị lọc / tìm có TỔNG ≥ 9 chữ số (mọi từ khóa trong
// cùng một câu cộng lại; chữ số Unicode / toàn chiều đều tính; dấu cách . - + _ % , / giữa các số không đánh lừa được) bị từ chối. 9 = phần đuôi tối thiểu của SĐT di động sau số 0 (`0[35789]\d{8}`); CCCD 12 số,
// nên mọi số bị che đều ≥ 9 số. Mã đơn / mã SP / năm («DH-20241018», «12345», «2024») ≤ 8 số nên vẫn tìm được.
// Dư lượng chấp nhận (quyết định chủ O4, 19/10/2026): ghép số bằng các cửa sổ ≤ 8 số chồng nhau qua NHIỀU lời gọi riêng (trong một lời gọi thì đã cộng tổng), và STK 6–8 số
// không bị chặn. Giảm nhẹ bằng giới hạn nhịp MCP ngoài, trần lượt trợ lý, `mcp_call_log` lưu xem trước tham số để soát.
// Dùng chung cho MCP ngoài và trợ lý.

export const MIN_DIGITS_PROBE = 9;

/**
 * Tổng số chữ số trong MỘT câu tìm / giá trị lọc: NFKC (số toàn chiều ０-９ → 0-9) rồi đếm mọi `\p{Nd}` (cả số Ả Rập ٠-٩, Devanagari…). Cộng
 * TỔNG qua mọi từ khóa nên dấu ngăn (khoảng trắng . - + _ % , / …) hay việc tách SĐT thành nhiều từ khóa không đánh lừa được.
 */
export function totalDigits(value: string): number {
  return [...value.normalize("NFKC")].filter((char) => /\p{Nd}/u.test(char)).length;
}

/** Ném `invalid_value` nếu `ctx.maskPersonal` bật và `value` (một câu tìm, mọi từ khóa tính chung) có ≥ 9 chữ số giống SĐT / CCCD / STK. */
export function assertNoPersonalNumberProbe(ctx: DataAccessContext, field: string, value: unknown): void {
  if (!ctx.maskPersonal || typeof value !== "string") return;
  if (totalDigits(value) < MIN_DIGITS_PROBE) return;
  throw new DataAccessError("invalid_value",
    `«${field}»: đang bật che dữ liệu cá nhân nên không lọc / tìm theo dãy từ ${MIN_DIGITS_PROBE} chữ số trở lên (tránh dò SĐT, CCCD) — tìm theo chữ hoặc theo mã.`);
}
