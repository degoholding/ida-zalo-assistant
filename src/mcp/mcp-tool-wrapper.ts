import { McpCallSource, McpCallStatus } from "../constants.js";
import { currentPrincipal } from "../auth/principal.js";
import type { DataAccessContext } from "../data-access/data-access-context.js";
import type { AnyToolDefinition } from "../data-access/tool-definition.js";
import { runTool } from "../data-access/tool-runner.js";
import { createLogger, describeError } from "../logger.js";
import type { ConcurrencyGate } from "./mcp-concurrency-gate.js";
import type { McpCallLogEntry } from "./mcp-call-log.js";
import type { McpRateLimiter } from "./mcp-rate-limiter.js";
import { INTERNAL_ERROR_RESULT, rateLimitedResult, serverBusyResult, statusOf, toCallToolResult, type McpToolResult } from "./mcp-tool-result.js";

// Bọc MỘT công cụ lõi thành hàm xử lý của `registerTool`: giới hạn nhịp → chạy dưới danh tính người gọi → đổi kết quả → ghi mcp_call_log.

const log = createLogger("mcp");

export interface ToolWrapperDeps {
  limiter: McpRateLimiter;
  /** Trần đồng thời toàn cục (mọi khóa) — bảo vệ pool MySQL dùng chung. */
  gate: ConcurrencyGate;
  /** Ghi nhật ký gọi; lỗi ghi không làm hỏng lời gọi. Test tiêm bản giả (không DB). */
  logCall: (entry: McpCallLogEntry) => Promise<void>;
}

export function wrapTool(tool: AnyToolDefinition, ctx: DataAccessContext, clientIp: string, deps: ToolWrapperDeps) {
  const { principal } = ctx;
  const record = (entry: Pick<McpCallLogEntry, "args" | "status" | "durationMs"> & Partial<McpCallLogEntry>): void => {
    deps.logCall({
      userId: principal.userId, tenantId: principal.tenantId, keyId: ctx.keyId, source: McpCallSource.Http, tool: tool.name,
      rowCount: 0, resultChars: 0, clientIp, ...entry,
    }).catch((error) => log.error(`ghi nhật ký gọi ${tool.name}: ${describeError(error)}`));
  };

  return async (args: unknown): Promise<McpToolResult> => {
    const startedAt = performance.now();
    const slot = ctx.keyId === null ? null : deps.limiter.take(ctx.keyId);
    if (slot && !slot.ok) {
      record({ args, status: McpCallStatus.RateLimited, errorCode: "rate_limited", durationMs: performance.now() - startedAt });
      return rateLimitedResult(slot.retryAfterSeconds, slot.reason);
    }
    // Xếp hàng chờ chỗ chạy toàn cục; hết hạn chờ thì báo bận (mô hình thử lại sau) thay vì dồn thêm tải lên DB
    const turn = await deps.gate.acquire();
    if (!turn.ok) {
      if (slot?.ok) slot.release();
      record({ args, status: McpCallStatus.RateLimited, errorCode: "server_busy", durationMs: performance.now() - startedAt });
      return serverBusyResult();
    }
    try {
      // Nhật ký ghi (audit_log) lấy tên người từ đây — gắn «· MCP» để phân biệt với thao tác trên web
      const actor = { ...principal, fullName: `${principal.fullName} · MCP` };
      const result = await currentPrincipal.run(actor, () => runTool(tool, ctx, args));
      record({
        args, status: statusOf(result), entity: result.entity, rowCount: result.rowCount, resultChars: result.resultChars,
        errorCode: result.errorCode, durationMs: performance.now() - startedAt,
      });
      return toCallToolResult(result);
    } catch (error) {
      log.error(`công cụ ${tool.name} lỗi hệ thống: ${describeError(error)}`);
      record({ args, status: McpCallStatus.Error, errorCode: "internal", durationMs: performance.now() - startedAt });
      return INTERNAL_ERROR_RESULT;
    } finally {
      turn.release();
      if (slot?.ok) slot.release();
    }
  };
}
