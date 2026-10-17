import type http from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { authenticateMcpRequest, type AuthOutcome } from "./mcp-bearer-auth.js";
import { logMcpCall } from "./mcp-call-log.js";
import { buildMcpServer, toAuthInfo, type McpServerFactoryDeps } from "./mcp-server-factory.js";
import { ConcurrencyGate } from "./mcp-concurrency-gate.js";
import { FailureWindow, McpRateLimiter } from "./mcp-rate-limiter.js";

// Cổng `/mcp` (Streamable HTTP, không trạng thái, trả JSON — không cần SSE). Thứ tự: Host → Origin → Bearer → handler SDK.
// Handler SDK KHÔNG tự kiểm Host / Origin / token nên cổng làm cả ba. Dựng MỘT lần lúc khởi động.

const log = createLogger("mcp");
export const MCP_PATH = "/mcp";
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const UNAUTHORIZED_CHALLENGE = 'Bearer realm="bot-tro-ly"';

export interface McpGateway {
  /** Xử lý một request tới /mcp (đã khớp đường dẫn). Không bao giờ ném — lỗi trả về dưới dạng HTTP. */
  handle(request: http.IncomingMessage, response: http.ServerResponse, clientIp: string): Promise<void>;
  close(): Promise<void>;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}

function rejectAuth(response: http.ServerResponse, outcome: Extract<AuthOutcome, { ok: false }>): void {
  const headers: Record<string, string> = outcome.status === 401 ? { "WWW-Authenticate": UNAUTHORIZED_CHALLENGE } : { "Retry-After": "60" };
  sendJson(response, outcome.status, { error: outcome.message }, headers);
}

export function createMcpGateway(db: Db, config: AppConfig, options: { wakeJobs?: () => void } = {}): McpGateway {
  const limiter = new McpRateLimiter({ perMinute: config.mcp.rateLimitPerMinute, maxConcurrent: config.mcp.maxConcurrentPerKey });
  const failures = new FailureWindow(config.mcp.badKeyLimitPerMinute);
  const factoryDeps: McpServerFactoryDeps = {
    db, maskPersonalData: config.privacy.maskPersonalData, limiter, gate: new ConcurrencyGate(config.mcp.maxConcurrent, config.mcp.queueWaitMs),
    logCall: (entry) => logMcpCall(db, entry), wakeJobs: options.wakeJobs,
  };
  const sdkHandler = createMcpHandler(({ authInfo }) => buildMcpServer(authInfo, factoryDeps), {
    responseMode: "json", maxRequestBodySize: MAX_REQUEST_BODY_BYTES, onerror: (error) => log.warn(`SDK: ${describeError(error)}`),
  });
  const nodeHandler = toNodeHandler(sdkHandler, {
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES, onerror: (error) => log.error(`xử lý request: ${describeError(error)}`),
  });
  const hostGuard = hostHeaderValidation(config.mcp.allowedHosts);
  const originGuard = originValidation(config.mcp.allowedHosts);

  return {
    async handle(request, response, clientIp) {
      try {
        if (!hostGuard(request, response) || !originGuard(request, response)) return;
        const outcome = await authenticateMcpRequest({ db, failures }, request, clientIp);
        if (!outcome.ok) return rejectAuth(response, outcome);
        // `toNodeHandler` đọc `req.auth` làm authInfo của factory (đã kiểm ở SDK 2.1.1)
        (request as http.IncomingMessage & { auth?: unknown }).auth = toAuthInfo(outcome.access);
        await nodeHandler(request, response);
      } catch (error) {
        log.error(`/mcp lỗi: ${describeError(error)}`);
        if (!response.headersSent) sendJson(response, 500, { error: "Lỗi máy chủ — xem log." });
        else response.destroy();
      }
    },
    close: () => sdkHandler.close(),
  };
}
