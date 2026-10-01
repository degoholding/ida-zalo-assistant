import { SlidersHorizontal, type LucideIcon } from 'lucide-react'

import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { useFilterContext } from '../provider/filter-context'
import { FilterFooter } from './filter-footer'
import { FilterRowItem } from './filter-row'

export interface ConditionalFilterProps {
  align?: 'start' | 'center' | 'end'
  /** Dáng nút mở bộ lọc — `ghost` cho thanh công cụ phẳng kiểu Lark. */
  variant?: 'outline' | 'ghost'
  className?: string
  /**
   * Biểu tượng trên nút. Đổi được vì có màn để nút này CẠNH một nút khác cũng
   * dùng `SlidersHorizontal` (menu «Tùy chỉnh» của bảng Công việc) — hai biểu
   * tượng giống hệt nhau cạnh nhau thì không ai phân biệt được nút nào.
   */
  icon?: LucideIcon
  /**
   * Lớp CSS cho riêng chữ «Bộ lọc» trên nút — có để màn hẹp thu nút về còn biểu
   * tượng (`max-md:hidden`) mà không mất huy hiệu đếm điều kiện bên cạnh.
   *
   * ⚠️ Ẩn chữ thì `aria-label` phải bù vào, nếu không nút chỉ còn một hình và
   * trình đọc màn hình đọc ra khoảng lặng. Ở đây tên đọc được lấy thẳng từ
   * `locale.filters` nên nút luôn có tên, kể cả khi chữ đã ẩn.
   */
  labelClassName?: string
}

/**
 * Nút "Bộ lọc" + popover chứa các dòng điều kiện.
 *
 * Mặc định `align="start"` để khi nút nằm phía bên trái thanh công cụ (sau ô tìm kiếm),
 * khung popover mở rộng sang bên phải, không bị lệch/tràn ra khỏi mép trái màn hình.
 *
 * ⚠️ **Ở khổ điện thoại đừng dùng component này** — popover neo vào một nút,
 * mà nút đó trên máy 393px thì popover rộng `95vw` dán sát mép và không còn chỗ
 * cho hàng điều kiện. Nhúng `ConditionalFilterBody` vào tờ trượt lọc
 * (`QuickFilterSheet`) thay vì mở thêm một lớp nổi thứ hai; xem
 * `modules/hr/components/leave-rows-filter-bar.tsx` làm mẫu.
 */
export function ConditionalFilter({
  align = 'start',
  variant = 'outline',
  className,
  icon: Icon = SlidersHorizontal,
  labelClassName,
}: ConditionalFilterProps = {}) {
  const { config, activeCount } = useFilterContext()
  const locale = config.locale ?? {}

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size={variant === 'ghost' ? 'sm' : 'default'}
          aria-label={locale.filters}
          className={className}
        >
          <Icon />
          <span className={labelClassName}>{locale.filters}</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 rounded-full px-1.5">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align={align} className="w-[min(46rem,95vw)] p-3">
        <ConditionalFilterBody className="max-h-[24rem] overflow-y-auto pr-1" />
      </PopoverContent>
    </Popover>
  )
}

export interface ConditionalFilterBodyProps {
  /**
   * Bày cặp nút **Xóa hết / Áp dụng** ở chân. Tắt khi khung chứa đã có nút chính
   * của nó — xem `FilterFooterProps.actions`.
   */
  actions?: boolean
  /** Đang nằm trong một `Popover` — xem `FilterFooterProps.inPopover`. */
  inPopover?: boolean
  className?: string
}

/**
 * RUỘT của bộ lọc điều kiện: danh sách dòng + chân («Thêm điều kiện», VÀ/HOẶC,
 * và tùy chọn cặp nút Xóa hết / Áp dụng).
 *
 * Tách khỏi `ConditionalFilter` để cùng một bộ lọc dùng được ở hai chỗ mở khác
 * hẳn nhau — popover ở màn rộng, tờ trượt từ đáy ở màn hẹp — mà không phải chép
 * lại phần ruột. Chép ra hai bản là sớm muộn hai khổ màn lọc ra hai kết quả
 * khác nhau cho cùng một điều kiện.
 */
export function ConditionalFilterBody({
  actions = true,
  inPopover = false,
  className,
}: ConditionalFilterBodyProps = {}) {
  const { state, config } = useFilterContext()
  const locale = config.locale ?? {}

  return (
    <>
      <div className={className}>
        {state.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{locale.noFilters}</p>
        ) : (
          <div className="flex flex-col gap-2 md:gap-1">
            {state.rows.map((row) => (
              <FilterRowItem key={row.id} rowId={row.id} />
            ))}
          </div>
        )}
      </div>

      <FilterFooter actions={actions} inPopover={inPopover} />
    </>
  )
}
