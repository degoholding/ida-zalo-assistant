import { performance } from "node:perf_hooks";
import type { AskerAccess } from "../assistant/asker-access.js";
import { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import { McpCallSource, UserRole } from "../constants.js";
import { buildDataAccessContext } from "../data-access/data-access-context.js";
import { ALL_TOOLS } from "../data-access/read-tool-catalog.js";
import { runTool } from "../data-access/tool-runner.js";
import type { Db } from "../db/pool.js";
import { ConcurrencyGate } from "../mcp/mcp-concurrency-gate.js";

// Đo tay (không chạy CI): chi phí cầu nối MCP trong tiến trình so với gọi thẳng lõi. Không cần DB (DB giả trả rỗng) vì cần đo phần GIAO THỨC
// (dựng máy chủ + initialize + tools/list; JSON-RPC + wrapTool mỗi lời gọi). Mục tiêu phase 1: mở phiên + tools/list p50 < 20 ms, chênh mỗi
// lời gọi p50 < 3 ms.  Chạy: npx tsx src/dev/bench-assistant-mcp.ts

const db = { query: async () => [[], []] } as unknown as Db;
const principal = { userId: 7, tenantId: 1, fullName: "Quản lý", email: "q@example.com", role: UserRole.Manager, groupIds: [11, 12] };
const access: AskerAccess = {
  ...buildDataAccessContext({ db, principal, maskPersonal: true, source: McpCallSource.Assistant, ownDirectThreadsOnly: true, ownDirectUid: "u-1" }),
  origin: "web_user", allowWrite: true,
};
const families = new Set(["core", "drafts"] as const);
const percentile = (values: number[], p: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const fmt = (values: number[]): string => `p50 ${percentile(values, 0.5).toFixed(2)} ms · p95 ${percentile(values, 0.95).toFixed(2)} ms`;

async function newTurn(): Promise<AssistantMcpTurn> {
  return new AssistantMcpTurn(access, families, { gate: new ConcurrencyGate(5, 1000), logCall: async () => undefined, families });
}

async function main(): Promise<void> {
  const describe = ALL_TOOLS.find((tool) => tool.name === "describe_entities")!;
  const opens: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const turn = await newTurn();
    const start = performance.now();
    await turn.model(); // dựng máy chủ + initialize + tools/list
    opens.push(performance.now() - start);
    await turn.close();
  }
  const turn = await newTurn();
  await turn.model();
  const viaMcp: number[] = [];
  const direct: number[] = [];
  for (let i = 0; i < 300; i += 1) {
    let start = performance.now();
    await turn.callTool("assistant_model", "describe_entities", { entity: "tasks" });
    viaMcp.push(performance.now() - start);
    start = performance.now();
    await runTool(describe, access, { entity: "tasks" });
    direct.push(performance.now() - start);
  }
  await turn.close();
  const deltas = viaMcp.map((value, index) => value - direct[index]);
  console.log(`mở phiên + tools/list (60 lần, lạnh cache sơ đồ ở lần đầu): ${fmt(opens)}`);
  console.log(`describe_entities qua callTool (300): ${fmt(viaMcp)}`);
  console.log(`describe_entities gọi thẳng lõi (300): ${fmt(direct)}`);
  console.log(`chênh mỗi lời gọi: ${fmt(deltas)}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
