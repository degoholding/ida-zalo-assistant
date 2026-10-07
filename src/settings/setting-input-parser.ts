import { ApiError } from "../web/api/api-http.js";
import type { SettingDefinition, SettingValue } from "./setting-registry.js";

// Ép kiểu + kiểm ràng buộc giá trị gửi lên từ màn Cài đặt, và đọc giá trị .env đúng cách `config.ts` đọc
// (để màn hiện «từ .env: …» khớp với giá trị thật đang chạy). Hàm thuần.

const TRUE_WORDS = ["1", "true", "yes", "on"];

function fail(definition: SettingDefinition, reason: string): ApiError {
  return new ApiError(422, "validation_error", `${definition.label}: ${reason}`);
}

function parseInteger(definition: SettingDefinition, raw: unknown): number {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^-?\d+$/.test(text)) throw fail(definition, "phải là số nguyên");
  const value = Number(text);
  const { min, max } = definition;
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw fail(definition, `phải từ ${min?.toLocaleString("vi-VN")} đến ${max?.toLocaleString("vi-VN")}`);
  }
  return value;
}

function checkText(definition: SettingDefinition, text: string): void {
  if (definition.maxLength !== undefined && text.length > definition.maxLength) {
    throw fail(definition, `dài quá ${definition.maxLength} ký tự`);
  }
  if (definition.pattern && !definition.pattern.test(text)) {
    throw fail(definition, `«${text.slice(0, 40)}» không hợp lệ — ${definition.patternHint ?? "sai định dạng"}`);
  }
}

function parseString(definition: SettingDefinition, raw: unknown): string {
  if (typeof raw !== "string") throw fail(definition, "phải là chuỗi chữ");
  const text = raw.trim();
  if (!text) {
    if (definition.allowEmpty) return "";
    throw fail(definition, "không được để trống");
  }
  checkText(definition, text);
  // Ô chọn một giá trị (vd «Nhà cung cấp AI»): chỉ nhận đúng giá trị trong danh sách
  if (definition.choices && !definition.choices.some((choice) => choice.value === text)) {
    throw fail(definition, `«${text.slice(0, 40)}» không có trong danh sách chọn`);
  }
  return text;
}

function parseList(definition: SettingDefinition, raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
  if (!parts || parts.some((part) => typeof part !== "string")) throw fail(definition, "phải là danh sách chữ cách nhau dấu phẩy");
  const items = [...new Set((parts as string[]).map((part) => part.trim()).filter(Boolean))];
  if (!items.length && !definition.allowEmpty) throw fail(definition, "không được để trống");
  if (definition.maxItems !== undefined && items.length > definition.maxItems) throw fail(definition, `tối đa ${definition.maxItems} mục`);
  for (const item of items) checkText(definition, item);
  return items;
}

function parseJson(definition: SettingDefinition, raw: unknown): SettingValue {
  if (typeof raw === "string") {
    if (!raw.trim()) throw fail(definition, "không được để trống");
    return raw;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  throw fail(definition, "phải là nội dung JSON");
}

/** Giá trị từ PATCH → giá trị đã kiểm; sai thì 422 «<nhãn>: <lý do>». */
export function parseSettingInput(definition: SettingDefinition, raw: unknown): SettingValue {
  let value: SettingValue;
  switch (definition.type) {
    case "int": value = parseInteger(definition, raw); break;
    case "bool":
      if (typeof raw !== "boolean") throw fail(definition, "chỉ nhận bật / tắt (true / false)");
      value = raw;
      break;
    case "string": value = parseString(definition, raw); break;
    case "list": value = parseList(definition, raw); break;
    case "json": value = parseJson(definition, raw); break;
  }
  if (!definition.normalize) return value;
  try {
    return definition.normalize(value);
  } catch (error) {
    if (error instanceof ApiError) throw fail(definition, error.message);
    throw error;
  }
}

/** Giá trị .env của một khóa, đọc như `config.ts`; không có biến / để trống / sai kiểu = null. */
export function readEnvValue(definition: SettingDefinition, env: NodeJS.ProcessEnv = process.env): SettingValue {
  if (!definition.envName) return null;
  const raw = env[definition.envName];
  if (raw === undefined || raw.trim() === "") return null;
  switch (definition.type) {
    case "int": {
      const value = Number(raw);
      return Number.isInteger(value) ? value : null;
    }
    case "bool": return TRUE_WORDS.includes(raw.toLowerCase());
    case "list": return raw.split(",").map((part) => part.trim()).filter(Boolean);
    case "json": return null;
    case "string": return definition.secret ? raw.trim() : raw;
  }
}
