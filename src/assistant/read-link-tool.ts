import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import type { FunctionDeclaration } from "./gemini-client.js";
import { LinkReadError, type LinkContent } from "./link-reader.js";

// Công cụ read_link (07/10/2026): đọc nội dung link người dùng gửi — Google Sheets / Docs / Slides / Drive (chia sẻ
// «Bất kỳ ai có đường liên kết», không cần Google Cloud), trang web. Chống rò dữ liệu: chỉ đọc link ĐÃ CÓ trong tin nhắn
// (của nhóm đang hỏi nếu hỏi trong nhóm) hoặc trong chính câu hỏi — mô hình bị tin nhắn «dụ» cũng không tự chế link
// nhét dữ liệu nội bộ vào đường dẫn được.

export type ReadLink = (url: string) => Promise<LinkContent>;

const MAX_RETURN_CHARS = 60_000;
const LINK_LOOKBACK_DAYS = 60;

export const READ_LINK_DECLARATION: FunctionDeclaration = {
  name: "read_link",
  description:
    "Đọc NỘI DUNG một link: Google Sheets (mọi sheet), Google Docs, Google Slides, tệp Google Drive, trang web. Dùng khi người hỏi " +
    "nói «đọc link», «recap link / tài liệu của X» mà trong tin có link — KHÔNG lấy tệp khác thay cho link. Link phải nằm trong tin nhắn " +
    "hoặc câu hỏi (tìm trong các tin gần nhất / get_group_messages); chép NGUYÊN VĂN link.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "Link đầy đủ, vd https://docs.google.com/spreadsheets/d/…/edit" } },
    required: ["url"],
  },
};

/** Phần nhận dạng của link để so với tin nhắn: id tệp Google, hoặc máy + đường dẫn. Hàm thuần. */
export function linkFingerprint(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const googleId = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1];
    if (googleId && url.hostname.endsWith("google.com")) return googleId;
    return `${url.hostname}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

async function linkWasShared(db: Db, fingerprint: string, scopeGroupId: number | undefined): Promise<boolean> {
  const escaped = fingerprint.replace(/[\\%_]/g, (char) => `\\${char}`);
  const [rows] = await db.query<RowDataPacket[]>(
    // Link chỉ xuất hiện trong nhóm Mật thì không tính — nội dung nhóm Mật không đi sang AI
    `SELECT 1 FROM message m JOIN zalo_group g ON g.id = m.group_id
     WHERE m.text LIKE ? AND m.sent_at > NOW() - INTERVAL ? DAY AND g.is_confidential = 0 ${scopeGroupId ? "AND m.group_id = ?" : ""} LIMIT 1`,
    [`%${escaped}%`, LINK_LOOKBACK_DAYS, ...(scopeGroupId ? [scopeGroupId] : [])],
  );
  return rows.length > 0;
}

export async function runReadLink(
  context: { db: Db; readLink?: ReadLink; question?: string; scopeGroupId?: number },
  args: Record<string, unknown>,
): Promise<{ response: Record<string, unknown>; content: LinkContent | null }> {
  if (!context.readLink) return { response: { error: "Bot chưa bật đọc link." }, content: null };
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const fingerprint = linkFingerprint(url);
  if (!fingerprint) return { response: { error: "Thiếu hoặc sai link — chép nguyên văn link trong tin nhắn." }, content: null };
  const inQuestion = Boolean(context.question?.includes(fingerprint));
  if (!inQuestion && !(await linkWasShared(context.db, fingerprint, context.scopeGroupId))) {
    return { response: { error: "Link này không có trong tin nhắn — chỉ đọc link người dùng đã gửi (chép nguyên văn từ tin)." }, content: null };
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
