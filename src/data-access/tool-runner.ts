import { McpCallSource } from "../constants.js";
import { maskPersonalDataDeep } from "../privacy/personal-data.js";
import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError, toErrorPayload, type DataAccessErrorCode } from "./data-access-errors.js";
import { MASK_NOTICE, buildToolText } from "./result-envelope.js";
import type { AnyToolDefinition, ToolMediaBlock } from "./tool-definition.js";
import type { TurnEffects } from "./turn-effects.js";

// Chạy MỘT lời gọi công cụ cho mọi cổng: kiểm `available`, kiểm đầu vào bằng zod, chạy, che dữ liệu cá nhân (một chỗ cho cả
// bảy công cụ), dựng khối chữ. Lỗi nghiệp vụ trả về `isError: true` — không ném; lỗi hệ thống (DB sập…) ném tiếp để cổng ghi `Error`.

export interface ToolResult {
  isError: boolean;
  structured: unknown;
  /** Khối chữ cho client chỉ đọc `content`: tóm tắt + JSON bọc <du_lieu> (hoặc lời báo lỗi). */
  text: string;
  rowCount: number;
  resultChars: number;
  entity?: string;
  errorCode?: DataAccessErrorCode;
  /** Tác động của lượt trợ lý (chỉ khi công cụ khai); cổng MCP ngoài không bao giờ chuyển đi. */
  effects?: TurnEffects;
  /** Ảnh / tệp gốc trả kèm (ToolOutcome.media). */
  media?: ToolMediaBlock[];
}

/**
 * Lỗi nghiệp vụ → kết quả `isError`. CỔNG NGOÀI (`mcp_http`): chuỗi do NGƯỜI NGOÀI đặt (tên hiển thị, tên nhóm trong `choices` / `allowed`) KHÔNG đi
 * vào câu lỗi dạng chữ — câu lỗi chỉ nêu số lượng, danh sách nằm trong dữ liệu có cấu trúc + `untrusted_fields`, khối chữ bọc <du_lieu>.
 * Mặt trợ lý (mô hình + lệnh gõ): giữ NGUYÊN câu gốc có tên — người dùng Zalo cần tên để chọn đúng người / nhóm, và câu này là chữ cũ của đường không qua MCP.
 */
function failure(error: DataAccessError, external: boolean): ToolResult {
  const payload = toErrorPayload(error);
  const untrusted: string[] = [];
  if (payload.error.choices) untrusted.push("error.choices");
  if (payload.error.allowed) untrusted.push("error.allowed");
  if (!external || !untrusted.length) {
    const text = `Lỗi ${error.code}: ${error.message}\n${JSON.stringify(payload)}`;
    return { isError: true, structured: payload, text, rowCount: 0, resultChars: text.length, errorCode: error.code };
  }
  const safeMessage = error.code === "ambiguous" && payload.error.choices
    ? `Có ${payload.error.choices.length} kết quả khớp — chọn một trong danh sách (error.choices, là dữ liệu không đáng tin) hoặc nêu tên đầy đủ hơn.`
    : error.message;
  const structured = { error: { ...payload.error, message: safeMessage }, untrusted_fields: untrusted };
  const text = buildToolText(`Lỗi ${error.code}: ${safeMessage}`, structured);
  return { isError: true, structured, text, rowCount: 0, resultChars: text.length, errorCode: error.code };
}

function describeZodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.map(String).join(".") || "(gốc)"}: ${issue.message}`).join("; ");
}

export async function runTool(tool: AnyToolDefinition, ctx: DataAccessContext, rawInput: unknown): Promise<ToolResult> {
  const external = ctx.source === McpCallSource.Http;
  if (!tool.available(ctx)) return failure(new DataAccessError("forbidden", `Công cụ «${tool.name}» không dùng được với tài khoản / khóa này.`), external);
  const parsed = tool.input(ctx).safeParse(rawInput ?? {});
  if (!parsed.success) return failure(new DataAccessError("invalid_value", `Đầu vào không hợp lệ — ${describeZodIssues(parsed.error)}`), external);
  try {
    const outcome = await tool.handler(ctx, parsed.data);
    let structured: unknown = outcome.structured;
    let summary = outcome.summary;
    if (ctx.maskPersonal) {
      const notices = (structured as { notices?: unknown })?.notices;
      if (Array.isArray(notices) && !notices.includes(MASK_NOTICE)) notices.push(MASK_NOTICE);
      structured = maskPersonalDataDeep(structured);
      summary = maskPersonalDataDeep(summary);
    }
    const text = buildToolText(summary, structured);
    const mediaChars = (outcome.media ?? []).reduce((sum, block) => sum + (block.type === "image" ? block.data.length : block.resource.blob.length), 0);
    return {
      isError: false, structured, text, rowCount: outcome.rowCount, resultChars: text.length + mediaChars, entity: outcome.entity, effects: outcome.effects,
      ...(outcome.media?.length ? { media: outcome.media } : {}),
    };
  } catch (error) {
    if (error instanceof DataAccessError) return failure(error, external);
    throw error;
  }
}
