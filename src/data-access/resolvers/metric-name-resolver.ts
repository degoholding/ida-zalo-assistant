import type { RowDataPacket } from "mysql2";
import { foldText } from "../../alerts/keyword-matcher.js";
import type { Db } from "../../db/pool.js";
import { resolveMetricCodes, type MetricCatalogItem } from "../../metrics/metric-aggregation.js";
import { loadStaffIndex } from "../../metrics/metric-staff-resolver.js";

// Phân giải TÊN → mã trong số liệu: chỉ tiêu («doanh số»), khu vực («Miền Tây»), nhân viên. Tên chỉ là BỘ LỌC trên dữ liệu đã có —
// không mở rộng phạm vi người hỏi được xem. Lỗi trả dạng `{ error }` (câu chữ cho người hỏi), không ném.

export interface MetricNameMatch {
  codes: string[];
  /** Nhãn các chỉ tiêu đang có (không trùng) — gợi ý khi không khớp. */
  available: string[];
}

export function resolveMetricName(catalog: MetricCatalogItem[], text: string): MetricNameMatch {
  return { codes: text ? resolveMetricCodes(catalog, text) : [], available: [...new Set(catalog.map((item) => item.label))] };
}

/** Khu vực người hỏi gõ → khóa khu vực trong số liệu (khớp gấp dấu, chấp nhận chứa). */
export async function findAreaKey(db: Db, text: string): Promise<{ key: string } | { error: string }> {
  const folded = foldText(text).trim();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT v.area_key, v.area_name FROM metric_value v JOIN metric_source s ON s.id = v.source_id
     WHERE s.is_active = 1 AND v.area_key <> '' ORDER BY v.area_name LIMIT 200`);
  const hits = rows.filter((row) => String(row.area_key) === folded || String(row.area_key).includes(folded));
  const exact = hits.find((row) => String(row.area_key) === folded);
  if (exact) return { key: String(exact.area_key) };
  if (hits.length === 1) return { key: String(hits[0].area_key) };
  const names = (hits.length ? hits : rows).slice(0, 15).map((row) => String(row.area_name));
  return { error: `${hits.length ? "Khu vực chưa rõ" : "Không có khu vực"} «${text}» trong số liệu. Khu vực đang có: ${names.join(", ") || "(chưa có)"}.` };
}

export async function findStaffId(db: Db, text: string): Promise<{ id: number } | { error: string }> {
  const folded = foldText(text).trim();
  const index = await loadStaffIndex(db);
  const hits = [...index.byCode.values()].filter((entry) => foldText(entry.name).includes(folded) || foldText(entry.code) === folded);
  if (hits.length === 1) return { id: hits[0].id };
  return { error: hits.length ? `Có ${hits.length} nhân viên khớp «${text}»: ${hits.slice(0, 8).map((e) => e.name).join(", ")} — hỏi lại tên đầy đủ.` : `Không thấy nhân viên «${text}» trong danh mục.` };
}
