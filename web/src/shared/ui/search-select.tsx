import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/utils/cn'
//  Bỏ dấu để so — hàm dùng chung, xem `shared/utils/vn-text.ts`.
import { stripDiacritics } from '@/shared/utils/vn-text'

export interface SearchSelectOption {
  value: string
  label: string
}

interface SearchSelectProps {
  value: string
  onChange: (value: string) => void
  options: SearchSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  /** Hiện nút xóa lựa chọn khi đang có giá trị. */
  clearable?: boolean
  /**
   * Cho nhãn xuống dòng thay vì cắt cụt. Bật ở ô nằm trong bảng nhiều cột —
   * xem hợp đồng hiển thị CR-090 trong `CLAUDE.md`.
   */
  wrap?: boolean
  size?: 'sm' | 'default'
  /**
   * Gõ từ khóa NGAY TRÊN ô chọn (typeahead) thay vì mở ra mới có ô tìm riêng.
   * Ô lúc này là `<input>` full-width: bấm/gõ là lọc, chọn xong hiện nhãn đã chọn.
   * Mặc định tắt để giữ nguyên hành vi cũ ở mọi nơi đang dùng.
   */
  searchInTrigger?: boolean
  /**
   * Báo ra từ khóa người dùng vừa gõ.
   *
   * Khai nó khi danh sách được TRA PHÍA SERVER: component này vốn lọc trên
   * `options` đang cầm, mà có danh mục không nạp hết được (Sản phẩm 6803 dòng,
   * quá trần phân trang 5000) — nơi gọi phải tự đi hỏi rồi đổ `options` mới vào.
   *
   * ⚠️ Lọc tại chỗ VẪN chạy trên những gì đang cầm. Cố ý: nơi gọi hoãn vài trăm
   * mili giây mới gọi mạng, và trong khoảng đó danh sách cũ vẫn thu hẹp theo
   * từng phím — không có nó thì ô đứng im một nhịp rồi mới nhảy, đọc ra như treo.
   */
  onSearchChange?: (keyword: string) => void
  /**
   * Gắn lên chính ô chọn để `<Label htmlFor>` trỏ tới được.
   *
   * ⚠️ Không có nó thì nơi gọi hay với sang `aria-labelledby` — mà thuộc tính
   * CÓ GẠCH NGANG được TypeScript miễn kiểm tra thừa trên JSX, nên nó lọt
   * `tsc` sạch sẽ rồi bị component này bỏ rơi (không spread prop thừa). Kết quả:
   * `typecheck` xanh, ô chọn không có tên, nhãn bên trên trỏ vào hư không.
   */
  id?: string
  className?: string
}

/** Số dòng tối đa trong danh sách thả xuống — dài hơn thì bắt gõ tìm. */
const MAX_VISIBLE = 60

/**
 * Chọn MỘT mục từ danh sách dài, có ô tìm.
 *
 * `Select` của shadcn không tìm được, mà danh mục NCC / nhóm hàng / ĐVT lên tới
 * hàng trăm dòng — cuộn tay là không dùng nổi. Dựng trên `Popover + Input` chứ
 * không kéo thêm `cmdk` về chỉ để có một ô tìm.
 *
 * Giá trị đang lưu mà KHÔNG có trong `options` vẫn được hiện nguyên văn: dữ liệu
 * cũ hay có mã đã bị gỡ khỏi danh mục, giấu đi là người dùng tưởng ô trống rồi
 * chọn đè mất.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Chọn…',
  searchPlaceholder = 'Tìm…',
  emptyMessage = 'Không tìm thấy mục nào.',
  disabled,
  clearable,
  wrap,
  size = 'default',
  searchInTrigger,
  onSearchChange,
  id,
  className,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  //  Một chỗ đổi từ khóa cho cả hai kiểu ô tìm, để không phải nhớ gọi `onSearchChange`
  //  ở từng chỗ `setKeyword`.
  const changeKeyword = (next: string) => {
    setKeyword(next)
    onSearchChange?.(next)
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? value,
    [options, value],
  )

  const { matches, remaining } = useMemo(() => {
    const needle = stripDiacritics(keyword.trim())
    const rows = needle
      ? options.filter((option) =>
          [option.label, option.value].some((field) => stripDiacritics(field).includes(needle)),
        )
      : options
    return { matches: rows.slice(0, MAX_VISIBLE), remaining: Math.max(rows.length - MAX_VISIBLE, 0) }
  }, [options, keyword])

  function pick(optionValue: string) {
    onChange(optionValue)
    setOpen(false)
    changeKeyword('')
  }

  //  Danh sách kết quả — dùng chung cho cả hai kiểu (ô tìm riêng / gõ ngay trên ô).
  const optionList = (
    <div className="max-h-72 overflow-y-auto p-1">
      {matches.length === 0 && (
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      )}
      {matches.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => pick(option.value)}
          className={cn(
            'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
            option.value === value && 'bg-accent/50',
          )}
        >
          <Check className={cn('mt-0.5 size-4 shrink-0', option.value !== value && 'invisible')} />
          <span className="flex-1 whitespace-pre-wrap break-words">{option.label}</span>
        </button>
      ))}

      {/*  NÓI RA phần bị cắt. Danh sách nhân sự lên tới cả nghìn dòng, cắt còn 60 mà im
           lặng thì người dùng cuộn tới đáy, không thấy tên mình cần, rồi kết luận là hệ
           thống chưa có người đó. */}
      {remaining > 0 && (
        <p className="px-2 py-2 text-center text-xs text-muted-foreground">
          Còn {remaining} mục nữa — gõ để tìm.
        </p>
      )}
    </div>
  )

  //  Kiểu GÕ NGAY TRÊN Ô (typeahead): ô chọn chính là ô nhập từ khóa, full-width.
  if (searchInTrigger) {
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) changeKeyword('')
        }}
      >
        <PopoverAnchor asChild>
          <div ref={anchorRef} className={cn('relative w-full', className)}>
            <input
              ref={inputRef}
              id={id}
              type="text"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              //  Đang mở → ô là chỗ GÕ từ khóa; đóng lại → hiện nhãn đã chọn. Mở mà chưa
              //  gõ gì thì placeholder nhắc lại lựa chọn hiện tại cho người dùng khỏi quên.
              value={open ? keyword : selectedLabel}
              placeholder={open ? selectedLabel || searchPlaceholder : placeholder}
              onFocus={() => {
                setOpen(true)
                changeKeyword('')
              }}
              onClick={() => setOpen(true)}
              onChange={(event) => {
                changeKeyword(event.target.value)
                setOpen(true)
              }}
              className={cn(
                'flex w-full truncate rounded-md border border-input bg-transparent pr-9 text-left font-normal shadow-xs outline-none',
                'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                'disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
                size === 'sm' ? 'h-8 px-2 text-sm' : 'h-9 px-3 text-sm',
                !value && !open && 'text-muted-foreground',
              )}
            />
            {clearable && value && !open ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Xóa lựa chọn"
                onClick={(event) => {
                  event.preventDefault()
                  onChange('')
                }}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : (
              <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50" />
            )}
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          //  Giữ con trỏ Ở LẠI ô gõ, đừng để Radix nhảy focus vào danh sách (gõ tiếp được).
          onOpenAutoFocus={(event) => event.preventDefault()}
          //  bao-CR-475 — bấm vào CHÍNH Ô GÕ (nằm ngoài khung danh sách) thì Radix coi là
          //  «bấm ra ngoài» và đóng danh sách: ô hiện lại nhãn đã chọn, gõ tiếp bị nối vào
          //  nhãn cũ («Hợp đồng · HDb») nên không còn mục nào khớp. Bấm lại vào ô để đặt con
          //  trỏ là thao tác rất thường — cú bấm trong ô neo không được tính là ra ngoài.
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) event.preventDefault()
          }}
          className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        >
          {optionList}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) changeKeyword('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            //  `text-left` phải áp cho MỌI trường hợp: trình duyệt mặc định
            //  `button { text-align: center }`, mà chữ nằm trong `<span>` con
            //  nên `justify-between` của flex không cứu được — nó xếp vị trí
            //  cái span, còn chữ BÊN TRONG span vẫn căn giữa. Trước 25/08/2026
            //  `text-left` chỉ nằm ở nhánh `wrap`, nên ô chọn ở form dựng đứng
            //  hiện chữ giữa ô, lệch hẳn so với các ô nhập bên cạnh.
            //  `px-3` để thẳng hàng với `Input` (cũng `px-3`); cỡ `sm` dùng
            //  trong bảng thì giữ `px-2` cho đỡ chật.
            'w-full justify-between gap-1 text-left font-normal',
            size === 'sm' ? 'h-8 px-2 text-sm' : 'px-3',
            wrap ? 'h-auto min-h-8 items-start py-1.5' : 'truncate',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <span className={cn('flex-1', wrap ? 'whitespace-pre-wrap break-words' : 'truncate')}>
            {value ? selectedLabel : placeholder}
          </span>
          {clearable && value ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Xóa lựa chọn"
              className="shrink-0 transition-colors text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange('')
              }}
            >
              <X className="size-4" />
            </span>
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <div className="border-b p-2">
          <Input
            autoFocus
            placeholder={searchPlaceholder}
            value={keyword}
            onChange={(event) => changeKeyword(event.target.value)}
          />
        </div>
        {optionList}
      </PopoverContent>
    </Popover>
  )
}
