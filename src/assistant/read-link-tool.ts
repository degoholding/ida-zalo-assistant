import type { Db } from "../db/pool.js";
import { callFilesCommand, filesMcpFor } from "./files-command-call.js";
import type { AskerAccess } from "./infra/asker-access.js";
import type { FunctionDeclaration } from "./gemini-client.js";
import { linkFingerprint } from "./link-fingerprint.js";
import { LinkReadError, type LinkContent } from "./link-reader.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import { linkWasSharedLegacy } from "./read-link-tool-legacy.js";

// Công cụ read_link (07/10/2026): đọc nội dung link người dùng gửi — Google Sheets / Docs / Slides / Drive (chia sẻ
// «Bất kỳ ai có đường liên kết», không cần Google Cloud), trang web. Chống rò dữ liệu: chỉ đọc link ĐÃ CÓ trong tin nhắn
// (của nhóm đang hỏi nếu hỏi trong nhóm) hoặc trong chính câu hỏi — mô hình bị tin nhắn «dụ» cũng không tự chế link
// nhét dữ liệu nội bộ vào đường dẫn được. Họ `files` bật: việc kiểm «link có trong tin người hỏi thấy được» là công cụ lệnh `link_shared_check` của lõi;
// TẢI nội dung link là tác động ngoài nên luôn ở phía trợ lý. Họ tắt: kiểm bằng SQL cũ (`read-link-tool-legacy.ts`).

export type ReadLink = (url: string) => Promise<LinkContent>;
export { linkFingerprint };

const MAX_RETURN_CHARS = 60_000;

export const READ_LINK_DECLARATION: FunctionDeclaration = {
  name: "read_link",
  description:
    "Đọc NỘI DUNG một link: Google Sheets (mọi sheet), Google Docs, Google Slides, tệp Google Drive (kể cả GHI ÂM mp3 / m4a / wav — nhận lại " +
    "bản gỡ băng + tóm tắt), trang web. Dùng khi người hỏi nói «đọc link», «recap link / tài liệu của X», «recap cuộc họp từ link này» mà " +
    "trong tin có link — KHÔNG lấy tệp khác thay cho link. Link phải nằm trong tin nhắn hoặc câu hỏi (tìm trong các tin gần nhất / " +
    "get_group_messages); chép NGUYÊN VĂN link.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "Link đầy đủ, vd https://docs.google.com/spreadsheets/d/…/edit" } },
    required: ["url"],
  },
};

const NOT_SHARED = { error: "Link này không có trong tin nhắn — chỉ đọc link người dùng đã gửi (chép nguyên văn từ tin)." };

/** Link có trong tin người hỏi thấy được không: qua MCP (`link_shared_check`) nếu họ `files` bật, không thì SQL cũ. Lỗi công cụ (vd lõi từ chối) → trả `{ error }`. */
async function linkShared(
  context: { db: Db; access: AskerAccess; scopeGroupId?: number; mcp?: AssistantMcpTurn }, url: string, fingerprint: string,
): Promise<true | { error: string }> {
  const mcp = await filesMcpFor(context.mcp, "link_shared_check");
  if (!mcp) return await linkWasSharedLegacy(context.db, context.access, fingerprint, context.scopeGroupId) ? true : NOT_SHARED;
  const result = await callFilesCommand(mcp, { filesToSend: [] }, "link_shared_check", { url });
  if ("error" in result) return { error: String(result.error) };
  return result.shared === true ? true : NOT_SHARED;
}

export async function runReadLink(
  context: { db: Db; access: AskerAccess; readLink?: ReadLink; question?: string; scopeGroupId?: number; mcp?: AssistantMcpTurn },
  args: Record<string, unknown>,
): Promise<{ response: Record<string, unknown>; content: LinkContent | null }> {
  if (!context.readLink) return { response: { error: "Bot chưa bật đọc link." }, content: null };
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const fingerprint = linkFingerprint(url);
  if (!fingerprint) return { response: { error: "Thiếu hoặc sai link — chép nguyên văn link trong tin nhắn." }, content: null };
  const inQuestion = Boolean(context.question?.includes(fingerprint));
  if (!inQuestion) {
    const shared = await linkShared(context, url, fingerprint);
    if (shared !== true) return { response: shared, content: null };
  }
  try {
    const content = await context.readLink(url);
    const truncated = content.text.length > MAX_RETURN_CHARS;
    return {
      response: { how: content.how, char_count: content.text.length, truncated, content: content.text.slice(0, MAX_RETURN_CHARS) },
      content,
    };
  } catch (error) {
    if (error instanceof LinkReadError) return { response: { error: error.message }, content: null };
    throw error;
  }
}
