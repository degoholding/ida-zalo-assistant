import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError } from "./data-access-errors.js";

// Chống «dò» dữ liệu cá nhân bằng bộ lọc / tìm kiếm khi bật «Che dữ liệu cá nhân trước khi gửi AI»: che chỉ làm trên ĐẦU RA,
// nên nếu cho lọc `contains "0912"` thì có / không dòng = lộ từng chữ số. Khi che bật, giá trị lọc / tìm CHỨA dãy ≥ 9 chữ số
// (bỏ dấu cách . - + giữa các số) bị từ chối. 9 = phần đuôi tối thiểu của SĐT di động sau số 0 (`0[35789]\d{8}`); CCCD 12 số,
// nên mọi số bị che đều ≥ 9 số liền. Mã đơn / mã SP / năm («DH-20241018», «12345», «2024») ≤ 8 số nên vẫn tìm được.
// Dư lượng chấp nhận (quyết định chủ O4, 19/10/2026): ghép số bằng các cửa sổ ≤ 8 số chồng nhau trên MỘT bản ghi, và STK 6–8 số
// không bị chặn. Giảm nhẹ bằng giới hạn nhịp MCP ngoài, trần lượt trợ lý, `mcp_call_log` lưu xem trước tham số để soát.
// Dùng chung cho MCP ngoài và trợ lý.

export const MIN_DIGITS_PROBE = 9;

/** Dãy chữ số liền nhau dài nhất sau khi bỏ dấu phân cách trong số điện thoại. */
export function longestDigitRun(value: string): number {
  const runs = value.replace(/(?<=\d)[\s.\-+](?=\d)/g, "").match(/\d+/g) ?? [];
  return runs.reduce((max, run) => Math.max(max, run.length), 0);
}

/** Ném `invalid_value` nếu `ctx.maskPersonal` bật và `value` có dãy số giống SĐT / CCCD / STK. */
export function assertNoPersonalNumberProbe(ctx: DataAccessContext, field: string, value: unknown): void {
  if (!ctx.maskPersonal || typeof value !== "string") return;
  if (longestDigitRun(value) < MIN_DIGITS_PROBE) return;
  throw new DataAccessError("invalid_value",
    `«${field}»: đang bật che dữ liệu cá nhân nên không lọc / tìm theo dãy từ ${MIN_DIGITS_PROBE} chữ số trở lên (tránh dò SĐT, CCCD) — tìm theo chữ hoặc theo mã.`);
}
