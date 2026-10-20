import type { AssistantFamily } from "../../data-access/tool-definition.js";
import type { CoreToolSchemaOptions } from "../core-tool-arg-compat.js";
import type { FunctionDeclaration } from "../gemini-client.js";
import { toFunctionDeclarationsFromMcp } from "./mcp-declaration-adapter.js";
import type { AssistantMcpTurn } from "./assistant-mcp-turn.js";
import { LEGACY_FAMILY_PROMPTS } from "./legacy-family-prompts.js";

// Lắp khai báo hàm + lời nhắc của lượt khi có họ chạy qua MCP: công cụ cũ của họ đã bật bị gỡ, thay bằng khai báo dựng từ `tools/list`;
// lời lẽ cũ của họ thay bằng lời nhắc (`instructions`) của CHÍNH các họ có ít nhất một công cụ THẬT SỰ nằm trong khai báo cuối của lượt này
// (H1: không nhắc về công cụ người hỏi không có — vd nhóm không có gửi / số liệu / cảnh báo). Phiên mở LỖI (null) thì khai báo + lời nhắc cũ giữ
// nguyên, lượt chạy đường cũ trọn vẹn (T2). Phiên đã mở mà công cụ của họ bị ẨN cho người hỏi này (M2): khai báo cũ cùng tên cũng bị gỡ và
// `mcpExecutorFor` trả «không có công cụ» — không rơi về executor cũ.

export interface McpTurnTools {
  declarations: FunctionDeclaration[];
  /** Mọi công cụ máy chủ liệt kê: bản cũ cùng tên bị gỡ (T3 giữ nguyên tên); khai báo mới hỏng sơ đồ thì công cụ bị bỏ hẳn, khớp đường gọi. */
  names: ReadonlySet<string>;
  /** Họ có ít nhất một công cụ trên danh sách của máy chủ. */
  families: ReadonlySet<AssistantFamily>;
  /** `instructions` của máy chủ (đã lọc theo công cụ đăng ký). */
  instructions: string;
  /** Mọi tên thuộc họ đang bật (kể cả tên bị ẩn / tên cũ chỉ đường cũ): khai báo cũ cùng tên bị gỡ. */
  owned: ReadonlySet<string>;
  /** Họ đang bật (kể cả họ không có công cụ nào trên danh sách): lời nhắc cũ của chúng bị gỡ. */
  enabledFamilies: ReadonlySet<AssistantFamily>;
  familyOf: (name: string) => AssistantFamily | undefined;
  /** Lời nhắc của các họ (xem `AssistantMcpTurn.instructionsFor`). */
  instructionsFor: (families: ReadonlySet<AssistantFamily>, declared: ReadonlySet<string>) => string;
}

/** Mở phiên mô hình (lười — chỉ gọi khi có họ bật) và dựng khai báo. null = phiên mở lỗi: không có gì để thay, cả lượt chạy đường cũ. */
export async function loadMcpTurnTools(turn: AssistantMcpTurn | undefined, options: CoreToolSchemaOptions): Promise<McpTurnTools | null> {
  if (!turn || turn.families.size === 0) return null;
  const session = await turn.model();
  if (!session) return null;
  const declarations = toFunctionDeclarationsFromMcp(session.tools, options);
  const families = new Set<AssistantFamily>();
  for (const tool of session.tools) {
    const family = turn.familyOfTool(tool.name);
    if (family) families.add(family);
  }
  return {
    declarations, names: session.toolNames, families, instructions: session.instructions,
    owned: turn.ownedToolNames(), enabledFamilies: turn.families,
    familyOf: (name) => turn.familyOfTool(name), instructionsFor: (picked, declared) => turn.instructionsFor(picked, declared),
  };
}

export function applyMcpTurnTools(base: FunctionDeclaration[], mcp: McpTurnTools | null): FunctionDeclaration[] {
  if (!mcp) return base;
  // Thay TẠI CHỖ (giữ thứ tự khai báo cũ — mô hình quen thứ tự); khai báo MCP chưa có bản cũ thì nối cuối
  const fromMcp = new Map(mcp.declarations.map((declaration) => [declaration.name, declaration]));
  const merged = base.flatMap((declaration) => (mcp.names.has(declaration.name) || mcp.owned.has(declaration.name) ? (fromMcp.has(declaration.name) ? [fromMcp.get(declaration.name)!] : []) : [declaration]));
  const present = new Set(merged.map((declaration) => declaration.name));
  return [...merged, ...mcp.declarations.filter((declaration) => !present.has(declaration.name))];
}

/**
 * `declared` = tên công cụ trong khai báo CUỐI của lượt (sau mọi bộ lọc: nhóm, quyền…). Lời nhắc cũ của MỌI họ đang bật bị gỡ (công cụ cũ của chúng
 * đã gỡ / thay); lời nhắc mới chỉ của họ có ≥ 1 công cụ MCP nằm trong `declared`.
 */
export function applyMcpTurnPrompt(system: string, mcp: McpTurnTools | null, declared: ReadonlySet<string>): string {
  if (!mcp) return system;
  let result = system;
  for (const family of mcp.enabledFamilies) for (const legacy of LEGACY_FAMILY_PROMPTS[family]) result = result.split(legacy).join("");
  const active = new Set<AssistantFamily>();
  for (const name of mcp.names) {
    const family = mcp.familyOf(name);
    if (family && declared.has(name)) active.add(family);
  }
  const instructions = mcp.instructionsFor(active, declared);
  return instructions ? `${result}\n\n${instructions}` : result;
}
