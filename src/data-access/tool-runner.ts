import { maskPersonalDataDeep } from "../privacy/personal-data.js";
import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError, toErrorPayload, type DataAccessErrorCode } from "./data-access-errors.js";
import { MASK_NOTICE, buildToolText } from "./result-envelope.js";
import type { AnyToolDefinition } from "./tool-definition.js";

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
}

function failure(error: DataAccessError): ToolResult {
  const payload = toErrorPayload(error);
  const text = `Lỗi ${error.code}: ${error.message}\n${JSON.stringify(payload)}`;
  return { isError: true, structured: payload, text, rowCount: 0, resultChars: text.length, errorCode: error.code };
}

function describeZodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.map(String).join(".") || "(gốc)"}: ${issue.message}`).join("; ");
}

export async function runTool(tool: AnyToolDefinition, ctx: DataAccessContext, rawInput: unknown): Promise<ToolResult> {
  if (!tool.available(ctx)) return failure(new DataAccessError("forbidden", `Công cụ «${tool.name}» không dùng được với tài khoản / khóa này.`));
  const parsed = tool.input(ctx).safeParse(rawInput ?? {});
  if (!parsed.success) return failure(new DataAccessError("invalid_value", `Đầu vào không hợp lệ — ${describeZodIssues(parsed.error)}`));
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
    return { isError: false, structured, text, rowCount: outcome.rowCount, resultChars: text.length, entity: outcome.entity };
  } catch (error) {
    if (error instanceof DataAccessError) return failure(error);
    throw error;
  }
}
