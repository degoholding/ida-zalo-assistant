import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { DataAccessContext } from "../data-access/data-access-context.js";
import { readableEntities } from "../data-access/entity-registry.js";
import type { AnyToolDefinition, ToolSurface } from "../data-access/tool-definition.js";
import { wrapTool, type ToolWrapperOptions } from "./mcp-tool-wrapper.js";

// Đăng ký danh sách công cụ lõi vào một McpServer — dùng chung cho cổng /mcp (mỗi request) và máy chủ trong tiến trình của trợ lý
// (mỗi lượt). Đổi zod → JSON Schema tốn kém khi dựng ~40 công cụ mỗi lượt, nên sơ đồ quảng cáo được cache.

/**
 * Sơ đồ đầu vào chỉ để QUẢNG CÁO (`tools/list`): SDK luôn chuyển nguyên đầu vào cho hàm xử lý, `runTool` mới là nơi kiểm bằng zod.
 * Nếu để SDK tự kiểm thì đầu vào sai bị SDK trả lỗi trước — không có dòng mcp_call_log, không tính nhịp.
 */
export function advertiseOnly(schema: z.ZodType) {
  return fromJsonSchema(z.toJSONSchema(schema, { io: "input" }) as Parameters<typeof fromJsonSchema>[0],
    // `as never`: kiểu JsonSchemaValidator<T> của SDK là generic theo T mà ta cố ý không dùng (không kiểm, chỉ chuyển tiếp)
    { getValidator: (() => (input: unknown) => ({ valid: true, data: input, errorMessage: undefined })) as never });
}

/**
 * Dấu vân tay của mọi thứ `tool.input(ctx)` được phép phụ thuộc: vai trò, hai cờ (Mật, nhật ký), quyền ghi, và danh sách thực thể đọc
 * được (enum thực thể). Công cụ mới mà sơ đồ vào phụ thuộc thứ khác thì PHẢI thêm vào đây — nếu không cache sẽ trả sơ đồ của người khác.
 */
export function schemaFingerprint(ctx: DataAccessContext): string {
  const { principal } = ctx;
  return [principal.role, principal.canViewConfidential === true, principal.canViewAudit === true, ctx.allowWrite, readableEntities(ctx).map((def) => def.name).join(",")].join("|");
}

type AdvertisedSchema = ReturnType<typeof advertiseOnly>;
const SCHEMA_CACHE = new Map<string, AdvertisedSchema>();
/** Số tổ hợp (công cụ × vai × cờ × mặt) rất nhỏ; trần chỉ để chắc không phình nếu sau này có khóa lạ. */
const SCHEMA_CACHE_MAX = 2000;

export function advertisedInputSchema(tool: AnyToolDefinition, ctx: DataAccessContext, surface: ToolSurface): AdvertisedSchema {
  const key = `${surface}\u0000${tool.name}\u0000${schemaFingerprint(ctx)}`;
  const cached = SCHEMA_CACHE.get(key);
  if (cached) return cached;
  const schema = advertiseOnly(tool.input(ctx));
  if (SCHEMA_CACHE.size >= SCHEMA_CACHE_MAX) SCHEMA_CACHE.clear();
  SCHEMA_CACHE.set(key, schema);
  return schema;
}

/** Xóa cache (test). */
export function clearAdvertisedSchemaCache(): void {
  SCHEMA_CACHE.clear();
}

export function advertisedSchemaCacheSize(): number {
  return SCHEMA_CACHE.size;
}

/** Đăng ký từng công cụ: sơ đồ quảng cáo (cache) + hàm xử lý bọc bởi `wrapTool`. */
export function registerTools(server: McpServer, tools: readonly AnyToolDefinition[], ctx: DataAccessContext, surface: ToolSurface, wrapOptions: ToolWrapperOptions): void {
  for (const tool of tools) {
    server.registerTool(tool.name, {
      title: tool.title, description: tool.description, inputSchema: advertisedInputSchema(tool, ctx, surface), outputSchema: tool.output,
      annotations: tool.annotations,
    }, wrapTool(tool, ctx, wrapOptions));
  }
}
