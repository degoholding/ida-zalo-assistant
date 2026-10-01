import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, getDefaultClassNames, type DayPickerProps } from 'react-day-picker'
import { vi } from 'react-day-picker/locale'

import { buttonVariants } from '@/shared/ui/button'
import { cn } from '@/shared/utils/cn'

/**
 * Lịch chọn ngày (react-day-picker) đã khoác lớp áo của bộ giao diện chung.
 *
 * Không nạp `react-day-picker/style.css`: toàn bộ khung lưới được dựng lại bằng
 * class Tailwind ở dưới, nạp thêm CSS gốc chỉ tổ đá nhau. Vì vậy MỌI key bố cục
 * (`month_grid`, `week`, `weekdays`…) phải khai đủ, thiếu key nào là bể lưới đó.
 */
export type CalendarProps = DayPickerProps & { className?: string }

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const defaults = getDefaultClassNames()

  return (
    <DayPicker
      // Mặc định tiếng Việt: "Th 2 … CN", tuần bắt đầu từ thứ Hai.
      locale={vi}
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-4',
        month_caption: 'flex h-7 items-center justify-center',
        caption_label: 'text-sm font-medium capitalize',
        // Thanh điều hướng phủ lên dòng tiêu đề tháng để hai nút lùi/tới nằm
        // hai bên tên tháng mà không phải chia cột.
        nav: 'absolute inset-x-3 top-3 flex items-center justify-between',
        button_previous: cn(
          buttonVariants({ variant: 'outline', size: 'icon-sm' }),
          'size-7 p-0 opacity-60 hover:opacity-100 disabled:opacity-30',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline', size: 'icon-sm' }),
          'size-7 p-0 opacity-60 hover:opacity-100 disabled:opacity-30',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-8 text-[0.75rem] font-normal text-muted-foreground',
        week: 'mt-1 flex w-full',
        day: 'size-8 p-0 text-center text-sm',
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-8 rounded-md p-0 font-normal aria-selected:opacity-100',
        ),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        today: '[&>button]:border [&>button]:border-primary/60',
        outside: 'text-muted-foreground/50',
        disabled: 'text-muted-foreground/40 [&>button]:pointer-events-none',
        hidden: 'invisible',
        root: cn(defaults.root, 'relative'),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? <ChevronLeft {...rest} /> : <ChevronRight {...rest} />,
      }}
      {...props}
    />
  )
}
