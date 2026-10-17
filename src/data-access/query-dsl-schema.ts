import { z } from "zod/v4";

// Sơ đồ zod của DSL `query_records` (đầu vào công cụ). Cổng MCP và bộ chuyển trợ lý cùng dùng — mô tả tiếng Việt ở `.describe()`
// là thứ mô hình đọc. Zod chỉ kiểm HÌNH DẠNG; kiểm theo thực thể (trường nào, phép so nào, kiểu giá trị) do `query-compiler`.

export const OPERATOR_NAMES = ["eq", "ne", "contains", "not_contains", "gt", "gte", "lt", "lte", "between", "in", "not_in", "isnull"] as const;
export const MAX_FILTERS = 20;
export const MAX_FIELDS = 40;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_IN_VALUES = 200;

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const filterSchema = z.object({
  field: z.string().min(1).max(60).describe("Tên trường lọc — xem describe_entities (filters)."),
  op: z.enum(OPERATOR_NAMES).describe("Phép so; mỗi kiểu trường chỉ nhận một số phép (xem operators_by_type)."),
  value: z.union([scalar, z.array(z.union([z.string(), z.number()])).max(MAX_IN_VALUES)]).optional()
    .describe("Giá trị: chữ / số / true-false; mảng cho in, not_in, between ([từ, đến]). Ngày: 'YYYY-MM-DD' (cả ngày giờ VN) hoặc ISO 8601; không ghi múi giờ = giờ VN. isnull: true/false."),
});

const groupBySchema = z.object({
  field: z.string().min(1).max(60).describe("Khóa cột gộp nhóm (xem aggregate.group_by của describe_entities)."),
  bucket: z.enum(["day", "month"]).optional().describe("Chỉ cho cột ngày giờ: gộp theo ngày / tháng (giờ VN)."),
});

const aggregateSchema = z.object({
  fn: z.enum(["count", "sum"]).describe("count = đếm dòng; sum = cộng trường `field` (xem aggregate.sum)."),
  field: z.string().min(1).max(60).optional().describe("Trường cộng khi fn = sum."),
  group_by: z.array(groupBySchema).max(2).optional().describe("Tối đa 2 cột gộp nhóm; bỏ trống = một dòng tổng."),
});

export const queryRequestSchema = z.object({
  entity: z.string().min(1).max(40),
  filters: z.array(filterSchema).max(MAX_FILTERS).optional().describe("Các điều kiện, nối bằng VÀ."),
  search: z.string().max(200).optional().describe("Tìm nhanh theo các cột tìm của thực thể (không phải thực thể nào cũng có)."),
  fields: z.array(z.string().min(1).max(60)).max(MAX_FIELDS).optional().describe("Cột cần lấy; bỏ trống = cột mặc định. Không dùng cùng aggregate."),
  sort: z.object({ field: z.string().min(1).max(60), dir: z.enum(["asc", "desc"]).optional() }).optional()
    .describe("Sắp xếp theo một khóa trong sorts; bỏ trống = mặc định của thực thể."),
  page: z.object({
    size: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`Số dòng mỗi trang (mặc định ${DEFAULT_PAGE_SIZE}, tối đa ${MAX_PAGE_SIZE}).`),
    number: z.number().int().min(1).optional().describe("Số trang, từ 1."),
  }).optional(),
  include_total: z.boolean().optional().describe("true = đếm tổng số dòng khớp (chậm hơn; đếm tối đa 10 000)."),
  aggregate: aggregateSchema.optional().describe("Gộp nhóm đếm / cộng thay cho liệt kê dòng."),
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type QueryFilter = z.infer<typeof filterSchema>;
export type QueryAggregate = z.infer<typeof aggregateSchema>;

/** Đầu vào của công cụ `query_records` với `entity` là danh sách thực thể ĐÚNG người này đọc được. */
export function buildQueryInputSchema(entityNames: [string, ...string[]]) {
  return queryRequestSchema.extend({ entity: z.enum(entityNames).describe("Thực thể cần truy vấn (xem describe_entities).") });
}
