import { McpCallSource, McpCallStatus } from "../constants.js";
import { currentPrincipal } from "../auth/principal.js";
import type { DataAccessContext } from "../data-access/data-access-context.js";
import type { AnyToolDefinition } from "../data-access/tool-definition.js";
import { runTool } from "../data-access/tool-runner.js";
import { createLogger, describeError } from "../logger.js";
import type { ConcurrencyGate } from "./mcp-concurrency-gate.js";
import type { McpCallLogEntry } from "./mcp-call-log.js";
import type { McpRateLimiter } from "./mcp-rate-limiter.js";
import { internalErrorResult, rateLimitedResult, serverBusyResult, statusOf, toCallToolResult, type McpToolResult } from "./mcp-tool-result.js";

// Bọc MỘT công cụ lõi thành hàm xử lý của `registerTool`: giới hạn nhịp → chạy dưới danh tính người gọi → đổi kết quả → ghi mcp_call_log.
// Dùng chung cho cổng /mcp (source Http, nhãn «· MCP», limiter theo khóa) và máy chủ trong tiến trình của trợ lý (source Assistant /
// AssistantCommand, nhãn «· Trợ lý», không limiter theo khóa, cổng đồng thời RIÊNG).

const log = createLogger("mcp");

export interface ToolWrapperDeps {
  limiter: McpRateLimiter;
  /** Trần đồng thời toàn cục (mọi khóa) — bảo vệ pool MySQL dùng chung. */
  gate: ConcurrencyGate;
  /** Ghi nhật ký gọi; lỗi ghi không làm hỏng lời gọi. Test tiêm bản giả (không DB). */
  logCall: (entry: McpCallLogEntry) => Promise<void>;
}

export interface ToolWrapperOptions {
  /** Cột mcp_call_log.source. `Http` = cổng ngoài: kết quả không có `_meta`; nguồn khác = mặt trợ lý (có `_meta` lỗi / tác động). */
  source: McpCallSource;
  /** Hậu tố tên người ở audit_log: "MCP" hoặc "Trợ lý". */
  actorSuffix: "MCP" | "Trợ lý";
  clientIp: string | null;
  /** Nhịp theo khóa (chỉ cổng ngoài có `ctx.keyId`). null / thiếu = không giới hạn nhịp ở đây (trợ lý đã có trần giờ / ngày của lượt). */
  limiter?: McpRateLimiter | null;
  gate: ConcurrencyGate;
  logCall: ToolWrapperDeps["logCall"];
}

export function wrapTool(tool: AnyToolDefinition, ctx: DataAccessContext, opts: ToolWrapperOptions) {
  const { principal } = ctx;
  const rich = opts.source !== McpCallSource.Http;
  // Ghi nhật ký được ĐỢI (một INSERT rẻ) để thứ tự dòng khớp thứ tự lời gọi và không còn dòng ghi muộn sau khi lượt xong; lỗi ghi vẫn không làm hỏng lời gọi
  const record = async (entry: Pick<McpCallLogEntry, "args" | "status" | "durationMs"> & Partial<McpCallLogEntry>): Promise<void> => {
    await opts.logCall({
      userId: principal.userId, contactId: ctx.contactActor?.contactId ?? null, tenantId: principal.tenantId, keyId: ctx.keyId, source: opts.source, tool: tool.name,
      rowCount: 0, resultChars: 0, clientIp: opts.clientIp, ...entry,
    }).catch((error) => log.error(`ghi nhật ký gọi ${tool.name}: ${describeError(error)}`));
  };

  return async (args: unknown): Promise<McpToolResult> => {
    const startedAt = performance.now();
    const slot = ctx.keyId === null || !opts.limiter ? null : opts.limiter.take(ctx.keyId);
    if (slot && !slot.ok) {
      await record({ args, status: McpCallStatus.RateLimited, errorCode: "rate_limited", durationMs: performance.now() - startedAt });
      return rateLimitedResult(slot.retryAfterSeconds, slot.reason);
    }
    // Xếp hàng chờ chỗ chạy toàn cục; hết hạn chờ thì báo bận (mô hình thử lại sau) thay vì dồn thêm tải lên DB
    const turn = await opts.gate.acquire();
    if (!turn.ok) {
      if (slot?.ok) slot.release();
      await record({ args, status: McpCallStatus.RateLimited, errorCode: "server_busy", durationMs: performance.now() - startedAt });
      return serverBusyResult(rich);
    }
    try {
      // Nhật ký ghi (audit_log) lấy tên người từ đây — gắn «· MCP» / «· Trợ lý» để phân biệt với thao tác trên web
      const actor = { ...principal, fullName: `${principal.fullName} · ${opts.actorSuffix}` };
      const result = await currentPrincipal.run(actor, () => runTool(tool, ctx, args));
      await record({
        args, status: statusOf(result), entity: result.entity, rowCount: result.rowCount, resultChars: result.resultChars,
        errorCode: result.errorCode, durationMs: performance.now() - startedAt,
      });
      return toCallToolResult(result, rich);
    } catch (error) {
      log.error(`công cụ ${tool.name} lỗi hệ thống: ${describeError(error)}`);
      await record({ args, status: McpCallStatus.Error, errorCode: "internal", durationMs: performance.now() - startedAt });
      return internalErrorResult(rich);
    } finally {
      turn.release();
      if (slot?.ok) slot.release();
    }
  };
}
