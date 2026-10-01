import { Button } from '@/shared/ui/button'
import { PopoverClose } from '@/shared/ui/popover'
import { cn } from '@/shared/utils/cn'
import { isValidFilterRow } from '../helpers/validators'
import { useFilterContext } from '../provider/filter-context'

export interface FilterFooterProps {
  /**
   * Bày cặp nút **Xóa hết / Áp dụng**.
   *
   * Tắt khi bộ lọc được nhúng vào một khung ĐÃ CÓ nút chính của nó — tờ trượt
   * lọc ở khổ điện thoại. Hai nút «Áp dụng» chồng nhau trong một tấm thì người
   * dùng phải đoán cái nào ăn, và đoán sai thì điều kiện vừa gõ mất trắng.
   */
  actions?: boolean
  /**
   * Nút đóng khung chứa sau khi bấm. `PopoverClose` chỉ chạy được BÊN TRONG một
   * `Popover.Root` — gọi ngoài đó là Radix ném lỗi ngữ cảnh, nên chế độ nhúng
   * phải tắt.
   */
  inPopover?: boolean
}

/** Chân bộ lọc: thêm dòng, đổi VÀ/HOẶC, xóa hết, áp dụng. */
export function FilterFooter({ actions = true, inPopover = true }: FilterFooterProps = {}) {
  const { config, state, addRow, reset, apply, setConjunction } = useFilterContext()
  const locale = config.locale ?? {}

  const canAddMore = state.rows.length < (config.maxRows ?? 10)
  // Cho phép Áp dụng cả khi không còn dòng nào hợp lệ — đó chính là thao tác gỡ lọc.
  const hasDraftRows = state.rows.length > 0
  const hasValidRow = state.rows.some(isValidFilterRow)

  const closeAfter = (node: React.ReactNode) =>
    inPopover ? <PopoverClose asChild>{node}</PopoverClose> : node

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2',
        actions && 'mt-3 border-t pt-3',
      )}
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={addRow} disabled={!canAddMore}>
          {locale.addFilter}
        </Button>

        {config.allowConjunctionToggle && state.rows.length > 1 && (
          <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            {(['and', 'or'] as const).map((conjunction) => (
              <button
                key={conjunction}
                type="button"
                onClick={() => setConjunction(conjunction)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  state.conjunction === conjunction
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {conjunction === 'and' ? locale.and : locale.or}
              </button>
            ))}
          </div>
        )}
      </div>

      {actions && (
        <div className="flex gap-2">
          {closeAfter(
            <Button variant="outline" size="sm" onClick={reset}>
              {locale.reset}
            </Button>,
          )}

          {closeAfter(
            <Button size="sm" onClick={apply} disabled={hasDraftRows && !hasValidRow}>
              {locale.apply}
            </Button>,
          )}
        </div>
      )}
    </div>
  )
}
