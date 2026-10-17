import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { McpAccessLevel } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { Principal } from "../auth/principal.js";
import { fakeDb } from "../data-access/data-access-test-support.js";
import type { McpAccess } from "./mcp-bearer-auth.js";
import type { McpCallLogEntry } from "./mcp-call-log.js";
import { ConcurrencyGate } from "./mcp-concurrency-gate.js";
import { buildMcpServer, toAuthInfo } from "./mcp-server-factory.js";
import { McpRateLimiter } from "./mcp-rate-limiter.js";

// Dụng cụ test cổng MCP không DB: handler SDK thật + Client SDK trong tiến trình (fetch nối thẳng `handler.fetch`, không mở cổng mạng).

export interface McpTestRig {
  client: Client;
  logs: McpCallLogEntry[];
  close(): Promise<void>;
}

export async function connectTestClient(principal: Principal, options: { perMinute?: number; level?: McpAccessLevel; maskPersonalData?: boolean; db?: Db; gate?: ConcurrencyGate; ownDirectUid?: string | null } = {}): Promise<McpTestRig> {
  const logs: McpCallLogEntry[] = [];
  const limiter = new McpRateLimiter({ perMinute: options.perMinute ?? 60, maxConcurrent: 4 });
  const deps = { db: options.db ?? fakeDb().db, maskPersonalData: options.maskPersonalData ?? false, limiter, gate: options.gate ?? new ConcurrencyGate(3, 100), logCall: async (entry: McpCallLogEntry) => { logs.push(entry); } };
  const access: McpAccess = { principal, keyId: 5, level: options.level ?? McpAccessLevel.Read, clientIp: "203.0.113.9", ownDirectUid: options.ownDirectUid ?? null };
  const handler = createMcpHandler(({ authInfo }) => buildMcpServer(authInfo, deps), { responseMode: "json" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (input, init) => handler.fetch(new Request(input, init), { authInfo: toAuthInfo(access) }),
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, logs, close: async () => { await client.close(); await handler.close(); } };
}
