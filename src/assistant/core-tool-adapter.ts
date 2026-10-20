// mcp-guard: legacy(core) — bộ chuyển công cụ lõi (đường cũ khi họ `core` tắt); gỡ ở phase 13
import { z } from "zod/v4";
import { McpCallStatus } from "../constants.js";
import { READ_TOOLS } from "../data-access/read-tool-catalog.js";
import type { AnyToolDefinition } from "../data-access/tool-definition.js";
import { runTool as runCoreToolDefinition } from "../data-access/tool-runner.js";
import { createLogger, describeError } from "../logger.js";
import { logMcpCall } from "../mcp/mcp-call-log.js";
import { statusOf } from "../mcp/mcp-tool-result.js";
import type { AskerAccess } from "./infra/asker-access.js";
import {
  GROUP_SCOPE_ENTITIES, entityGuardError, normalizeCoreToolArgs, patchCoreToolSchema, type CoreToolSchemaOptions,
} from "./core-tool-arg-compat.js";
import type { FunctionDeclaration } from "./gemini-client.js";
import { sanitizeForGemini } from "./gemini-schema-sanitizer.js";

// Bộ chuyển công cụ LÕI (src/data-access) cho trợ lý TRONG TIẾN TRÌNH — không gọi HTTP vòng về /mcp. Cùng danh mục, cùng chốt chặn,
// cùng bộ che dữ liệu với cổng MCP; khác: danh tính = người hỏi Zalo (`AskerAccess`), kết quả trả JSON cho lượt gọi hàm.

const log = createLogger("assistant");

/**
 * Công cụ lõi đưa cho trợ lý: chỉ hai công cụ MÀ CÔNG CỤ CŨ KHÔNG LÀM ĐƯỢC (đếm / lọc / gộp có cấu trúc, tra trường). Không đưa
 * `get_thread_messages` / `get_file_text` (trùng get_group_messages / read_file — mô hình dễ chọn nhầm), `search_messages` (bản cũ có
 * mentions_me + tên nhóm), `metrics_summary` (bản cũ tra chỉ tiêu theo tên + kỳ) và `whoami`.
 */
export const ASSISTANT_CORE_TOOL_NAMES = ["describe_entities", "query_records"] as const;

const CORE_TOOLS_BY_NAME: ReadonlyMap<string, AnyToolDefinition> = new Map(READ_TOOLS.map((tool) => [tool.name, tool]));

/** Tên → định nghĩa lõi (Map, không tra prototype). */
export function findAssistantCoreTool(name: string): AnyToolDefinition | undefined {
  return (ASSISTANT_CORE_TOOL_NAMES as readonly string[]).includes(name) ? CORE_TOOLS_BY_NAME.get(name) : undefined;
}

/** Hỏi trong nhóm → chỉ thực thể gắn nhóm; tin riêng → mọi thực thể người hỏi đọc được. */
export function coreToolOptions(scopeGroupId: number | undefined): CoreToolSchemaOptions {
  return scopeGroupId === undefined ? {} : { allowedEntities: GROUP_SCOPE_ENTITIES };
}

/**
 * Khai báo hàm của một công cụ lõi cho người hỏi này. null = ẩn (người này không dùng được, hoặc sơ đồ không qua bộ làm sạch —
 * khi đó chỉ log và bỏ công cụ, lượt hỏi vẫn chạy thay vì cả lượt bị Gemini trả 400).
 */
export function toFunctionDeclaration(def: AnyToolDefinition, access: AskerAccess, options: CoreToolSchemaOptions = {}): FunctionDeclaration | null {
  if (!def.available(access)) return null;
  try {
    const raw = z.toJSONSchema(def.input(access), { target: "openapi-3.0", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    const patched = patchCoreToolSchema(def.name, raw, options);
    if (!patched) return null;
    return { name: def.name, description: def.description, parameters: sanitizeForGemini(patched) };
  } catch (error) {
    log.error(`bỏ công cụ lõi ${def.name} khỏi khai báo của trợ lý: ${describeError(error)}`);
    return null;
  }
}

/** Các khai báo lõi người hỏi dùng được (đã ẩn công cụ không đủ quyền). */
export function coreToolDeclarations(access: AskerAccess, options: CoreToolSchemaOptions = {}): FunctionDeclaration[] {
  return ASSISTANT_CORE_TOOL_NAMES.flatMap((name) => {
    const def = CORE_TOOLS_BY_NAME.get(name);
    const declaration = def ? toFunctionDeclaration(def, access, options) : null;
    return declaration ? [declaration] : [];
  });
}

/**
 * Chạy một công cụ lõi cho người hỏi: kiểm `available` + zod + che dữ liệu cá nhân nằm trong `runTool` của lõi. Trả JSON có cấu
 * trúc (hoặc `{ error: { code, message, allowed? } }` — lõi đã đóng sẵn); ghi `mcp_call_log` (source = Assistant, key_id = null).
 */
export async function runCoreTool(
  def: AnyToolDefinition, access: AskerAccess, args: Record<string, unknown>, options: CoreToolSchemaOptions = {},
): Promise<Record<string, unknown>> {
  const startedAt = performance.now();
  const blocked = entityGuardError(args, options.allowedEntities);
  const normalized = normalizeCoreToolArgs(def.name, args);
  const record = (fields: { status: McpCallStatus; rowCount?: number; resultChars?: number; entity?: string; errorCode?: string }) => {
    void logMcpCall(access.db, {
      userId: access.principal.userId, tenantId: access.principal.tenantId, keyId: null, source: access.source, tool: def.name,
      args: normalized, rowCount: 0, resultChars: 0, durationMs: performance.now() - startedAt, clientIp: null, ...fields,
    });
  };
  if (blocked) {
    record({ status: McpCallStatus.Denied, errorCode: "forbidden" });
    return { error: { code: "forbidden", message: blocked } };
  }
  try {
    const result = await runCoreToolDefinition(def, access, normalized);
    record({ status: statusOf(result), rowCount: result.rowCount, resultChars: result.resultChars, entity: result.entity, errorCode: result.errorCode });
    return result.structured as Record<string, unknown>;
  } catch (error) {
    record({ status: McpCallStatus.Error, errorCode: "internal" });
    throw error; // `runTool` của trợ lý đổi thành «Công cụ lỗi: …» cho mô hình
  }
}
