import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError } from "./data-access-errors.js";

// Chống «dò» dữ liệu cá nhân bằng bộ lọc / tìm kiếm khi bật «Che dữ liệu cá nhân trước khi gửi AI»: che chỉ làm trên ĐẦU RA,
// nên nếu cho lọc `contains "0912"` thì có / không dòng = lộ từng chữ số. Khi che bật, giá trị lọc / tìm CHỨA dãy ≥ 4 chữ số
// (bỏ dấu cách . - + giữa các số) bị từ chối. Đánh đổi có chủ ý: mất khả năng tìm theo số ngắn (mã đơn «12345», năm…) qua
// MCP khi bật che — lọc theo trường số (id, kind…) và tìm theo chữ vẫn dùng bình thường.

const MIN_DIGITS_PROBE = 4;

/** Dãy chữ số liền nhau dài nhất sau khi bỏ dấu phân cách trong số điện thoại. */
function longestDigitRun(value: string): number {
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
