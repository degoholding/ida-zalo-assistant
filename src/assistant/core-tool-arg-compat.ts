// Chỗ DUY NHẤT khai báo công cụ lõi cho trợ lý khác với MCP (phase 7):
//  1. `query_records.filters[].value` là z.union (chữ / số / true-false / mảng) → anyOf, Gemini không nhận. Khai cho mô hình: `value` =
//     chữ (lõi tự ép sang số / ngày / true-false theo kiểu trường) + `values` = mảng chữ cho in / not_in / between; trước khi tới zod,
//     `normalizeCoreToolArgs` gộp lại đúng dạng lõi cần.
//  2. Hỏi TRONG NHÓM (mọi thành viên đọc câu trả lời): chỉ các thực thể gắn nhóm (tin, tệp, nhóm). Số liệu / Danh bạ / ticket… không
//     gắn nhóm nên principal thu hẹp về một nhóm vẫn không đủ — cắt ở danh sách thực thể + kiểm lúc chạy.

import { GROUP_SCOPE_ENTITIES } from "../data-access/catalog/group-scope-guard.js";

type Json = Record<string, unknown>;

export { GROUP_SCOPE_ENTITIES };

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const VALUE_DESCRIPTION =
  "Giá trị so sánh, luôn ghi dạng chữ: 'Minh Phát', '5', 'true'. Ngày 'YYYY-MM-DD' (cả ngày giờ VN) hoặc ISO 8601. isnull: 'true' / 'false'. " +
  "Nhiều giá trị (in, not_in, between) thì dùng `values`.";
const VALUES_DESCRIPTION = "Mảng giá trị cho in, not_in (tối đa 200) và between (đúng 2: [từ, đến]); dạng chữ.";

/** Làm phẳng `value` của bộ lọc: tạo `value` (chữ) + `values` (mảng chữ) thay cho anyOf. Cấu trúc lạ thì giữ nguyên (bộ làm sạch xử lý tiếp). */
function flattenFilterValue(schema: Json): void {
  const filters = isObject(schema.properties) ? schema.properties.filters : undefined;
  const items = isObject(filters) ? filters.items : undefined;
  const props = isObject(items) && isObject(items.properties) ? items.properties : undefined;
  if (!props || !("value" in props)) return;
  props.value = { type: "string", description: VALUE_DESCRIPTION };
  props.values = { type: "array", items: { type: "string" }, description: VALUES_DESCRIPTION };
}

/**
 * Thu hẹp danh sách thực thể của `query_records` / `describe_entities` về `allowed`. Trả null khi không còn thực thể nào (bỏ công cụ).
 * `describe_entities` trong nhóm bắt buộc nêu `entity` (không liệt kê hết thực thể của hệ thống).
 */
function restrictEntities(schema: Json, allowed: readonly string[], requireEntity: boolean): boolean {
  const entity = isObject(schema.properties) ? schema.properties.entity : undefined;
  if (!isObject(entity) || !Array.isArray(entity.enum)) return true;
  const names = (entity.enum as unknown[]).filter((name): name is string => typeof name === "string" && allowed.includes(name));
  entity.enum = names;
  if (!names.length) return false;
  if (requireEntity) schema.required = [...new Set([...(Array.isArray(schema.required) ? schema.required : []), "entity"])];
  return true;
}

export interface CoreToolSchemaOptions {
  /** Chỉ cho các thực thể này (hỏi trong nhóm). Bỏ trống = mọi thực thể người hỏi đọc được. */
  allowedEntities?: readonly string[];
}

/** Sửa JSON Schema (zod → openapi-3.0) cho trợ lý; trả null = công cụ không còn dùng được ở ngữ cảnh này. */
export function patchCoreToolSchema(toolName: string, schema: Json, options: CoreToolSchemaOptions): Json | null {
  const copy = structuredClone(schema);
  if (toolName === "query_records") flattenFilterValue(copy);
  if (options.allowedEntities && (toolName === "query_records" || toolName === "describe_entities")) {
    if (!restrictEntities(copy, options.allowedEntities, toolName === "describe_entities")) return null;
  }
  return copy;
}

/** Đưa tham số mô hình gửi về đúng dạng zod của lõi: gộp `values` vào `value`; `isnull` nhận 'true' / 'false' dạng chữ. */
export function normalizeCoreToolArgs(toolName: string, args: Json): Json {
  if (toolName !== "query_records" || !Array.isArray(args.filters)) return args;
  const filters = args.filters.map((raw: unknown) => {
    if (!isObject(raw)) return raw;
    const { values, ...rest } = raw;
    const filter: Json = { ...rest };
    if (Array.isArray(values) && filter.value === undefined) filter.value = values;
    if (filter.op === "isnull" && typeof filter.value === "string") {
      const text = filter.value.trim().toLowerCase();
      if (text === "true" || text === "false") filter.value = text === "true";
    }
    return filter;
  });
  return { ...args, filters };
}

/** Lỗi nếu `entity` ngoài danh sách cho phép; null = được. */
export function entityGuardError(args: Json, allowed: readonly string[] | undefined): string | null {
  if (!allowed) return null;
  if (typeof args.entity !== "string" || !allowed.includes(args.entity)) {
    return `Hỏi trong nhóm chỉ đọc được thực thể: ${allowed.join(", ")}.`;
  }
  return null;
}
