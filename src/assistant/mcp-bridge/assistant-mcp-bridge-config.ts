import { ConcurrencyGate } from "../../mcp/mcp-concurrency-gate.js";
import type { AssistantFamily } from "../../data-access/tool-definition.js";
import { parseMcpFamilies } from "./assistant-mcp-families.js";

// Cấu hình cầu nối MCP của trợ lý: họ nào bật (đọc LẠI mỗi lượt — đổi cài đặt có hiệu lực ngay) + cổng đồng thời riêng.

export interface AssistantMcpBridge {
  families: () => ReadonlySet<AssistantFamily>;
  gate: ConcurrencyGate;
}

/** Cổng dùng chung của cầu nối dựng từ biến môi trường (chỉ cho `npm run test:mcp`). */
let envGate: ConcurrencyGate | null = null;

/**
 * Cầu nối của lượt: `AssistantOptions.mcpBridge` tường minh (production: `sync-service`), không có thì biến `ASSISTANT_MCP_FAMILIES` (vd `all`)
 * — chỉ để `npm run test:mcp` chạy cả bộ test trợ lý cũ với họ bật bắt hồi quy (O7). Cả hai đều trống = không họ nào đi qua MCP.
 */
export function resolveAssistantMcpBridge(explicit: AssistantMcpBridge | undefined): AssistantMcpBridge | null {
  if (explicit) return explicit;
  const raw = process.env.ASSISTANT_MCP_FAMILIES;
  if (raw === undefined) return null;
  envGate ??= new ConcurrencyGate(5, 20_000);
  return { families: () => parseMcpFamilies(raw), gate: envGate };
}
