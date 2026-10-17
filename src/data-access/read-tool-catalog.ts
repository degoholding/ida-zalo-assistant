import type { DataAccessContext } from "./data-access-context.js";
import { describeEntitiesTool } from "./operations/describe-entities-operation.js";
import { fileTextTool } from "./operations/file-text-operation.js";
import { metricsSummaryTool } from "./operations/metrics-summary-operation.js";
import { queryRecordsTool } from "./operations/query-records-operation.js";
import { searchMessagesTool } from "./operations/search-messages-operation.js";
import { threadMessagesTool } from "./operations/thread-messages-operation.js";
import { whoamiTool } from "./operations/whoami-operation.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "./tool-definition.js";

// Danh mục công cụ ĐỌC (phase 2). Cổng MCP (phase 3) và bộ chuyển trợ lý (phase 7) đều lấy từ đây; công cụ ghi (phase 8) thêm sau.

export const READ_TOOLS: readonly AnyToolDefinition[] = [
  whoamiTool, describeEntitiesTool, queryRecordsTool, searchMessagesTool, threadMessagesTool, fileTextTool, metricsSummaryTool,
].map((tool) => eraseTool(tool as ToolDefinition<never, never>));

/** Công cụ người này dùng được — danh sách trả cho `tools/list` / khai báo hàm của trợ lý. */
export function toolsFor(ctx: DataAccessContext): AnyToolDefinition[] {
  return READ_TOOLS.filter((tool) => tool.available(ctx));
}

export function findTool(name: string): AnyToolDefinition | undefined {
  return READ_TOOLS.find((tool) => tool.name === name);
}
