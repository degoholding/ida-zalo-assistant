import { coreToolDeclarations, coreToolOptions } from "./core-tool-adapter.js";
import type { AskerAccess } from "./infra/asker-access.js";
import { CORE_QUERY_TOOLS_PROMPT, WRITE_TOOLS_PROMPT } from "./core-tools-prompt.js";
import type { FunctionDeclaration } from "./gemini-client.js";
import { writeToolDeclarations } from "./write-tool-adapter.js";

// Nối công cụ lõi vào MỘT lượt hỏi (tách khỏi assistant-service.ts đã quá dài): khai báo hàm + lời nhắc, hoặc rỗng khi cài đặt tắt /
// người hỏi không có thực thể nào đọc được.

export interface CoreQueryToolSetup {
  declarations: FunctionDeclaration[];
  /** Lời nhắc nối vào system prompt (rỗng khi không có công cụ). */
  prompt: string;
}

export function buildCoreQueryTools(access: AskerAccess, enabled: boolean, scopeGroupId: number | undefined): CoreQueryToolSetup {
  if (!enabled) return { declarations: [], prompt: "" };
  const declarations = coreToolDeclarations(access, coreToolOptions(scopeGroupId));
  const writes = writeToolDeclarations(access, scopeGroupId);
  const prompt = [declarations.length ? CORE_QUERY_TOOLS_PROMPT : "", writes.length ? WRITE_TOOLS_PROMPT : ""].filter(Boolean).join("\n\n");
  return declarations.length || writes.length ? { declarations: [...declarations, ...writes], prompt: `\n\n${prompt}` } : { declarations: [], prompt: "" };
}
