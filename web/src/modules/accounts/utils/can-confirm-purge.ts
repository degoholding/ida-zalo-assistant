/** Điều kiện bật nút Xóa tài khoản thử: gõ lại ĐÚNG nhãn (phân biệt hoa thường, không cắt khoảng trắng) và đã tick sao lưu. */
export function canConfirmPurge(typed: string, label: string, backupConfirmed: boolean): boolean {
  return backupConfirmed && label.length > 0 && typed === label
}
