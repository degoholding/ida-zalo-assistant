import type { RowDataPacket } from "mysql2";
import type { SendCommandDeps } from "../../send-commands/send-command-deps.js";
import { canIssueSendCommand, isFakeZaloId } from "../../send-commands/send-command-permissions.js";
import { loadSendRequester } from "../../send-commands/send-target-resolver.js";
import type { SendRequester } from "../../send-commands/send-command-types.js";
import { recordResolvedSendContext, sendTurnEntry, type ResolvedSendContext } from "../../send-commands/send-turn-registry.js";
import { actorFactMemo, type ContactActor } from "../actors/contact-actor.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";

// Sự thật về người hỏi cho họ `send` (phase 12): cuộc đang nhắn có phải Zalo thật không, và người này có được ra lệnh gửi không. Chỉ SUY từ `contactActor`
// (uid / cuộc của tin Zalo đã nhận) — không bao giờ từ tham số công cụ. Nhớ theo lượt bằng `actorFactMemo` (phase 5), kết quả cũng ghi vào sổ lượt để
// `available` (đồng bộ) của công cụ mô hình đọc lại. Nguyên văn tin + móc ứng dụng do `buildSendChatContext` đăng ký (send-commands/send-turn-registry.ts).

/** Lượt này đã đăng ký ngữ cảnh gửi (phía ứng dụng) — điều kiện để mọi công cụ gửi lên danh sách. */
export const hasSendTurn = (ctx: DataAccessContext): boolean => sendTurnEntry(ctx.contactActor) !== undefined;

/** Đã phân giải xong: tin riêng Zalo thật + người hỏi đủ quyền ra lệnh gửi + không hỏi trong nhóm. Đồng bộ — chỉ đúng SAU `send_context`. */
export function isSendAllowedNow(ctx: DataAccessContext): boolean {
  const entry = sendTurnEntry(ctx.contactActor);
  const resolved = entry?.resolved;
  return Boolean(resolved?.zaloThread && resolved.requester && canIssueSendCommand(resolved.requester) && ctx.contactActor?.groupId == null);
}

function turnOf(ctx: DataAccessContext): { actor: ContactActor; question: string; deps: Omit<SendCommandDeps, "db"> } {
  const actor = ctx.contactActor;
  const entry = sendTurnEntry(actor);
  if (!actor || !entry) throw new DataAccessError("forbidden", "Công cụ gửi tin chỉ dùng được trong tin riêng Zalo, với người được phép ra lệnh gửi.");
  return { actor, question: entry.hooks.question, deps: entry.hooks.deps };
}

/** Phụ thuộc của dịch vụ lệnh gửi cho lượt này: `db` của ctx + móc ứng dụng đã đăng ký (lịch làm việc, đánh thức việc nền, tải tệp). */
export function sendDepsOf(ctx: DataAccessContext): SendCommandDeps {
  return { ...turnOf(ctx).deps, db: ctx.db };
}

/** Nguyên văn tin người hỏi ở lượt này (bộ chặn sửa chữ so nội dung với ĐÚNG tin này). */
export const sendQuestionOf = (ctx: DataAccessContext): string => turnOf(ctx).question;

/** Cuộc + tin nguồn của lượt (việc báo kết quả về đây; tìm tệp vừa gửi). `threadId` null = không phải tin Zalo thật. */
export function sendSourceOf(ctx: DataAccessContext): { threadId: number | null; messageId: number | null; botAccountId: number | null; contactId: number } {
  const { actor } = turnOf(ctx);
  return { threadId: actor.threadId, messageId: actor.messageId, botAccountId: actor.botAccountId, contactId: actor.contactId };
}

/** Cuộc có phải Zalo thật (có dòng `zalo_group`, mã không phải `web-` / `demo-`) + người ra lệnh theo mã Zalo của người hỏi. */
export function resolveSendContext(ctx: DataAccessContext): Promise<ResolvedSendContext> {
  const { actor } = turnOf(ctx);
  return actorFactMemo(ctx, "send:context", async () => {
    let zaloThread = false;
    if (actor.threadId !== null) {
      const [threads] = await ctx.db.query<RowDataPacket[]>("SELECT zalo_group_id FROM zalo_group WHERE id = ? LIMIT 1", [actor.threadId]);
      zaloThread = Boolean(threads[0]) && !isFakeZaloId(String(threads[0].zalo_group_id ?? ""));
    }
    return { zaloThread, requester: zaloThread ? await loadSendRequester(ctx.db, actor.uid) : null };
  }).then((resolved) => {
    // Ghi lại mỗi lần (kể cả khi kết quả lấy từ bộ nhớ lượt): sổ có thể vừa được đăng ký lại cho cùng chủ thể
    recordResolvedSendContext(actor, resolved);
    return resolved;
  });
}

/** Người ra lệnh đã đủ quyền + cuộc Zalo thật, hoặc null (nơi gọi trả câu từ chối của lệnh gửi). */
export async function requireSendRequester(ctx: DataAccessContext): Promise<{ requester: SendRequester; threadId: number } | null> {
  const resolved = await resolveSendContext(ctx);
  const threadId = turnOf(ctx).actor.threadId;
  return resolved.zaloThread && resolved.requester && threadId !== null ? { requester: resolved.requester, threadId } : null;
}
