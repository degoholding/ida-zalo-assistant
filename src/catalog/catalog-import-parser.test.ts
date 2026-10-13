import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { CatalogKind } from "../constants.js";
import { ApiError } from "../web/api/api-http.js";
import { formatRowError, parseCatalogWorkbook } from "./catalog-import-parser.js";
import { buildCatalogTemplate } from "./catalog-template-workbook.js";

function book(sheets: Record<string, unknown[][]>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const STAFF_HEAD = ["Ma NV", "Ho ten", "sdt", "Khu vuc", "Phai bao so"];

test("tệp mẫu tải về: đọc được, dòng ví dụ VD-… bị bỏ qua, không lỗi", () => {
  const parsed = parseCatalogWorkbook(buildCatalogTemplate());
  assert.equal(parsed.entries.length, 0);
  assert.deepEqual(parsed.errors, []);
});

test("tiêu đề không dấu / hoa thường: đọc nhân viên, SĐT chuẩn hóa, mặc định Có", () => {
  const parsed = parseCatalogWorkbook(book({ NhanVien: [STAFF_HEAD, ["NV001", "Huy", 912345678, "Miền Tây", ""], ["NV002", "Tâm", "", "Đông Nam Bộ", "Không"]] }));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].phone, "0912345678");
  assert.equal(parsed.entries[0].kind, CatalogKind.Staff);
  assert.equal(parsed.entries[0].expectsReport, true);
  assert.equal(parsed.entries[1].expectsReport, false);
  assert.equal(parsed.entries[1].isActive, true);
});

test("lỗi theo dòng: thiếu Khu vực, mã trùng, SĐT sai (vẫn nạp), dòng trống bỏ qua — số dòng đúng như trong Excel", () => {
  const parsed = parseCatalogWorkbook(book({
    NhanVien: [STAFF_HEAD, ["NV001", "Huy", "", "Miền Tây", ""], [], ["NV002", "Tâm", "", "", ""], ["NV001", "Trùng", "", "Miền Tây", ""], ["NV003", "Lan", "123", "Miền Tây", ""]],
  }));
  assert.deepEqual(parsed.entries.map((e) => e.code), ["NV001", "NV003"]);
  assert.equal(parsed.entries[1].phone, "");
  const messages = parsed.errors.map(formatRowError);
  assert.ok(messages.includes("Sheet NhanVien dòng 4: thiếu Khu vực"));
  assert.ok(messages.some((m) => m.startsWith("Sheet NhanVien dòng 5: mã NV001 trùng")));
  assert.ok(messages.some((m) => m.startsWith("Sheet NhanVien dòng 6: SĐT")));
});

test("đại lý: bắt buộc Mã NV phụ trách; cấp / địa chỉ vào extra; mã trùng chỉ xét trong cùng loại", () => {
  const parsed = parseCatalogWorkbook(book({
    NhanVien: [STAFF_HEAD, ["X1", "Huy", "", "Miền Tây", ""]],
    DaiLy: [["Mã ĐL*", "Tên đại lý*", "Cấp (1/2)", "Khu vực*", "Mã NV phụ trách*", "Địa chỉ · Tỉnh / Thành"], ["X1", "ĐL Thành Công", 1, "Miền Tây", "X1", "Cần Thơ"], ["X2", "ĐL Hòa Bình", 2, "Miền Tây", "", ""]],
  }));
  assert.equal(parsed.entries.length, 2);
  const dealer = parsed.entries.find((e) => e.kind === CatalogKind.Dealer)!;
  assert.equal(dealer.ownerCode, "X1");
  assert.deepEqual(dealer.extra, { level: "1", address: "Cần Thơ" });
  assert.equal(dealer.expectsReport, false);
  assert.deepEqual(parsed.errors.map(formatRowError), ["Sheet DaiLy dòng 3: thiếu Mã người phụ trách / quản lý"]);
});

test("lỗi cả tệp → ApiError 422: không phải xlsx, thiếu sheet, thiếu cột bắt buộc, tệp rỗng", () => {
  const fails = (fn: () => unknown): void => assert.throws(fn, (error) => error instanceof ApiError && error.status === 422);
  fails(() => parseCatalogWorkbook(Buffer.from("không phải excel")));
  fails(() => parseCatalogWorkbook(book({ Khac: [["a"], ["b"]] })));
  fails(() => parseCatalogWorkbook(book({ NhanVien: [["Ma NV", "Ho ten"], ["NV1", "Huy"]] })));
  fails(() => parseCatalogWorkbook(Buffer.alloc(0)));
});
