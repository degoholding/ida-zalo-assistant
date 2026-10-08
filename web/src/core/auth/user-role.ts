/**
 * Vai trò người dùng web — khớp `UserRole` ở máy chủ (`src/constants.ts`); đổi bên đó thì sửa tay bên này.
 * Nằm ở `core/auth` vì cả thanh trên (hiện vai trò người đang đăng nhập) lẫn màn Người dùng cùng dùng.
 */
export const USER_ROLE = { admin: 1, manager: 2, staff: 3 } as const

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE]

export const USER_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: USER_ROLE.admin, label: 'Quản trị' },
  { value: USER_ROLE.manager, label: 'Quản lý' },
  { value: USER_ROLE.staff, label: 'Nhân viên' },
]

/** Nhãn vai trò; mã lạ (máy chủ thêm vai trò mà giao diện chưa biết) thì trả chuỗi rỗng chứ không đoán. */
export function getUserRoleLabel(role: unknown): string {
  return USER_ROLE_OPTIONS.find((option) => option.value === Number(role))?.label ?? ''
}
