/** Tên để hiện: tên gọi quản trị đặt > tên Zalo của nhóm. */
export function getGroupName(group: { name: string; label: string }): string {
  return group.label || group.name || '(chưa rõ tên)'
}
