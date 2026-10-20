import type { AnyToolDefinition, AssistantFamily } from "../tool-definition.js";
import type { AnyWriteAction } from "../write/write-action.js";

// Danh mục công cụ của MỘT họ chuyển sang MCP. Mỗi họ một tệp `<họ>-family-tools.ts` để phase sau sở hữu riêng, không đụng nhau.

export interface FamilyCatalog {
  family: AssistantFamily;
  /** Công cụ của họ (mặt `assistant_model` / `assistant_command`; có thể thêm `mcp_http`). */
  tools: readonly AnyToolDefinition[];
  /** Thao tác ghi của họ — chỉ để `confirm_draft` / `confirm_write` tra theo tên; công cụ `propose_*` của họ nằm trong `tools`. */
  actions: readonly AnyWriteAction[];
  /** Lời nhắc của họ (thay lời nhắc cũ trong system prompt của trợ lý). Rỗng = họ không có lời nhắc. */
  instructions: string;
}
