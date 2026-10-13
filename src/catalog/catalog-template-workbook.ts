import * as XLSX from "xlsx";

// Tệp mẫu danh mục NV / ĐL tải từ web: sheet NhanVien, DaiLy (dòng 1 tiêu đề, * = bắt buộc, 2 dòng ví dụ mã «VD-…» sẽ bị bỏ
// qua khi nạp) và sheet «Hướng dẫn». Tiêu đề phải khớp bí danh trong catalog-import-parser.ts.

const STAFF_HEADER = ["Mã NV*", "Họ tên*", "SĐT", "Chức danh", "Khu vực*", "Vùng sales", "Mã người quản lý", "Email", "Phải báo số (Có/Không)", "Đang làm (Có/Không)"];
const STAFF_EXAMPLES = [
  ["VD-NV001", "Huy", "0912345678", "Sales", "Miền Tây", "Cần Thơ – Hậu Giang", "", "huy@example.com", "Có", "Có"],
  ["VD-NV002", "Tâm", "", "Trưởng vùng", "Đông Nam Bộ", "Đồng Nai", "VD-NV001", "", "Có", "Có"],
];
const DEALER_HEADER = ["Mã ĐL*", "Tên đại lý*", "Cấp (1/2)", "SĐT", "Địa chỉ · Tỉnh / Thành", "Khu vực*", "Vùng sales", "Mã NV phụ trách*", "Đang hợp tác (Có/Không)", "Ghi chú"];
const DEALER_EXAMPLES = [
  ["VD-DL001", "ĐL Thành Công", 1, "0987654321", "12 Nguyễn Trãi, Cần Thơ", "Miền Tây", "Cần Thơ – Hậu Giang", "VD-NV001", "Có", ""],
  ["VD-DL002", "ĐL Hòa Bình", 2, "", "Biên Hòa, Đồng Nai", "Đông Nam Bộ", "Đồng Nai", "VD-NV002", "Có", "Mới hợp tác"],
];
const GUIDE = [
  ["Hướng dẫn nạp danh mục nhân viên / đại lý"],
  [""],
  ["1. Điền sheet NhanVien và DaiLy, giữ nguyên dòng tiêu đề (cột có dấu * là bắt buộc)."],
  ["2. Dòng ví dụ có mã bắt đầu bằng «VD-» sẽ được bỏ qua — xóa hoặc thay bằng dữ liệu thật."],
  ["3. Mã NV / Mã ĐL là duy nhất và là khóa nạp lại: nạp lần nữa thì cập nhật, không nhân bản."],
  ["4. SĐT là số di động Việt Nam (0912 345 678, +84912345678 đều được) — dùng để khớp người trong Danh bạ Zalo."],
  ["5. «Mã người quản lý» (NhanVien) và «Mã NV phụ trách» (DaiLy) là Mã NV của người đó trong sheet NhanVien."],
  ["6. Cột Có/Không để trống thì mặc định Có. «Phải báo số» dùng để tính nhân viên chưa báo số liệu."],
  ["7. Sau khi nạp, hệ thống tự khớp theo SĐT / tên với Danh bạ; chỗ không chắc sẽ chờ quản trị xác nhận."],
];

function sheetOf(rows: unknown[][], widths: number[]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  return sheet;
}

export function buildCatalogTemplate(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheetOf([STAFF_HEADER, ...STAFF_EXAMPLES], [12, 18, 14, 16, 16, 24, 18, 22, 22, 20]), "NhanVien");
  XLSX.utils.book_append_sheet(workbook, sheetOf([DEALER_HEADER, ...DEALER_EXAMPLES], [12, 22, 10, 14, 30, 16, 24, 18, 24, 24]), "DaiLy");
  XLSX.utils.book_append_sheet(workbook, sheetOf(GUIDE, [110]), "Hướng dẫn");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
