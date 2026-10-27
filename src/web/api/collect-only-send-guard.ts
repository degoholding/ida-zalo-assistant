import type { Db } from "../../db/pool.js";
import { isCollectOnlyThread } from "../../sync/collect-only.js";
import { COLLECT_ONLY_MESSAGE, CollectOnlyAccountError } from "../../zalo/collect-only-account-error.js";
import { ApiError } from "./api-http.js";

// Ô soạn ở màn Hội thoại: cuộc không có bot Trợ lý nào (chỉ bot Normal — "chỉ lưu") thì quản trị cũng không gửi được.
// Kiểm TRƯỚC khi chọn tài khoản để báo đúng lý do kể cả khi tài khoản đang tắt; ZaloSender vẫn chặn lần nữa ở tầng gửi.

export const COLLECT_ONLY_ERROR_CODE = "collect_only";

export async function assertThreadSendable(db: Db, threadId: number): Promise<void> {
  if (await isCollectOnlyThread(db, threadId)) throw new ApiError(409, COLLECT_ONLY_ERROR_CODE, COLLECT_ONLY_MESSAGE);
}

/** Lỗi chặn gửi của tài khoản Normal (ném từ SyncService / ZaloSender) → 409 cùng câu báo; lỗi khác trả null. */
export function mapCollectOnlyError(error: unknown): ApiError | null {
  return error instanceof CollectOnlyAccountError ? new ApiError(409, COLLECT_ONLY_ERROR_CODE, COLLECT_ONLY_MESSAGE) : null;
}
