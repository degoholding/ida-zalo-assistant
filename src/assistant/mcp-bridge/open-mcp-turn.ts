import { logMcpCall } from "../../mcp/mcp-call-log.js";
import type { AskerAccess } from "../asker-access.js";
import { assistantWriteAccess } from "../write-tool-adapter.js";
import type { AssistantMcpBridge } from "./assistant-mcp-bridge-config.js";
import { AssistantMcpTurn } from "./assistant-mcp-turn.js";

export interface OpenMcpTurnOptions {
  /** Hỏi trong nhóm: id nhóm (lõi chỉ cho thực thể gắn nhóm; không ghi). */
  groupScopeId?: number;
  /** Cài đặt «assistant_core_query_tools» tắt thì họ `core` không lên máy chủ (đường cũ cũng không khai báo công cụ lõi). */
  coreQueryTools?: boolean;
  /** Đánh thức bộ chạy việc nền sau khi ghi (báo Zalo). */
  wakeJobs?: () => void;
}

/**
 * Dựng phiên MCP cho lượt hỏi (CHƯA mở kết nối nào — mở lười). undefined khi không có cầu nối hoặc không họ nào bật ⇒ lượt chạy
 * đường cũ hoàn toàn, không dựng gì. `allowWrite` của ctx chỉ bật khi người hỏi đủ điều kiện ghi qua trợ lý (tài khoản web, tin riêng thật,
 * Quản trị / Quản lý) — công cụ `propose_*` / `confirm_draft` tự ẩn nếu không.
 */
export function openMcpTurn(access: AskerAccess, bridge: AssistantMcpBridge | null, options: OpenMcpTurnOptions = {}): AssistantMcpTurn | undefined {
  const enabled = bridge?.families();
  if (!bridge || !enabled) return undefined;
  const families = new Set(enabled);
  if (options.coreQueryTools === false) families.delete("core");
  if (families.size === 0) return undefined;
  const ctx = { ...(assistantWriteAccess(access, options.groupScopeId) ?? access), groupScopeId: options.groupScopeId, wakeJobs: options.wakeJobs ?? access.wakeJobs };
  return new AssistantMcpTurn(ctx, families, { gate: bridge.gate, logCall: (entry) => logMcpCall(access.db, entry), families });
}
