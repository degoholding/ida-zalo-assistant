import { useLocation } from 'react-router-dom'

/**
 * `state` mà một trang gài vào lượt điều hướng để trang ĐÍCH biết đường quay lại.
 *
 * ⚠️ Đi bằng `state` của router, **không đi bằng query `?from=`**: đường dẫn này
 * do chính mã nguồn dựng ra, đưa lên URL là mời người ta sửa tay — và nút *Quay
 * lại* trên một trang nội bộ mà nhận đích từ URL thì thành một cái mở chuyển
 * hướng. Kèm theo: link chia sẻ vẫn sạch, và `state` gắn với đúng mục lịch sử đó
 * nên bấm Tiến/Lùi vẫn khớp.
 */
export interface BackOrigin {
  /** Đường dẫn ĐẦY ĐỦ (kèm query) của trang đã dẫn tới đây. */
  from?: string
}

/**
 * Dựng `state` cho `navigate(...)` từ vị trí hiện tại.
 *
 * ⚠️ Phải kèm `search`: chỗ đứng của người dùng nằm trong query (tab đang mở,
 * bộ lọc, số trang). Chỉ mang `pathname` thì quay lại đúng trang nhưng sai chỗ.
 *
 * ```tsx
 * const location = useLocation()
 * navigate(appRoutes.hr.employeeDetail(id), { state: fromHere(location) })
 * ```
 */
export function fromHere(location: { pathname: string; search: string }): BackOrigin {
  return { from: `${location.pathname}${location.search}` }
}

/**
 * Đích của nút LÙI trên một trang chi tiết.
 *
 * ⚠️ **Nút lùi trỏ cứng về danh sách của chính nó là sai khi trang được mở từ
 * nơi khác.** Hồ sơ nhân sự mở từ tab *«Người đang giữ»* của một chức vụ, hay từ
 * bảng thành viên của một phòng ban, thì *«Danh sách nhân sự»* ném người dùng
 * sang một màn họ chưa từng đứng — và chỗ họ đang làm dở (tab, bộ lọc, số trang)
 * mất sạch. Trên điện thoại đây là nút lùi DUY NHẤT trong tầm mắt, nên nó phải
 * đúng.
 *
 * Không có `state` (gõ thẳng URL, mở tab mới, vào từ thông báo) thì rơi về danh
 * sách như cũ — luôn có một đích hợp lệ.
 *
 * `fromElsewhere` để trang tự đổi nhãn: đích đổi thì chữ phải đổi theo, không
 * thì nút ghi *«Danh sách nhân sự»* mà bấm vào lại ra chức vụ.
 */
export function useBackTarget(fallbackUrl: string): {
  url: string
  fromElsewhere: boolean
} {
  const from = (useLocation().state as BackOrigin | null)?.from
  return from ? { url: from, fromElsewhere: true } : { url: fallbackUrl, fromElsewhere: false }
}
