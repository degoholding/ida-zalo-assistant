import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@/shared/ui/badge'
import type { IdentityChip } from '@/shared/ui/record-identity-card'

interface CrudRecordCardProps {
  /** Dòng đầu — thứ người ta nhận ra bản ghi bằng nó (tên danh mục, ngày lễ…). */
  title: ReactNode
  /** Dòng phụ dưới tiêu đề: mã, ngày, ghi chú ngắn. */
  subtitle?: ReactNode
  /**
   * Huy hiệu mô tả nhanh — **dùng lại đúng `CrudConfig.chips`** của trang chi
   * tiết. Cùng một bản ghi thì hai màn phải nói cùng một câu; khai riêng một bộ
   * cho thẻ là hai chỗ trôi khác nhau sau vài lần sửa.
   */
  chips?: IdentityChip[]
}

/**
 * Một bản ghi DANH MỤC ở khổ điện thoại — xem `CrudConfig.mobileCard`.
 *
 * Khung chung cho mọi màn CRUD: bảng danh mục nào cũng có *một cái tên* + *vài
 * thuộc tính ngắn*, nên thẻ chỉ cần ba tầng — tên, dòng phụ, huy hiệu. Màn nào
 * cần bày khác hẳn (số liệu lớn, ảnh) thì tự dựng thẻ riêng và truyền thẳng vào
 * `mobileCard`, khung này không chặn.
 */
export function CrudRecordCard({ title, subtitle, chips = [] }: CrudRecordCardProps) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <span className="block truncate font-medium text-foreground">{title}</span>

        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              //  ⚠️ Huy hiệu `ok` ở đây là `secondary` (nền nhạt), KHÁC thẻ danh
              //  tính của trang chi tiết (nền primary đặc). Trang chi tiết có
              //  ĐÚNG MỘT bản ghi nên nền đặc là điểm nhấn; danh sách có hai chục
              //  thẻ mà thẻ nào cũng «Đang dùng» — hai chục mảng xanh đặc xếp
              //  dọc thì trạng thái BÌNH THƯỜNG lại là thứ hét to nhất màn hình,
              //  trong khi thứ cần nhặt ra là dòng «Ngừng / Ẩn».
              <Badge
                key={chip.text}
                variant={chip.tone === 'ok' ? 'secondary' : 'outline'}
                className={chip.tone === 'code' ? 'font-mono' : undefined}
              >
                {chip.icon && <chip.icon />}
                {chip.text}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/*  Mũi tên nói THẺ NÀY BẤM ĐƯỢC: màn cảm ứng không có con trỏ đổi hình khi
           rê qua, nên phải nói bằng hình. */}
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>
  )
}
