import type { RowDataPacket } from "mysql2";
import { maskPersonalData } from "../privacy/personal-data.js";
import { MAX_GROUPS, type CompiledAggregate } from "./aggregate-compiler.js";
import { DEFAULT_CELL_CHARS, type ColumnSpec, type EntityDefinition } from "./entity-definition.js";
import type { CompiledRows } from "./query-compiler.js";
import { dbDateToVnIso } from "./vn-time.js";

// Vỏ kết quả: biến dòng thô của MySQL thành JSON có kiểu cho AI — ép kiểu, giờ ISO +07:00, cắt ô / cắt tổng, đánh dấu nội dung
// `untrusted`, dựng khối chữ bọc <du_lieu>. Che dữ liệu cá nhân làm ở `tool-runner` (một chỗ cho mọi công cụ).

/** Tổng ký tự JSON của `items` tối đa; vượt thì cắt dòng cuối và báo `truncated.rows`. */
export const MAX_RESULT_CHARS = 60_000;
export const MASK_NOTICE = "Đã che SĐT / STK / CCCD theo cài đặt «Che dữ liệu cá nhân trước khi gửi AI».";

export interface RowsResult {
  entity: string;
  items: Record<string, unknown>[];
  page: { number: number; size: number; has_more: boolean; total: number | null };
  untrusted_fields: string[];
  truncated: { rows: boolean; cells: string[] };
  notices: string[];
}

export interface GroupsResult {
  entity: string;
  groups: Record<string, unknown>[];
  group_count: number;
  untrusted_fields: string[];
  truncated: { groups: boolean };
  notices: string[];
}

/** Giá trị cột theo kiểu khai báo (null giữ null). */
export function shapeValue(type: ColumnSpec["type"], raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case "number": {
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }
    case "boolean": return Boolean(Number(raw));
    case "date": return dbDateToVnIso(raw);
    case "day": return raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
    default: return String(raw);
  }
}

/** Cắt chữ dài quá `max` đơn vị UTF-16, thêm «…»; bỏ nửa cặp thay thế (emoji) nằm sát chỗ cắt để không sinh ký tự hỏng. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Dòng thô → `RowsResult`: cắt ô theo `maxChars`, cắt tổng theo `MAX_RESULT_CHARS`, `has_more` từ dòng dư (`size + 1`).
 * `maskPersonal`: che SĐT / CCCD / STK TRƯỚC khi cắt ô — cắt rồi mới che thì số nằm ngay chỗ cắt («0912345…») lọt qua bộ che.
 */
export function shapeRows(def: EntityDefinition, compiled: CompiledRows, rows: RowDataPacket[], total: number | null, maskPersonal = false): RowsResult {
  const clippedCells = new Set<string>();
  const items: Record<string, unknown>[] = [];
  let used = 0;
  let cutRows = false;
  for (const row of rows.slice(0, compiled.pageSize)) {
    const item: Record<string, unknown> = {};
    for (const key of compiled.fields) {
      const column = def.columns[key];
      let value = shapeValue(column.type, row[key]);
      if (typeof value === "string") {
        const prepared = maskPersonal ? maskPersonalData(value) : value;
        const clipped = clipText(prepared, column.maxChars ?? DEFAULT_CELL_CHARS);
        if (clipped !== prepared) clippedCells.add(key);
        value = clipped;
      }
      item[key] = value;
    }
    const size = JSON.stringify(item).length;
    // Luôn giữ ít nhất một dòng để kết quả không rỗng vô cớ
    if (items.length > 0 && used + size > MAX_RESULT_CHARS) {
      cutRows = true;
      break;
    }
    used += size;
    items.push(item);
  }
  return {
    entity: def.name, items,
    page: { number: compiled.pageNumber, size: compiled.pageSize, has_more: cutRows || rows.length > compiled.pageSize, total },
    untrusted_fields: compiled.fields.filter((key) => def.columns[key].untrusted),
    truncated: { rows: cutRows, cells: [...clippedCells] },
    notices: [],
  };
}

/** Dòng gộp nhóm → `GroupsResult`; có > MAX_GROUPS nhóm thì bỏ nhóm dư và báo `truncated.groups`. */
export function shapeGroups(compiled: CompiledAggregate, rows: RowDataPacket[]): GroupsResult {
  const cut = rows.length > MAX_GROUPS;
  const groups = rows.slice(0, MAX_GROUPS).map((row) => {
    const group: Record<string, unknown> = {};
    for (const by of compiled.groupBy) group[by.key] = shapeValue(by.type, row[by.key]);
    group.count = Number(row.count);
    if (compiled.sumKey) group.sum = row.sum === null ? null : Number(row.sum);
    return group;
  });
  return {
    entity: compiled.entity, groups, group_count: groups.length,
    untrusted_fields: compiled.groupBy.filter((by) => by.untrusted).map((by) => by.key),
    truncated: { groups: cut }, notices: [],
  };
}

/**
 * Khối chữ cho client chỉ đọc `content`: một dòng tóm tắt + JSON bọc <du_lieu nguon="zalo">. Chuỗi `<du_lieu` / `</du_lieu` BÊN TRONG
 * dữ liệu bị thay bằng escape JSON (<) — vẫn giải mã ra đúng chữ gốc nhưng không thoát được khỏi khối.
 */
export function buildToolText(summary: string, data: unknown): string {
  const json = JSON.stringify(data).replace(/<(\/?du_lieu)/gi, "\\u003c$1");
  return `${summary}\n<du_lieu nguon="zalo">\n${json}\n</du_lieu>`;
}
