import type { AskerAccess } from "./infra/asker-access.js";
import { alertPendingProvider } from "./alert-chat-commands.js";
import type { ChatCommandContext } from "./chat-commands.js";
import { sendPendingProvider } from "../send-commands/send-command-chat.js";
import { runWriteCodeConfirm, writePendingProvider } from "./write-confirm-chat.js";

// «đồng ý» / «hủy» TRẦN (không kèm mã): chọn kho chờ xác nhận mới nhất trong các nhà cung cấp rồi xác nhận / hủy ở đó. «ok», «không»…
// chỉ là lệnh khi người này ĐANG có đề xuất chờ; ngược lại là câu nói thường — trả null để AI trả lời. Mỗi họ cung cấp provider ở tệp của mình.

/** Một kho đang có đề xuất chờ của người hỏi. `at` cùng nguồn giờ app (ms) để so «cái nào mới nhất». */
export interface PendingStore {
  at: number;
  confirm(): Promise<string | null>;
  cancel(): Promise<string | null>;
}

export interface PendingStoreInput {
  chat: ChatCommandContext;
  /** Ngữ cảnh truy cập đã phân giải (null nếu nơi gọi không có). */
  access: AskerAccess | null;
}

export interface PendingStoreProvider {
  /** Kho của provider này nếu người hỏi đang có đề xuất chờ; không có = null. */
  latest(input: PendingStoreInput): Promise<PendingStore | null>;
}

/**
 * Thứ tự mảng = thứ tự ưu tiên khi hai kho cùng `at` (gửi tin → cảnh báo → nháp ghi, như trước khi provider hóa).
 * Phase 10 / 12 đổi ruột provider của họ mình, không sửa mảng này.
 */
const PROVIDERS: readonly PendingStoreProvider[] = [sendPendingProvider, alertPendingProvider, writePendingProvider];

/** «đồng ý» / «hủy» trơn. null = không có kho nào đang chờ (để AI trả lời). */
export async function runPlainConfirmCancel(
  chat: ChatCommandContext, kind: "confirm" | "cancel", providers: readonly PendingStoreProvider[] = PROVIDERS,
): Promise<string | null> {
  const access = chat.access ? await chat.access() : null;
  const stores: PendingStore[] = [];
  for (const provider of providers) {
    const store = await provider.latest({ chat, access });
    if (store) stores.push(store);
  }
  // sort ổn định giảm dần: hai kho cùng `at` thì kho đứng trước trong PROVIDERS thắng
  const latest = stores.sort((a, b) => b.at - a.at)[0];
  if (!latest) return null;
  return kind === "cancel" ? latest.cancel() : latest.confirm();
}

/** «đồng ý <mã>» / «hủy <mã>»: mã của nháp ghi; không có nháp nào đang mở thì coi là câu thường (null). */
export async function runCodedConfirmCancel(chat: ChatCommandContext, kind: "confirm" | "cancel", code: string): Promise<string | null> {
  const access = chat.access ? await chat.access() : null;
  return runWriteCodeConfirm(chat, access, kind, code);
}
