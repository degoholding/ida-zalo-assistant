// Làm sạch JSON Schema (sinh từ zod) thành tập con mà Gemini `FunctionDeclaration` nhận — cũng là tập con an toàn cho OpenAI
// (không dùng `strict`). Gemini trả 400 cho cả lượt nếu sơ đồ có khóa lạ, nên: chỉ GIỮ khóa trong danh sách trắng, mọi ràng buộc
// còn lại (độ dài, min / max, additionalProperties…) bỏ đi — zod ở lõi vẫn kiểm đầy đủ trước khi chạy công cụ.
// Hàm thuần, không đụng DB / mạng.

type Json = Record<string, unknown>;

/** Sơ đồ không đưa được cho Gemini (tham chiếu, allOf…) — bộ chuyển bỏ công cụ đó thay vì làm hỏng cả lượt. */
export class SchemaSanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaSanitizeError";
  }
}

const KEPT_KEYS = ["type", "description", "enum", "items", "properties", "required", "nullable", "format"] as const;
const KNOWN_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** `type` có thể là mảng (["string","null"]) hoặc `null` — Gemini chỉ nhận một kiểu + `nullable`. */
function pickType(raw: unknown): { type?: string; nullable: boolean } {
  const list = (Array.isArray(raw) ? raw : [raw]).filter((item): item is string => typeof item === "string");
  const nullable = list.includes("null");
  const type = list.find((item) => item !== "null");
  if (type !== undefined && !KNOWN_TYPES.has(type)) throw new SchemaSanitizeError(`kiểu «${type}» không được hỗ trợ`);
  return { type, nullable };
}

/**
 * anyOf / oneOf không hỗ trợ đầy đủ ở Gemini → gộp một nhánh: bỏ nhánh null (thành `nullable`); các nhánh cùng kiểu thì gộp enum;
 * khác kiểu thì chọn nhánh `string` (giá trị luôn chuyển được thành chữ, lõi tự ép kiểu theo trường) — không có thì nhánh đầu.
 * Công cụ cần nhận cả mảng (vd `filters[].value`) nên làm phẳng ở `core-tool-arg-compat.ts` TRƯỚC khi tới đây.
 */
function flattenUnion(branches: unknown[]): Json {
  const clean = branches.map((branch) => sanitizeNode(branch));
  const nullable = clean.some((branch) => branch.type === undefined && branch.nullable === true);
  const typed = clean.filter((branch) => branch.type !== undefined);
  if (!typed.length) throw new SchemaSanitizeError("anyOf không có nhánh có kiểu");
  const chosen = typed.every((branch) => branch.type === typed[0].type)
    ? { ...typed[0], ...(typed.every((branch) => Array.isArray(branch.enum)) ? { enum: [...new Set(typed.flatMap((branch) => branch.enum as string[]))] } : {}) }
    : { ...(typed.find((branch) => branch.type === "string") ?? typed[0]) };
  return nullable ? { ...chosen, nullable: true } : chosen;
}

function sanitizeNode(node: unknown): Json {
  if (!isObject(node)) throw new SchemaSanitizeError("nút sơ đồ không phải object");
  if ("$ref" in node || "allOf" in node || "not" in node) throw new SchemaSanitizeError("sơ đồ có $ref / allOf / not");
  const union = node.anyOf ?? node.oneOf;
  if (Array.isArray(union)) {
    const merged = flattenUnion(union);
    return typeof node.description === "string" ? { ...merged, description: node.description } : merged;
  }
  const out: Json = {};
  const { type, nullable } = pickType(node.type);
  if (type) out.type = type;
  if (nullable || node.nullable === true) out.nullable = true;
  if ("const" in node && node.enum === undefined) {
    out.enum = [String(node.const)];
    out.type ??= typeof node.const === "number" ? "number" : typeof node.const === "boolean" ? "boolean" : "string";
  }
  for (const key of KEPT_KEYS) {
    const value = node[key];
    if (value === undefined || key === "type" || key === "nullable") continue;
    if (key === "enum") out.enum = Array.isArray(value) ? value.map(String) : value;
    else if (key === "items") out.items = sanitizeNode(value);
    else if (key === "properties") {
      if (!isObject(value)) throw new SchemaSanitizeError("properties không phải object");
      out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, sanitizeNode(child)]));
    } else if (key === "required") {
      const props = isObject(node.properties) ? node.properties : {};
      const names = Array.isArray(value) ? value.filter((name): name is string => typeof name === "string" && name in props) : [];
      if (names.length) out.required = names;
    } else out[key] = value;
  }
  if (out.type === "array" && out.items === undefined) throw new SchemaSanitizeError("mảng thiếu items");
  return out;
}

/**
 * Sơ đồ gốc phải là object có khối `properties`. Công cụ KHÔNG tham số (vd `list_tickets`) có `properties` rỗng — đúng dạng khai báo cũ
 * `{ type: "object", properties: {} }` mà Gemini / OpenAI vẫn nhận; thiếu hẳn `properties` thì vẫn bị từ chối. Lỗi → `SchemaSanitizeError`.
 */
export function sanitizeForGemini(schema: unknown): Json {
  const result = sanitizeNode(schema);
  if (result.type !== "object" || !isObject(result.properties)) {
    throw new SchemaSanitizeError("sơ đồ gốc phải là object có khối properties");
  }
  return result;
}
