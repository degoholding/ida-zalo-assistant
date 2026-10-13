import { foldKeepLength } from "../assistant/fold-text.js";
import { normalizeVietnamesePhone } from "../zalo/friend-requests.js";

// Chuẩn hóa chữ + số điện thoại cho danh mục. Hàm thuần.

/** Số di động VN → 0xxxxxxxxx; sai / không phải di động → null. Ô trống → "". */
export function toLocalPhone(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const international = normalizeVietnamesePhone(text);
  return international ? `0${international.slice(2)}` : null;
}

/** Gấp dấu, chữ thường, bỏ ký tự lạ → các từ cách nhau một dấu cách. */
export function foldWords(text: string): string {
  return foldKeepLength(String(text ?? "").normalize("NFC"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Gấp dấu và bỏ mọi ký tự không phải chữ / số — so tiêu đề cột, tên sheet. */
export function foldKey(text: string): string {
  return foldWords(text).replace(/ /g, "");
}

const PREFIX = /^(dai ly|daily|dl|anh|chi|em|co|chu|bac|ban|a|c|e)\s+(?=\S)/;

/** Tên so khớp: gấp dấu, bỏ «a / c / anh / chị / em / ĐL / đại lý» đứng đầu. */
export function matchName(text: string): string {
  let name = foldWords(text);
  for (let pass = 0; pass < 2; pass += 1) name = name.replace(PREFIX, "");
  return name;
}
