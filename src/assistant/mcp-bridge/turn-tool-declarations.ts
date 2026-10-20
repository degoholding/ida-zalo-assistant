import type { AssistantFamily } from "../../data-access/tool-definition.js";
import type { CoreToolSchemaOptions } from "../core-tool-arg-compat.js";
import type { FunctionDeclaration } from "../gemini-client.js";
import { toFunctionDeclarationsFromMcp } from "./mcp-declaration-adapter.js";
import type { AssistantMcpTurn } from "./assistant-mcp-turn.js";
import { LEGACY_FAMILY_PROMPTS } from "./legacy-family-prompts.js";

// Lắp khai báo hàm + lời nhắc của lượt khi có họ chạy qua MCP: công cụ cũ của họ đã bật bị gỡ, thay bằng khai báo dựng từ `tools/list`;
// lời nhắc cũ của họ thay bằng `instructions` của máy chủ. Chỉ thay những gì máy chủ THẬT SỰ cung cấp — họ bật mà chưa có công cụ
// (hoặc phiên mở lỗi) thì khai báo + lời nhắc cũ giữ nguyên, nên không bao giờ mất công cụ vì bật nhầm.

export interface McpTurnTools {
  declarations: FunctionDeclaration[];
  /** Mọi công cụ máy chủ liệt kê: bản cũ cùng tên bị gỡ (T3 giữ nguyên tên); khai báo mới hỏng sơ đồ thì công cụ bị bỏ hẳn, khớp đường gọi. */
  names: ReadonlySet<string>;
  /** Họ có ít nhất một công cụ trên danh sách. */
  families: ReadonlySet<AssistantFamily>;
  instructions: string;
}

/** Mở phiên mô hình (lười — chỉ gọi khi có họ bật) và dựng khai báo. null = không có gì để thay (phiên hỏng / không công cụ). */
export async function loadMcpTurnTools(turn: AssistantMcpTurn | undefined, options: CoreToolSchemaOptions): Promise<McpTurnTools | null> {
  if (!turn || turn.families.size === 0) return null;
  const session = await turn.model();
  if (!session || session.tools.length === 0) return null;
  const declarations = toFunctionDeclarationsFromMcp(session.tools, options);
  const families = new Set<AssistantFamily>();
  for (const tool of session.tools) {
    const family = turn.familyOfTool(tool.name);
    if (family) families.add(family);
  }
  return { declarations, names: session.toolNames, families, instructions: session.instructions };
}

export function applyMcpTurnTools(base: FunctionDeclaration[], mcp: McpTurnTools | null): FunctionDeclaration[] {
  if (!mcp) return base;
  // Thay TẠI CHỖ (giữ thứ tự khai báo cũ — mô hình quen thứ tự); khai báo MCP chưa có bản cũ thì nối cuối
  const fromMcp = new Map(mcp.declarations.map((declaration) => [declaration.name, declaration]));
  const merged = base.flatMap((declaration) => (mcp.names.has(declaration.name) ? (fromMcp.has(declaration.name) ? [fromMcp.get(declaration.name)!] : []) : [declaration]));
  const present = new Set(merged.map((declaration) => declaration.name));
  return [...merged, ...mcp.declarations.filter((declaration) => !present.has(declaration.name))];
}

export function applyMcpTurnPrompt(system: string, mcp: McpTurnTools | null): string {
  if (!mcp) return system;
  let result = system;
  for (const family of mcp.families) for (const legacy of LEGACY_FAMILY_PROMPTS[family]) result = result.split(legacy).join("");
  return mcp.instructions ? `${result}\n\n${mcp.instructions}` : result;
}
