import type { ToolContext } from "../tools.js";
import { normalizeCoreToolArgs } from "../core-tool-arg-compat.js";
import { mapCallToolResult } from "./mcp-call-result-mapper.js";

// Bộ định tuyến lời gọi công cụ của mô hình: họ của công cụ bật VÀ phiên mô hình liệt kê công cụ → `tools/call` thật vào máy chủ MCP của
// lượt; không thì executor cũ. Luật chống bế tắc: công cụ lõi KHÔNG BAO GIỜ gọi lại MCP — chỉ mã PHÍA TRỢ LÝ (file này) gọi, nên mỗi
// lời gọi giữ đúng một chỗ ở cổng đồng thời, không lồng nhau.

export type McpRoutedExecutor = (context: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

/** Executor đi qua MCP cho `name`, hoặc undefined nếu lượt này không chuyển công cụ đó sang MCP. */
export function mcpExecutorFor(context: ToolContext, name: string): McpRoutedExecutor | undefined {
  const turn = context.mcp;
  if (!turn || !turn.modelHasTool(name)) return undefined;
  return async (ctx, args) => {
    if (ctx.fixedReply !== undefined && turn.blocksAfterFixedReply(name)) return { error: "Lượt này đã có câu trả lời dựng sẵn — không tạo thêm đề xuất." };
    // `values` → `value`, `isnull` chữ → boolean: phần TRÌNH BÀY riêng của khai báo cho mô hình (xem core-tool-arg-compat) — làm phía client, lõi giữ sơ đồ gốc
    const normalized = normalizeCoreToolArgs(name, args);
    return mapCallToolResult(ctx, await turn.callTool("assistant_model", name, normalized), turn.errorShapeOf(name));
  };
}
