import { FAMILY_TOOLS } from "./catalog/family-catalogs.js";
import type { DataAccessContext } from "./data-access-context.js";
import { describeEntitiesTool } from "./operations/describe-entities-operation.js";
import { fileTextTool } from "./operations/file-text-operation.js";
import { metricsSummaryTool } from "./operations/metrics-summary-operation.js";
import { queryRecordsTool } from "./operations/query-records-operation.js";
import { searchMessagesTool } from "./operations/search-messages-operation.js";
import { threadMessagesTool } from "./operations/thread-messages-operation.js";
import { whoamiTool } from "./operations/whoami-operation.js";
import { WRITE_TOOLS } from "./write/write-tool-catalog.js";
import { DEFAULT_TOOL_SURFACES, eraseTool, type AnyToolDefinition, type ToolDefinition, type ToolSurface } from "./tool-definition.js";

// Danh mục công cụ: ĐỌC (phase 2) + GHI nháp → xác nhận (phase 8, `write/`). Cổng MCP và bộ chuyển trợ lý đều lấy từ đây.

export const READ_TOOLS: readonly AnyToolDefinition[] = [
  whoamiTool, describeEntitiesTool, queryRecordsTool, searchMessagesTool, threadMessagesTool, fileTextTool, metricsSummaryTool,
].map((tool) => eraseTool(tool as ToolDefinition<never, never>));

/** Mọi công cụ (đọc + ghi + công cụ của các họ trợ lý); công cụ ghi tự ẩn khi `ctx.allowWrite` tắt. */
export const ALL_TOOLS: readonly AnyToolDefinition[] = [...READ_TOOLS, ...WRITE_TOOLS, ...FAMILY_TOOLS];

/**
 * Công cụ người này dùng được trên `surface` — danh sách trả cho `tools/list` / khai báo hàm của trợ lý. Mặc định `mcp_http`:
 * công cụ không khai `surfaces` chỉ ở cổng ngoài, nên danh sách của cổng ngoài không đổi khi thêm công cụ cho trợ lý.
 * `catalog` để test tiêm danh mục riêng.
 */
export function toolsFor(ctx: DataAccessContext, surface: ToolSurface = "mcp_http", catalog: readonly AnyToolDefinition[] = ALL_TOOLS): AnyToolDefinition[] {
  return catalog.filter((tool) => (tool.surfaces ?? DEFAULT_TOOL_SURFACES).includes(surface) && tool.available(ctx));
}

export function findTool(name: string): AnyToolDefinition | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}
