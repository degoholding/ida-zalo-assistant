import type { CatalogKind, CatalogMatchStatus } from "../constants.js";

// Kiểu dùng chung của bộ nạp danh mục NV / đại lý (phase 10, phase 6).

/** Một dòng đã đọc + chuẩn hóa từ tệp Excel. */
export interface ParsedCatalogEntry {
  kind: CatalogKind;
  code: string;
  name: string;
  /** Dạng 0xxxxxxxxx, rỗng nếu không có / sai. */
  phone: string;
  region: string;
  salesZone: string;
  /** Nhân viên: mã người quản lý; đại lý: mã nhân viên phụ trách. */
  ownerCode: string;
  isActive: boolean;
  expectsReport: boolean;
  /** Chức danh, email, cấp, địa chỉ, ghi chú… (chỉ giữ ô có chữ). */
  extra: Record<string, string>;
}

export interface CatalogRowError {
  sheet: string;
  /** Số dòng trong Excel (dòng 1 là tiêu đề). */
  row: number;
  message: string;
}

export interface ParsedCatalog {
  entries: ParsedCatalogEntry[];
  errors: CatalogRowError[];
}

/** Liên hệ Zalo dùng để khớp. */
export interface MatchContact {
  id: number;
  name: string;
  /** ContactKind. */
  kind: number;
  /** Dạng 0xxxxxxxxx hoặc rỗng. */
  phone: string;
}

export interface MatchEntryInput {
  kind: CatalogKind;
  name: string;
  phone: string;
}

export interface MatchCandidate {
  contactId: number;
  name: string;
  score: number;
}

export interface MatchResult {
  status: CatalogMatchStatus;
  contactId?: number;
  candidates: MatchCandidate[];
}

export interface CatalogImportSummary {
  created: number;
  updated: number;
  matched: number;
  suggested: number;
  unmatched: number;
  errors: string[];
}
