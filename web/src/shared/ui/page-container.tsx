import type { ReactNode } from 'react'

import { cn } from '@/shared/utils/cn'

/** Khung nội dung chuẩn cho mọi trang bên trong phân hệ — giữ lề đồng nhất. */
export function PageContainer({
  children,
  className,
  fill = false,
}: {
  children: ReactNode
  className?: string
  /**
   * Trang chiếm trọn chiều cao khung, phần cuộn nằm BÊN TRONG (dùng cho màn
   * danh sách: bảng cao hết màn hình, thanh phân trang dính đáy).
   *
   * Mặc định `false` — trang chi tiết vẫn để nội dung tự dài ra và cuộn cả
   * trang như bình thường.
   */
  fill?: boolean
}) {
  return (
    <div
      className={cn('p-4 lg:p-6', fill && 'flex h-full min-h-0 flex-col', className)}
    >
      {children}
    </div>
  )
}
