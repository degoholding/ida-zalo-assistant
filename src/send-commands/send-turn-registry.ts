import type { ContactActor } from "../data-access/actors/contact-actor.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import type { SendRequester } from "./send-command-types.js";

// Sổ «ngữ cảnh gửi của lượt» (phase 12): thứ phía ứng dụng biết mà lõi MCP không tự có — nguyên văn tin người hỏi (bộ chặn sửa chữ của lệnh gửi
// so nội dung với ĐÚNG tin này), lịch làm việc, móc đánh thức việc nền / tải tệp. Khóa theo chính đối tượng `contactActor` của lượt (các bản sao ctx trong
// lượt dùng chung nó, như `actorFactMemo`), nên hết lượt là tự giải phóng. TỆP LÁ: chỉ kiểu, không import dịch vụ / cầu nối.
// Tin đến từ tin Zalo đã nhận (`buildSendChatContext` đăng ký), KHÔNG từ tham số mô hình; công cụ lõi chỉ đọc.

export interface SendTurnHooks {
  /** Nguyên văn tin vừa gõ. */
  question: string;
  /** Phụ thuộc của dịch vụ lệnh gửi trừ `db` (lõi dùng `ctx.db`). */
  deps: Omit<SendCommandDeps, "db">;
}

/** Kết quả phân giải «cuộc có phải Zalo thật + người ra lệnh» — công cụ `send_context` ghi vào sổ để `available` (đồng bộ) đọc lại. */
export interface ResolvedSendContext {
  zaloThread: boolean;
  /** null = không phải người nhận đang bật, không vai trò, hoặc tài khoản web đã tắt. */
  requester: SendRequester | null;
}

interface Entry {
  hooks: SendTurnHooks;
  resolved?: ResolvedSendContext;
}

const entries = new WeakMap<object, Entry>();

/** Đăng ký (hoặc làm mới) ngữ cảnh gửi cho lượt của `actor`. Gọi trước khi phiên MCP mở — công cụ gửi chỉ lên danh sách khi đã đăng ký. */
export function registerSendTurn(actor: ContactActor, hooks: SendTurnHooks): void {
  entries.set(actor, { hooks });
}

export function sendTurnEntry(actor: ContactActor | undefined): Entry | undefined {
  return actor ? entries.get(actor) : undefined;
}

export function recordResolvedSendContext(actor: ContactActor, resolved: ResolvedSendContext): void {
  const entry = entries.get(actor);
  if (entry) entry.resolved = resolved;
}
