import { MutationCache, QueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'

/**
 * Cấu hình mặc định cho React Query — áp cho toàn hệ thống, module không tự chỉnh
 * trừ khi có lý do rõ ràng (vd danh mục ít đổi thì tăng staleTime tại chỗ).
 */
export const queryClient = new QueryClient({
  /**
   * MỌI mutation thành công đều làm mới NHẬT KÝ THAO TÁC (`AuditTimeline`).
   *
   * ⚠️ Đặt ở đây, không đặt trong từng hook. Backend ghi `tab_audit_log` ở gần
   * như mọi lệnh ghi, mà khối «Lịch sử thao tác» lại đứng ngay dưới cái nút vừa
   * bấm: sửa xong mà nó vẫn ghi *"Chưa có thao tác nào"* thì người dùng đọc ra
   * là **hệ thống không ghi nhận việc mình vừa làm** — đúng lỗi bắt được
   * 04/09/2026 ở màn Quỹ phép năm (điều chỉnh tay lưu thật, dấu vết trên màn
   * vẫn rỗng). Bắt từng hook tự nhớ thì chỉ cần một người quên là lỗi quay lại,
   * và nó im lặng.
   *
   * Rẻ: khóa `['audit-logs', …]` chỉ tồn tại khi có một `AuditTimeline` đang
   * mở, nên trang không dựng nó thì lệnh này không sinh request nào.
   */
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
  }),

  defaultOptions: {
    queries: {
      // Dữ liệu ERP đổi liên tục nhưng không tới mức realtime: 30 giây là cân bằng
      // giữa "không gọi lại API mỗi lần chuyển tab" và "số liệu không quá cũ".
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status = (error as AxiosError).response?.status
        // 4xx là lỗi nghiệp vụ/phân quyền — thử lại cũng vẫn hỏng, đừng phí request.
        if (status && status >= 400 && status < 500) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Lỗi mutation đã được http-client toast sẵn — ở đây không retry để tránh
      // gửi trùng lệnh tạo/duyệt phiếu.
      retry: false,
    },
  },
})
