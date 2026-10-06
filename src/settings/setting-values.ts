import { decryptJson, encryptJson } from "../crypto/session-cipher.js";
import type { SettingDefinition, SettingGroup, SettingType, SettingValue } from "./setting-registry.js";

// Phần thuần của kho cài đặt: tính nguồn giá trị (web / .env / mặc định), gợi ý cho ô bí mật, so «thật sự
// đổi», mã hóa / giải mã giá trị lưu DB, dựng bản xem cho API. Tách riêng để kiểm không cần DB.

export type SettingSource = "web" | "env" | "default";

/** Một khóa như API trả cho giao diện. Khóa bí mật: `value` và `env_value` luôn null. */
export interface SettingView {
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  type: SettingType;
  secret: boolean;
  value: SettingValue;
  is_set: boolean;
  hint: string;
  source: SettingSource;
  env_value: SettingValue;
  default_value: SettingValue;
  min: number | null;
  max: number | null;
  max_length: number | null;
  allow_empty: boolean;
  /** Danh sách chọn sẵn (ô tick theo nhóm) — null khi nhập tự do. */
  choices: { value: string; label: string; group: string }[] | null;
}

/** Trạng thái của một khóa trong kho: giá trị web (nếu có dòng), giải mã hỏng, giá trị .env. */
export interface SettingState {
  hasRow: boolean;
  webValue: SettingValue;
  broken: boolean;
  envValue: SettingValue;
}

export const BROKEN_SECRET_HINT = "không giải mã được — nhập lại";

export function resolveSource(state: SettingState): SettingSource {
  if (state.hasRow) return "web";
  return state.envValue === null ? "default" : "env";
}

/** Giá trị đang hiệu lực: web > .env > mặc định. Khóa bí mật giải mã hỏng coi như chưa đặt trên web. */
export function effectiveValue(definition: SettingDefinition, state: SettingState): SettingValue {
  if (state.hasRow && !state.broken) return state.webValue;
  return state.envValue ?? definition.defaultValue;
}

export function isValueSet(value: SettingValue): boolean {
  if (value === null || value === "") return false;
  return !(Array.isArray(value) && value.length === 0);
}

export function sameSettingValue(left: SettingValue, right: SettingValue): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Ô bí mật chỉ hiện gợi ý: 4 ký tự cuối của khóa, hoặc email service account (không bí mật). */
export function buildHint(definition: SettingDefinition, value: SettingValue, broken: boolean): string {
  if (broken) return BROKEN_SECRET_HINT;
  if (!definition.secret || !isValueSet(value)) return "";
  if (typeof value === "string") return `…${value.slice(-4)}`;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // Khóa service account: client_email; OAuth client: client_id (đều không bí mật); tài khoản: email
    const record = value as Record<string, unknown>;
    const shown = record.client_email ?? record.email ?? record.client_id;
    return typeof shown === "string" ? shown : "";
  }
  return "";
}

/** Giá trị → cột `value`: JSON thường, hoặc chuỗi mã hóa "v1.…" với khóa bí mật. */
export function encodeStoredValue(definition: SettingDefinition, value: SettingValue, encryptionKey: string): string {
  return definition.secret ? encryptJson(value, encryptionKey) : JSON.stringify(value);
}

/** Cột `value` → giá trị. Giải mã / đọc hỏng (vd đổi SESSION_ENCRYPTION_KEY) trả `ok: false`, không ném lỗi. */
export function decodeStoredValue(
  stored: string,
  isSecret: boolean,
  encryptionKey: string,
): { ok: true; value: SettingValue } | { ok: false } {
  try {
    return { ok: true, value: isSecret ? decryptJson<SettingValue>(stored, encryptionKey) : (JSON.parse(stored) as SettingValue) };
  } catch {
    return { ok: false };
  }
}

export function buildSettingView(definition: SettingDefinition, state: SettingState): SettingView {
  const value = effectiveValue(definition, state);
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    help: definition.help,
    type: definition.type,
    secret: definition.secret,
    value: definition.secret ? null : value,
    is_set: isValueSet(value),
    hint: buildHint(definition, value, state.hasRow && state.broken),
    source: resolveSource(state),
    env_value: definition.secret ? null : state.envValue,
    default_value: definition.secret ? null : definition.defaultValue,
    min: definition.min ?? null,
    max: definition.max ?? definition.maxItems ?? null,
    max_length: definition.maxLength ?? null,
    allow_empty: definition.allowEmpty ?? false,
    choices: definition.choices ?? null,
  };
}
