// Che dữ liệu cá nhân trước khi đưa cho mô hình AI (phase 3, bước 3.3; IDA tính năng B36 + hồ sơ bảo vệ dữ liệu cá
// nhân): số điện thoại, số căn cước, số tài khoản ngân hàng. Giữ 3 số cuối để người hỏi vẫn nhận ra («[SĐT ***678]»).
//
// Cố ý KHÔNG che mọi dãy số dài: tiền trong báo cáo hay viết liền («150000000»), mã đơn, mã lô. Chỉ che khi chắc:
// - SĐT Việt Nam: 0 + đầu số di động 3/5/7/8/9 + 8 số, hoặc +84 / 84 thay số 0; cho phép cách bằng dấu cách / chấm / gạch.
// - CCCD: 12 số bắt đầu bằng 0 (mã tỉnh 001–096) — tiền không bao giờ mở đầu bằng 0.
// - Số tài khoản: chỉ khi có chữ «STK», «số tài khoản», «tài khoản», «TK» đứng ngay trước.
// Tệp PDF / ảnh / ghi âm gửi NGUYÊN cho mô hình đọc nên không che được — ghi rõ ở trợ giúp của cài đặt.

const keepLast = (digits: string) => digits.replace(/\D/g, "").slice(-3);

// Không dính chữ / số ở hai đầu — «DH0912345678X» là mã đơn, không phải SĐT
const PHONE = /(?<![\p{L}\d+])(?:\+?84[\s.-]?|0)(?:3|5|7|8|9)(?:[\s.-]?\d){8}(?![\p{L}\d])/gu;
const CITIZEN_ID = /(?<![\p{L}\d])0\d{11}(?![\p{L}\d])/gu;
const BANK_ACCOUNT = /((?:\bSTK|\bs[ốo] t[àa]i kho[ảa]n|\bt[àa]i kho[ảa]n|\bTK)\s*(?:s[ốo]\s*)?[:.\-–]?\s*)(\d[\d\s.-]{4,22}\d)/giu;

/** Che SĐT, CCCD, số tài khoản trong một chuỗi. Hàm thuần. */
export function maskPersonalData(text: string): string {
  if (!text) return text;
  return text
    .replace(BANK_ACCOUNT, (_match, label: string, digits: string) => `${label}[STK ***${keepLast(digits)}]`)
    .replace(CITIZEN_ID, (match) => `[CCCD ***${keepLast(match)}]`)
    .replace(PHONE, (match) => `[SĐT ***${keepLast(match)}]`);
}

/** Che trong mọi chuỗi của một giá trị JSON (kết quả công cụ đưa cho mô hình). Không đổi khóa, không đổi số. */
export function maskPersonalDataDeep<T>(value: T): T {
  if (typeof value === "string") return maskPersonalData(value) as T;
  if (Array.isArray(value)) return value.map((item) => maskPersonalDataDeep(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskPersonalDataDeep(item)])) as T;
  }
  return value;
}
