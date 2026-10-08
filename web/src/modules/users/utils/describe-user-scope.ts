import { USER_ROLE } from '@/core/auth/user-role'

/**
 * Câu ngắn nói người dùng thấy những nhóm nào trên web.
 *
 * Quản trị luôn thấy mọi nhóm dù ô «Thấy mọi nhóm» đang tắt (máy chủ bỏ qua phạm vi với quản trị) — nói theo
 * `all_groups` thì cột danh sách sẽ ghi «0 nhóm» cho chính người toàn quyền.
 */
export function describeUserScope(user: { role: unknown; all_groups: boolean; group_count: number }): string {
  if (Number(user.role) === USER_ROLE.admin) return 'Mọi nhóm (quản trị)'
  if (user.all_groups) return 'Mọi nhóm'
  if (!user.group_count) return 'Chưa có nhóm nào'
  return `${user.group_count} nhóm`
}
