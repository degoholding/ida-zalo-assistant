import { apiGet } from '@/core/api'

/** Một dòng nhật ký — khớp response của `GET /api/audit-logs`. */
export interface AuditLogEntry {
  /** Id dòng nhật ký — để gắn hành động (vd nút Hoàn tác) vào đúng dòng. */
  id: number
  action: string
  /** Nhãn tiếng Việt do backend dựng sẵn ("Tạo mới", "Duyệt"…). */
  action_label: string
  message?: string
  entity_id: number
  /** Tên người thao tác, backend đã tra sẵn. */
  by: string
  at: string
  /**
   * Lượt gọi API đã sinh ra dòng này (bao-CR-407) — chìa khóa sang `/system/logs`.
   *
   * ⚠️ **RỖNG với mọi dòng ghi trước CR-312 P1.** Hồi đó chưa có `tab_request_log`
   * nên không có gì để nối; đừng dựng đường dẫn tới chuỗi trống, và đừng đọc chuỗi
   * rỗng thành «lượt gọi đã bị xóa».
   */
  request_id?: string
  /** Tên các trường đã đổi, backend nối sẵn bằng dấu phẩy. Rỗng khi không đổi gì. */
  changed_fields?: string
  /** Số trường đã đổi trong lượt gọi đó — `0` nghĩa là thao tác không sửa dữ liệu. */
  change_count?: number
}

/**
 * Nhật ký thao tác trên một bản ghi.
 *
 * ⚠️ Endpoint chỉ yêu cầu đăng nhập (`get_current_user`), KHÔNG kiểm tra quyền
 * theo entity — đừng dùng nó để suy ra người dùng có quyền xem bản ghi hay không.
 */
export const auditApi = {
  list: (entity: string, entityId: number, limit = 100) =>
    apiGet<AuditLogEntry[]>('/api/audit-logs', {
      params: { entity, entity_id: entityId, limit },
    }),
}
