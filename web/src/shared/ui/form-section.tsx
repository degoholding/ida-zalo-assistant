import type { ReactNode } from 'react'

import { cn } from '@/shared/utils/cn'

interface FormSectionProps {
  /** Tiêu đề nhóm, viết IN HOA (vd "ĐỊNH DANH", "HÓA ĐƠN & LIÊN HỆ"). */
  title: string
  children: ReactNode
  className?: string
}

/**
 * Một nhóm trường trong form chi tiết: tiêu đề nhỏ + vạch ngăn + lưới 2 cột.
 *
 * Form danh mục có 8–10 ô; xếp phẳng một mạch thì mắt không biết dừng ở đâu.
 * Chia nhóm giữ đúng cách bản `frontend` cũ trình bày để người dùng không phải
 * học lại bố cục.
 */
export function FormSection({ title, children, className }: FormSectionProps) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="border-b pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {/*
        `gap-y` nhỏ hơn `gap-x`: hai ô cùng một dòng cần khoảng hở ngang rộng để
        không dính nhau, còn theo chiều dọc thì nhãn của ô dưới đã tự tạo khoảng
        nghỉ — cộng thêm gap lớn nữa là form loãng, phải cuộn mới xem hết.

        Hai selector con bóp chặt bên TRONG mỗi ô (nhãn ↔ input ↔ dòng chú
        thích) và thu nhỏ chữ chú thích. Đặt ở đây thay vì sửa `FormItem` /
        `FormDescription` trong `shared/ui/form.tsx` vì đó là primitive dùng
        chung — sửa gốc là đổi luôn mọi form khác của hệ.
      */}
      <div
        className={cn(
          // `items-start`: ô grid mặc định `stretch`, nên ô nào cùng hàng với
          // một ô cao hơn (do có dòng chú thích) sẽ bị kéo giãn — `FormItem`
          // cũng là grid nên các hàng con của nó dãn theo, đẩy nhãn và ô nhập
          // rời nhau và lệch so với cột bên cạnh.
          'grid items-start gap-x-4 gap-y-2.5 sm:grid-cols-2',
          '[&_[data-slot=form-item]]:gap-1.5',
          '[&_[data-slot=form-description]]:text-xs',
        )}
      >
        {children}
      </div>
    </section>
  )
}
