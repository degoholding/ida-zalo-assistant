import { McpServer } from "@modelcontextprotocol/server";
import { McpCallSource } from "../constants.js";
import type { FamilyCatalog } from "../data-access/catalog/family-catalog.js";
import { FAMILY_CATALOGS } from "../data-access/catalog/family-catalogs.js";
import type { DataAccessContext } from "../data-access/data-access-context.js";
import { ALL_TOOLS, toolsFor } from "../data-access/read-tool-catalog.js";
import type { AnyToolDefinition, AssistantFamily } from "../data-access/tool-definition.js";
import type { ConcurrencyGate } from "./mcp-concurrency-gate.js";
import type { McpCallLogEntry } from "./mcp-call-log.js";
import { registerTools } from "./mcp-tool-registration.js";

// Máy chủ MCP TRONG TIẾN TRÌNH cho một lượt trợ lý (O1): dựng MỖI LƯỢT, ctx của người hỏi gắn sẵn vào closure (tương đương Bearer đã xác
// thực ở cổng ngoài — không token, không `authInfo`). Hai mặt tách bằng CẤU TRÚC: máy chủ của mô hình không đăng ký công cụ lệnh.

export type AssistantSurface = "assistant_model" | "assistant_command";

const SERVER_NAME = "bot-tro-ly-assistant";
const SERVER_VERSION = "1.0.0";
const MAX_TOOL_INPUT_ELEMENTS = 2000;

export interface AssistantMcpServerDeps {
  /** Cổng đồng thời RIÊNG của trợ lý (không chiếm chỗ của MCP ngoài; pool MySQL dùng chung nên vẫn có trần). */
  gate: ConcurrencyGate;
  logCall: (entry: McpCallLogEntry) => Promise<void>;
  /** Họ đang bật (đã phân giải từ cài đặt `assistant_mcp_families`). */
  families: ReadonlySet<AssistantFamily>;
  /** Test tiêm danh mục / họ riêng; mặc định danh mục thật. */
  catalog?: readonly AnyToolDefinition[];
  familyCatalogs?: readonly FamilyCatalog[];
}

/** ctx của máy chủ: cùng người hỏi, khác `source` theo mặt (mô hình = 2, lệnh gõ = 3) và không bao giờ có khóa MCP. */
export function assistantSurfaceContext(access: DataAccessContext, surface: AssistantSurface): DataAccessContext {
  return { ...access, keyId: null, source: surface === "assistant_command" ? McpCallSource.AssistantCommand : McpCallSource.Assistant };
}

/** Công cụ của mặt này thuộc họ đang bật (công cụ không khai họ không bao giờ lên mặt trợ lý) và người hỏi dùng được. */
export function assistantToolsFor(ctx: DataAccessContext, surface: AssistantSurface, deps: Pick<AssistantMcpServerDeps, "families" | "catalog">): AnyToolDefinition[] {
  return toolsFor(ctx, surface, deps.catalog ?? ALL_TOOLS).filter((tool) => tool.family !== undefined && deps.families.has(tool.family));
}

export function assistantFamilyInstructions(deps: Pick<AssistantMcpServerDeps, "families" | "familyCatalogs">): string {
  return (deps.familyCatalogs ?? FAMILY_CATALOGS)
    .filter((catalog) => deps.families.has(catalog.family) && catalog.instructions)
    .map((catalog) => catalog.instructions).join("\n\n");
}

export function buildAssistantMcpServer(access: DataAccessContext, surface: AssistantSurface, deps: AssistantMcpServerDeps): McpServer {
  const ctx = assistantSurfaceContext(access, surface);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION },
    { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS, instructions: assistantFamilyInstructions(deps) });
  registerTools(server, assistantToolsFor(ctx, surface, deps), ctx, surface, {
    source: ctx.source, actorSuffix: "Trợ lý", clientIp: null, limiter: null, gate: deps.gate, logCall: deps.logCall,
  });
  return server;
}
