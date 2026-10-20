import { patchCoreToolSchema, type CoreToolSchemaOptions } from "../core-tool-arg-compat.js";
import type { FunctionDeclaration } from "../gemini-client.js";
import { sanitizeForGemini } from "../gemini-schema-sanitizer.js";
import { createLogger, describeError } from "../../logger.js";

// `tools/list` của máy chủ MCP trong tiến trình → khai báo hàm cho Gemini / OpenAI (cùng `FunctionDeclaration`). Sơ đồ MCP là JSON Schema
// 2020-12 (zod `io: "input"`, null là `anyOf [{…}, {type:"null"}]`), còn bộ chuyển cũ dùng target openapi-3.0 (`nullable: true`) — nên
// gập về dạng openapi-3.0 trước, rồi đi đúng đường cũ: `patchCoreToolSchema` → `sanitizeForGemini`. Nhờ vậy khai báo của công cụ đã có
// KHÔNG đổi (T3), có test so từng khai báo.

const log = createLogger("assistant");

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isNullBranch = (branch: unknown): boolean => isObject(branch) && branch.type === "null";

/** Gập một nút (đệ quy) từ 2020-12 về openapi-3.0: `anyOf`/`oneOf` có nhánh null → `nullable`, `type: [x,"null"]` → `type: x` + `nullable`. */
export function foldJsonSchema2020(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(foldJsonSchema2020);
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    // `$schema` vô nghĩa với mô hình (`additionalProperties` để bộ làm sạch gỡ — nó chỉ giữ khóa trong danh sách trắng).
    // Tên thuộc tính đi riêng nhánh `properties` để một thuộc tính tên «enum» / «required» không bị hiểu nhầm là từ khóa.
    if (key === "$schema") continue;
    if (key === "properties" && isObject(value)) out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, foldJsonSchema2020(child)]));
    else out[key] = key === "enum" || key === "required" || key === "const" ? value : foldJsonSchema2020(value);
  }
  const unionKey = Array.isArray(out.anyOf) ? "anyOf" : Array.isArray(out.oneOf) ? "oneOf" : null;
  if (unionKey) {
    const branches = out[unionKey] as unknown[];
    if (branches.some(isNullBranch)) {
      const rest = branches.filter((branch) => !isNullBranch(branch));
      delete out[unionKey];
      out.nullable = true;
      if (rest.length === 1 && isObject(rest[0])) return { ...rest[0], ...out };
      if (rest.length > 1) out[unionKey] = rest;
    }
  }
  if (Array.isArray(out.type) && out.type.includes("null")) {
    const types = out.type.filter((type) => type !== "null");
    out.nullable = true;
    out.type = types.length === 1 ? types[0] : types;
  }
  return out;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
}

const DECLARATION_CACHE = new Map<string, FunctionDeclaration | null>();
const DECLARATION_CACHE_MAX = 2000;

/** Một công cụ MCP → khai báo hàm; null = ẩn (hết thực thể trong ngữ cảnh này, hoặc sơ đồ không qua bộ làm sạch — chỉ log, lượt vẫn chạy). */
export function toFunctionDeclarationFromMcp(tool: McpToolInfo, options: CoreToolSchemaOptions = {}): FunctionDeclaration | null {
  const key = JSON.stringify([tool.name, tool.description, tool.inputSchema, options]);
  const cached = DECLARATION_CACHE.get(key);
  if (cached !== undefined) return cached;
  let declaration: FunctionDeclaration | null = null;
  try {
    const patched = patchCoreToolSchema(tool.name, foldJsonSchema2020(tool.inputSchema) as Json, options);
    if (patched) declaration = { name: tool.name, description: tool.description ?? "", parameters: sanitizeForGemini(patched) };
  } catch (error) {
    log.error(`bỏ công cụ MCP ${tool.name} khỏi khai báo của trợ lý: ${describeError(error)}`);
  }
  if (DECLARATION_CACHE.size >= DECLARATION_CACHE_MAX) DECLARATION_CACHE.clear();
  DECLARATION_CACHE.set(key, declaration);
  return declaration;
}

export function toFunctionDeclarationsFromMcp(tools: readonly McpToolInfo[], options: CoreToolSchemaOptions = {}): FunctionDeclaration[] {
  return tools.flatMap((tool) => {
    const declaration = toFunctionDeclarationFromMcp(tool, options);
    return declaration ? [declaration] : [];
  });
}
