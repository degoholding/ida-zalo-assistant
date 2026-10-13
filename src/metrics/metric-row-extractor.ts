import { foldText } from "../alerts/keyword-matcher.js";
import { MetricFlag } from "../constants.js";
import type { ResolvedColumns } from "./metric-mapping.js";
import type { StaffIndex } from "./metric-staff-resolver.js";
import { resolveStaff } from "./metric-staff-resolver.js";
import { MappingError, METRIC_MAX_ROWS, METRIC_MAX_WARNINGS, METRIC_WINDOW_DAYS, type MetricRecord } from "./metric-types.js";
import { parseSheetDate, parseVnNumber } from "./metric-value-parser.js";

// Dòng bảng → bản ghi số liệu. Hàm thuần (không đọc DB, không đọc giờ): `todayIso` do nơi gọi đưa vào.

const DAY_MS = 86_400_000;

export interface ExtractResult {
  records: MetricRecord[];
  /** Tối đa METRIC_MAX_WARNINGS câu đầu */
  warnings: string[];
  warningTotal: number;
  /** Dòng ngoài cửa sổ ngày bị bỏ */
  outOfWindow: number;
}

export function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Ngày đầu của cửa sổ cập nhật / dọn (gồm cả hôm nay → đủ METRIC_WINDOW_DAYS ngày). */
export const windowFromIso = (todayIso: string) => shiftIso(todayIso, -(METRIC_WINDOW_DAYS - 1));

const cellText = (cell: unknown) => (cell === null || cell === undefined ? "" : String(cell).trim());

export function extractRecords(
  rows: unknown[][],
  columns: ResolvedColumns,
  staffBy: "name" | "code",
  headerRowNumber: number,
  staffIndex: StaffIndex,
  todayIso: string,
): ExtractResult {
  const dataRows = rows.length - headerRowNumber;
  if (dataRows > METRIC_MAX_ROWS) throw new MappingError(`Bảng quá lớn (${dataRows} dòng, tối đa ${METRIC_MAX_ROWS}) — tách theo tháng hoặc dùng tab khác.`);
  const from = windowFromIso(todayIso);
  const latest = shiftIso(todayIso, 1);
  const warnings: string[] = [];
  let warningTotal = 0;
  let outOfWindow = 0;
  const warn = (message: string) => {
    warningTotal += 1;
    if (warnings.length < METRIC_MAX_WARNINGS) warnings.push(message);
  };
  // Gộp theo khóa duy nhất của bảng metric_value
  const merged = new Map<string, MetricRecord & { aggregate: "sum" | "last"; unparsed: boolean }>();

  for (let i = headerRowNumber; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;
    const dateCell = row[columns.date];
    if (cellText(dateCell) === "" && cellText(row[columns.staff]) === "") continue; // dòng trống
    const date = parseSheetDate(dateCell);
    if (!date) {
      warn(`Dòng ${rowNumber}: ngày không đọc được`);
      continue;
    }
    if (date < from || date > latest) {
      outOfWindow += 1;
      continue;
    }
    const staffCell = cellText(row[columns.staff]);
    if (!staffCell) {
      warn(`Dòng ${rowNumber}: thiếu tên / mã nhân viên`);
      continue;
    }
    const staff = resolveStaff(staffIndex, staffCell, staffBy);
    const areaName = (columns.area !== null ? cellText(row[columns.area]) : "") || staff.region;
    const areaKey = foldText(areaName).trim().slice(0, 80);
    for (const { def, index } of columns.metrics) {
      const parsed = parseVnNumber(row[index]);
      if (parsed === null) continue;
      const unparsed = "unparsed" in parsed;
      if (unparsed) warn(`Dòng ${rowNumber}: ô «${def.label}» không đọc được thành số`);
      const value = unparsed ? null : parsed.value;
      const key = [date, staff.staffKey, areaKey, def.code].join("\u0000");
      const previous = merged.get(key);
      const base: MetricRecord & { aggregate: "sum" | "last"; unparsed: boolean } = {
        date, staffKey: staff.staffKey, staffName: staff.staffName, catalogEntryId: staff.catalogEntryId,
        areaKey, areaName: areaName.slice(0, 150), code: def.code, value,
        raw: unparsed ? parsed.raw : cellText(row[index]).slice(0, 100), row: rowNumber, baseFlags: 0,
        aggregate: def.aggregate, unparsed,
      };
      if (staff.unknown) base.baseFlags |= MetricFlag.UnknownStaff;
      if (!previous) {
        merged.set(key, base);
      } else if (def.aggregate === "last") {
        merged.set(key, base);
      } else {
        // sum: cộng phần đọc được; chỉ cần một ô hỏng là giữ cờ Unparsed
        const anyUnparsed = previous.unparsed || unparsed;
        const sum = previous.value === null && value === null ? null : (previous.value ?? 0) + (value ?? 0);
        merged.set(key, { ...base, value: sum, unparsed: anyUnparsed });
      }
    }
  }
  const records = [...merged.values()].map(({ aggregate: _aggregate, unparsed, ...record }) => ({
    ...record,
    baseFlags: record.baseFlags | (unparsed ? MetricFlag.Unparsed : 0),
  }));
  return { records, warnings, warningTotal, outOfWindow };
}
