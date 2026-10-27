import type { ThreadAccount } from '../types/conversation'

/** `bot_account.kind`: 0 = Trợ lý (gửi / trả lời được), 1 = Chỉ thu thập — trùng `BotAccountKind` ở máy chủ. */
export const ASSISTANT_ACCOUNT_KIND = 0

/**
 * Nhãn tài khoản Zalo gọn trên một dòng của cột trái (27/10/2026): tên tài khoản đầu (Trợ lý đứng trước, máy chủ đã xếp),
 * nhiều tài khoản thì thêm "+n". `title` là đủ tên kèm loại để rê chuột xem. Không có tài khoản thì null (không vẽ).
 */
export function accountTag(accounts: ThreadAccount[] | undefined): { text: string; title: string } | null {
  if (!accounts?.length) return null
  const [first, ...rest] = accounts
  return {
    text: rest.length ? `${first.name} +${rest.length}` : first.name,
    title: accounts.map((account) => `${account.name} (${account.kind_label})`).join(', '),
  }
}

/** Tham số URL `acc=3,5` ↔ danh sách id; rác thì bỏ. */
export function parseAccountFilter(raw: string | null): number[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map((value) => Number(value)).filter((id) => Number.isInteger(id) && id > 0))]
}
