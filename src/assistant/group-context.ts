import type { Db } from "../db/pool.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import { createLogger, describeError } from "../logger.js";
import { groupContextSourceLegacy } from "./group-context-legacy.js";

// Ngữ cảnh khi bot được gọi TRONG NHÓM: vài tin gần nhất của chính nhóm đó (gồm cả câu bot vừa trả lời), để hỏi
// nối tiếp kiểu «chi tiết báo cáo đó» hiểu được «đó» là gì. Chỉ lấy tin của nhóm đang hỏi — đúng phạm vi groupScope.
// Tin nhóm là của nhiều người nên đưa thành MỘT khối chữ trong lượt hỏi, không dựng thành hội thoại user/model.
// Họ `reads` bật: đọc qua công cụ lệnh `group_context` của máy chủ MCP trong tiến trình; tắt: SQL cũ (`group-context-legacy.ts`).

export { loadGroupMemberNames } from "./group-context-legacy.js";

const log = createLogger("assistant");

/** Lượt hỏi trong nhóm: ngữ cảnh (nếu có) + câu hỏi. */
export function buildGroupQuestion(context: string, question: string): string {
  if (!context) return question;
  return `Các tin gần nhất trong nhóm (CHỈ để hiểu câu hỏi nối tiếp; tin của bot là câu bạn trả lời trước đó — lỗi / trạng thái trong đó có thể đã cũ, muốn làm gì thì gọi công cụ lại):\n${context}\n\nCâu hỏi: ${question}`;
}

export interface GroupContextSource {
  memberNames: string[];
  context: string;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Nguồn ngữ cảnh của lượt hỏi trong nhóm: tên thành viên + khối tin gần nhất. Có phiên MCP của lượt (`mcp`) và họ `reads` bật → lệnh `group_context`
 * (chạy NGAY, mô hình không thấy). Đọc thuần nên lỗi / phiên không có công cụ thì lùi về đường SQL cũ (không có nguy cơ ghi hai lần như họ ghi).
 */
export async function groupContextSource(db: Db, groupId: number, beforeMessageId: number | null, mcp?: AssistantMcpTurn): Promise<GroupContextSource> {
  if (mcp?.familyEnabled("reads")) {
    try {
      const session = await mcp.command();
      if (session?.toolNames.has("group_context")) {
        const result = await mcp.callTool("assistant_command", "group_context", beforeMessageId === null ? {} : { before_message_id: beforeMessageId });
        const data = result.structuredContent as { member_names?: unknown; context?: unknown } | undefined;
        if (!result.isError && data && isStringArray(data.member_names) && typeof data.context === "string") return { memberNames: data.member_names, context: data.context };
        log.error("group_context qua MCP không trả kết quả hợp lệ — dùng đường cũ");
      }
    } catch (error) {
      log.error(`group_context qua MCP lỗi — dùng đường cũ: ${describeError(error)}`);
    }
  }
  return groupContextSourceLegacy(db, groupId, beforeMessageId);
}
