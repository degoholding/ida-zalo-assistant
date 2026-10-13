import * as XLSX from "xlsx";
import { ApiError } from "../web/api/api-http.js";
import { CatalogKind } from "../constants.js";
import type { CatalogRowError, ParsedCatalog, ParsedCatalogEntry } from "./catalog-types.js";
import { foldKey, toLocalPhone } from "./catalog-text.js";

// Đọc tệp Excel danh mục NV / ĐL theo mẫu 2 sheet (NhanVien, DaiLy). Chịu tiêu đề không dấu / hoa thường / có dấu *.
// Lỗi dòng gom vào `errors` (dòng đúng vẫn nạp); lỗi cả tệp (không phải xlsx, thiếu sheet, thiếu cột bắt buộc, quá cỡ) → 422.

export const MAX_CATALOG_ROWS = 5000;
export const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
/** Mã bắt đầu bằng «VD-» là dòng ví dụ của tệp mẫu — bỏ qua. */
const EXAMPLE_CODE_PREFIX = "vd-";

type ColumnKey = "code" | "name" | "phone" | "title" | "region" | "salesZone" | "owner" | "email" | "expects" | "active" | "level" | "address" | "note";

interface SheetSpec {
  kind: CatalogKind;
  /** Tên sheet đã gấp dấu chấp nhận. */
  sheetKeys: string[];
  label: string;
  required: ColumnKey[];
  /** Tiêu đề (đã gấp dấu) → khóa cột; khớp tiền tố dài nhất. */
  aliases: Record<ColumnKey, string[]>;
  codeRequiredMessage: string;
}

const EMPTY_ALIASES: Record<ColumnKey, string[]> = {
  code: [], name: [], phone: ["sdt", "sodienthoai", "dienthoai", "phone"], title: [], region: ["khuvuc"], salesZone: ["vungsales", "vung"],
  owner: [], email: [], expects: [], active: [], level: [], address: [], note: [],
};

const STAFF_SPEC: SheetSpec = {
  kind: CatalogKind.Staff,
  sheetKeys: ["nhanvien", "nv"],
  label: "NhanVien",
  required: ["code", "name", "region"],
  codeRequiredMessage: "thiếu Mã NV",
  aliases: {
    ...EMPTY_ALIASES,
    code: ["manv", "manhanvien", "ma"], name: ["hoten", "tennhanvien", "ten"], title: ["chucdanh", "chucvu"],
    owner: ["manguoiquanly", "maquanly", "manvquanly"], email: ["email", "mail"], expects: ["phaibaoso"], active: ["danglam"],
  },
};

const DEALER_SPEC: SheetSpec = {
  kind: CatalogKind.Dealer,
  sheetKeys: ["daily", "dl"],
  label: "DaiLy",
  required: ["code", "name", "region", "owner"],
  codeRequiredMessage: "thiếu Mã ĐL",
  aliases: {
    ...EMPTY_ALIASES,
    code: ["madl", "madaily", "ma"], name: ["tendaily", "tendl", "ten"], level: ["cap"], address: ["diachi", "tinh"],
    owner: ["manvphutrach", "manhanvienphutrach", "maphutrach"], active: ["danghoptac"], note: ["ghichu"],
  },
};

const FIELD_LABEL: Record<ColumnKey, string> = {
  code: "Mã", name: "Tên", phone: "SĐT", title: "Chức danh", region: "Khu vực", salesZone: "Vùng sales", owner: "Mã người phụ trách / quản lý",
  email: "Email", expects: "Phải báo số", active: "Đang làm / hợp tác", level: "Cấp", address: "Địa chỉ", note: "Ghi chú",
};

/** Tiêu đề → khóa cột theo tiền tố dài nhất trong bí danh. */
function resolveColumns(headers: string[], spec: SheetSpec): Map<ColumnKey, number> {
  const columns = new Map<ColumnKey, number>();
  headers.forEach((raw, index) => {
    const folded = foldKey(raw);
    if (!folded) return;
    let best: { key: ColumnKey; length: number } | null = null;
    for (const [key, aliases] of Object.entries(spec.aliases) as [ColumnKey, string[]][]) {
      for (const alias of aliases) {
        if (folded.startsWith(alias) && (!best || alias.length > best.length)) best = { key, length: alias.length };
      }
    }
    if (best && !columns.has(best.key)) columns.set(best.key, index);
  });
  return columns;
}

/** Có / Không → boolean; trống → mặc định; lạ → null. */
function parseYesNo(raw: string, fallback: boolean): boolean | null {
  const value = foldKey(raw);
  if (!value) return fallback;
  if (["co", "c", "1", "x", "yes", "y", "true"].includes(value)) return true;
  if (["khong", "k", "0", "no", "n", "false"].includes(value)) return false;
  return null;
}

function parseSheet(rows: unknown[][], spec: SheetSpec, errors: CatalogRowError[], seen: Set<string>): ParsedCatalogEntry[] {
  const columns = resolveColumns((rows[0] ?? []).map(String), spec);
  const missing = spec.required.filter((key) => !columns.has(key));
  if (missing.length) {
    throw new ApiError(422, "invalid_catalog_file", `Sheet ${spec.label} thiếu cột bắt buộc: ${missing.map((key) => FIELD_LABEL[key]).join(", ")}`);
  }
  if (rows.length - 1 > MAX_CATALOG_ROWS) throw new ApiError(422, "invalid_catalog_file", `Sheet ${spec.label} quá ${MAX_CATALOG_ROWS} dòng`);

  const entries: ParsedCatalogEntry[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const line = index + 1;
    const cells = rows[index] ?? [];
    const get = (key: ColumnKey): string => {
      const at = columns.get(key);
      return at === undefined ? "" : String(cells[at] ?? "").trim();
    };
    if (cells.every((cell) => String(cell ?? "").trim() === "")) continue;
    const fail = (message: string): void => { errors.push({ sheet: spec.label, row: line, message }); };

    const code = get("code");
    if (!code) { fail(spec.codeRequiredMessage); continue; }
    if (code.toLowerCase().startsWith(EXAMPLE_CODE_PREFIX)) continue;
    if (code.length > 40) { fail("Mã quá 40 ký tự"); continue; }
    const missingField = (["name", "region", "owner"] as ColumnKey[]).find((key) => spec.required.includes(key) && !get(key));
    if (missingField) { fail(`thiếu ${FIELD_LABEL[missingField]}`); continue; }
    const seenKey = `${spec.kind}:${code.toLowerCase()}`;
    if (seen.has(seenKey)) { fail(`mã ${code} trùng với dòng trước trong tệp`); continue; }
    seen.add(seenKey);

    let phone = toLocalPhone(get("phone"));
    if (phone === null) { fail(`SĐT «${get("phone").slice(0, 20)}» không phải số di động Việt Nam — bỏ SĐT, vẫn nạp dòng`); phone = ""; }
    const active = parseYesNo(get("active"), true);
    const expects = spec.kind === CatalogKind.Staff ? parseYesNo(get("expects"), true) : false;
    if (active === null) fail("«Đang làm / hợp tác» phải là Có hoặc Không — dùng mặc định Có");
    if (expects === null) fail("«Phải báo số» phải là Có hoặc Không — dùng mặc định Có");

    const extra: Record<string, string> = {};
    for (const key of ["title", "email", "level", "address", "note"] as ColumnKey[]) if (get(key)) extra[key] = get(key).slice(0, 500);
    entries.push({
      kind: spec.kind, code, name: get("name").slice(0, 200), phone, region: get("region").slice(0, 100), salesZone: get("salesZone").slice(0, 100),
      ownerCode: get("owner").slice(0, 40), isActive: active ?? true, expectsReport: expects ?? true, extra,
    });
  }
  return entries;
}

export function parseCatalogWorkbook(buffer: Buffer): ParsedCatalog {
  if (!buffer.length) throw new ApiError(422, "invalid_catalog_file", "Tệp rỗng");
  if (buffer.length > MAX_CATALOG_BYTES) throw new ApiError(413, "payload_too_large", "Tệp quá 5 MB");
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new ApiError(422, "invalid_catalog_file", "Không đọc được tệp — cần tệp Excel .xlsx theo mẫu");
  }
  const errors: CatalogRowError[] = [];
  const seen = new Set<string>();
  const entries: ParsedCatalogEntry[] = [];
  let found = 0;
  // Nhân viên trước đại lý: mã trùng chỉ xét trong cùng loại (khóa có kind)
  for (const spec of [STAFF_SPEC, DEALER_SPEC]) {
    const sheetName = workbook.SheetNames.find((name) => spec.sheetKeys.includes(foldKey(name)));
    if (!sheetName) continue;
    found += 1;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
    entries.push(...parseSheet(rows, spec, errors, seen));
  }
  if (!found) throw new ApiError(422, "invalid_catalog_file", "Tệp không có sheet NhanVien hoặc DaiLy — tải mẫu để điền");
  return { entries, errors };
}

/** «Sheet NhanVien dòng 7: thiếu Khu vực». */
export function formatRowError(error: CatalogRowError): string {
  return `Sheet ${error.sheet} dòng ${error.row}: ${error.message}`;
}
