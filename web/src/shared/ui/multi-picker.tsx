import { Check, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/utils/cn'

/**
 * Định danh của một mục.
 *
 * Cho phép cả CHUỖI vì có chỗ mục không phải một bản ghi đơn mà là một CẶP —
 * ví dụ (phòng ban × pháp nhân) ở khối phạm vi áp dụng của văn bản, khóa dạng
 * `"4:1"`. Ép về số thì hai phòng cùng tên ở hai công ty dính làm một.
 */
export type MultiPickerId = number | string

export interface MultiPickerOption {
  id: MultiPickerId
  label: string
  /** Chữ mờ bên phải: mã, số hiệu, chức danh… — thứ để phân biệt hai dòng trùng tên. */
  hint?: string
  /**
   * Ảnh đại diện đứng TRƯỚC nhãn (logo công ty, ảnh nhân sự…). Khai trường này —
   * kể cả để chuỗi rỗng — là bật cột avatar; bỏ hẳn thì dòng vẫn thuần chữ như cũ.
   * Rỗng / hỏng ảnh thì rơi về chữ cái đầu của nhãn.
   */
  avatar?: string
}

/**
 * `Id` bám theo kiểu của `value`, nên nơi gọi truyền `number[]` vẫn nhận lại
 * `number[]` ở `onChange` — không phải ép kiểu ở mọi chỗ đang dùng.
 */
interface MultiPickerProps<Id extends MultiPickerId = MultiPickerId> {
  value: Id[]
  onChange: (ids: Id[]) => void
  options: (Omit<MultiPickerOption, 'id'> & { id: Id })[]
  placeholder: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  /** Lớp bề rộng cho danh sách thả xuống (mặc định `w-80`) — nới rộng khi nhãn dài (vd tên công ty + MST). */
  contentClassName?: string
  /** Đưa nút "Bỏ hết" thành dấu **X ở bên phải TRONG khung chọn** (bỏ hàng "Bỏ hết" bên dưới). */
  clearInTrigger?: boolean
  /**
   * Hiện các mục ĐÃ CHỌN dạng chip NGAY TRONG khung chọn (thay cho "Đã chọn N") và
   * bỏ dải chip bên dưới. Hợp với ô chọn ít mục, nhãn cần thấy ngay (vd công ty).
   */
  chipsInTrigger?: boolean
  /**
   * Ẩn HẲN dải chip (cả trong khung lẫn bên dưới) — khung chỉ còn là nút chọn "Đã
   * chọn N". Dùng khi nơi gọi tự bày danh sách đã chọn theo cách riêng (vd thẻ công ty).
   */
  hideChips?: boolean
  /**
   * Khung chọn nói TÊN mục đầu kèm đuôi «+n», và bỏ hẳn dải chip (bao-CR-423).
   *
   * Dành cho ô lọc trên thanh công cụ: ở đó ô cao đúng một hàng và đứng cạnh bốn
   * năm ô khác, nên chip bên dưới đẩy cả bảng xuống còn "Đã chọn 1" thì kém hẳn
   * ô chọn một giá trị nó vừa thay thế — người dùng phải mở ra mới biết đang lọc
   * cái gì. Tên đầy đủ của mọi mục nằm ở thuộc tính `title` để rê chuột xem được.
   */
  summaryInTrigger?: boolean
  /**
   * Bỏ hàng «Chọn tất cả» trên đầu danh sách.
   *
   * ⚠️ Dùng khi «chọn hết» là một thao tác gần như luôn SAI, không phải khi
   * danh sách dài. Ví dụ ô *Hồ sơ tiên quyết*: chọn mọi tờ trong kho làm tiên
   * quyết cho một tờ thì tờ đó khóa gần như vĩnh viễn, mà nút lại nằm đúng chỗ
   * dễ bấm nhầm nhất — ngay trên mục đầu tiên.
   */
  hideSelectAll?: boolean
}

/** Số dòng tối đa trong danh sách thả xuống — dài hơn thì bắt gõ tìm. */
const MAX_VISIBLE = 50

/**
 * Số chip bày ra trước khi gộp lại; muốn xem hết thì bấm «Xem thêm».
 *
 * Khách báo 25/08/2026: sổ văn bản chọn ~200 người xem, mỗi người một chip nên
 * dải chip cao hơn cả màn hình — ô «Người quản lý» ngay dưới bị đẩy đi mất,
 * người dùng tưởng form hỏng. Mười chip là đủ nhận ra "đang chọn những ai" mà
 * vẫn gọn trong hai hàng (khách chốt con số này).
 */
const MAX_CHIPS = 10

/**
 * Chiều cao tối đa của dải chip khi ĐÃ bung.
 *
 * Bung ra mà thả trôi thì 200 chip lại dựng đúng bức tường vừa dỡ. Cho nó cuộn
 * trong khung riêng: xem được hết mà phần dưới của form không bị đẩy đi đâu cả.
 */
const EXPANDED_MAX_HEIGHT = 'max-h-44 overflow-y-auto'

/**
 * Chọn NHIỀU mục từ một danh sách có sẵn: nút mở, ô tìm, danh sách tick, và dải
 * chip của những mục đã chọn.
 *
 * Dùng cho nhân sự, loại văn bản, văn bản… — bất cứ thứ gì rút gọn được về
 * `{id, label, hint}`. Trước đây chỉ có bản riêng cho nhân sự, và mỗi lần cần
 * chọn nhiều thứ khác lại chép ra một bản gần giống.
 */
export function MultiPicker<Id extends MultiPickerId = MultiPickerId>({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Tìm…',
  emptyMessage = 'Không tìm thấy mục nào.',
  disabled,
  contentClassName,
  clearInTrigger = false,
  chipsInTrigger = false,
  hideChips = false,
  summaryInTrigger = false,
  hideSelectAll = false,
}: MultiPickerProps<Id>) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  //  Bung hết dải chip. Mặc định gập lại — xem `MAX_CHIPS`.
  const [xemHetChip, setXemHetChip] = useState(false)

  const selected = useMemo(
    () => value.map((id) => options.find((item) => item.id === id)).filter(Boolean) as typeof options,
    [value, options],
  )

  // Giữ CẢ danh sách lọc được, không chỉ phần bày ra: nút "Chọn tất cả" phải áp
  // cho mọi mục khớp từ khóa, kể cả những mục bị `MAX_VISIBLE` cắt bớt — người
  // dùng gõ tìm rồi bấm chọn tất cả là muốn hết chỗ đó, không phải 50 dòng đầu.
  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return options
    return options.filter((item) =>
      [item.label, item.hint].some((field) => (field ?? '').toLowerCase().includes(needle)),
    )
  }, [options, keyword])

  const matches = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered])

  const exceedsCollapseLimit = selected.length > MAX_CHIPS
  const visibleChips = xemHetChip ? selected : selected.slice(0, MAX_CHIPS)

  //  Tên mọi mục đã chọn — vừa là câu tóm tắt trong khung, vừa là `title` để rê
  //  chuột đọc đủ khi danh sách dài hơn bề ngang ô.
  const selectedLabels = selected.map((item) => item.label)
  const summaryText =
    selected.length > 1 ? `${selectedLabels[0]} +${selected.length - 1}` : (selectedLabels[0] ?? '')

  /** Đã tick hết phần đang lọc chưa — quyết định nút là "Chọn" hay "Bỏ chọn". */
  const allPicked = filtered.length > 0 && filtered.every((item) => value.includes(item.id))

  function toggle(id: Id) {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  }

  /** Tick / bỏ tick TOÀN BỘ phần đang lọc, giữ nguyên các mục đã chọn ngoài đó. */
  function toggleAll() {
    const ids = filtered.map((item) => item.id)
    if (allPicked) {
      const dropped = new Set(ids)
      onChange(value.filter((id) => !dropped.has(id)))
      return
    }
    onChange([...value, ...ids.filter((id) => !value.includes(id))])
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              'w-full justify-start font-normal',
              chipsInTrigger && !hideChips && selected.length > 0 && 'h-auto min-h-9 flex-wrap gap-1 py-1.5',
              selected.length === 0 && 'text-muted-foreground',
            )}
          >
            <Search className="size-4 shrink-0 self-center" />
            {chipsInTrigger && !hideChips && selected.length > 0 ? (
              //  Hiện thẳng các mục ĐÃ CHỌN (chip có X riêng) trong khung — không "Đã chọn N".
              selected.map((item) => (
                <Badge key={item.id} variant="secondary" className="gap-1 font-normal">
                  {item.avatar !== undefined && <OptionAvatar src={item.avatar} label={item.label} />}
                  <span className="max-w-[16rem] truncate">{item.label}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Bỏ ${item.label}`}
                    className="text-muted-foreground hover:text-foreground"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggle(item.id)
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            ) : (
              /*  Có chọn rồi thì nút nói SỐ LƯỢNG, không lặp lại câu mời chọn —
                  trừ khi nơi gọi xin câu tóm tắt có TÊN (`summaryInTrigger`). */
              <span
                className="flex-1 truncate self-center text-left"
                title={summaryInTrigger && selected.length > 0 ? selectedLabels.join(', ') : undefined}
              >
                {selected.length === 0
                  ? placeholder
                  : summaryInTrigger
                    ? summaryText
                    : `Đã chọn ${selected.length}`}
              </span>
            )}
            {/*  Dấu X BỎ HẾT nằm ngay trong khung chọn (khi bật `clearInTrigger`).
                 `onPointerDown` chặn mở popover — bấm X là xóa, không phải mở danh sách. */}
            {clearInTrigger && selected.length > 0 && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Bỏ hết"
                className="ml-auto self-center rounded-sm text-muted-foreground opacity-70 hover:text-destructive hover:opacity-100"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onChange([])
                }}
              >
                <X className="size-4" />
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn('p-0', contentClassName ?? 'w-80')}>
          <div className="border-b p-2">
            <Input
              autoFocus
              placeholder={searchPlaceholder}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          {filtered.length > 0 && !hideSelectAll && (
            <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
              <button
                type="button"
                onClick={toggleAll}
                className="rounded-sm px-1 py-0.5 text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {allPicked ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                <span className="ml-1 font-normal text-muted-foreground tabular-nums">
                  ({filtered.length})
                </span>
              </button>
              {/* Nhắc rõ nút đang áp cho phần lọc được, không phải cả danh sách. */}
              {keyword.trim() && (
                <span className="text-xs text-muted-foreground">theo từ khóa đang tìm</span>
              )}
            </div>
          )}

          <div className="max-h-72 overflow-y-auto p-1">
            {matches.length === 0 && (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            )}
            {matches.map((item) => {
              const checked = value.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
                    checked && 'bg-accent/50',
                  )}
                >
                  <Check className={cn('size-4 shrink-0', !checked && 'invisible')} />
                  {item.avatar !== undefined && <OptionAvatar src={item.avatar} label={item.label} />}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint && (
                    <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
                  )}
                </button>
              )
            })}

            {/* Danh sách bị cắt bớt thì phải nói ra, không thì nhìn như đã hết
                mục — trong khi "Chọn tất cả" vẫn tính cả phần chưa bày. */}
            {filtered.length > matches.length && (
              <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                Còn {filtered.length - matches.length} mục nữa — gõ để thu hẹp danh sách.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/*  Dải chip dưới ô — bỏ khi hiện chip trong khung (`chipsInTrigger`) hoặc khi
           nơi gọi tự bày danh sách đã chọn (`hideChips`). */}
      {!chipsInTrigger && !hideChips && !summaryInTrigger && selected.length > 0 && (
        <div className="space-y-1.5">
          {/*  Dải chip. Khi bung thì đóng khung + cho cuộn, không để nó đẩy phần
               dưới của form đi (xem `CAO_TOI_DA_KHI_BUNG`). */}
          <div
            className={cn(
              'flex flex-wrap gap-1',
              xemHetChip && exceedsCollapseLimit && `${EXPANDED_MAX_HEIGHT} rounded-md border p-2`,
            )}
          >
            {visibleChips.map((item) => (
              <Badge key={item.id} variant="secondary" className="gap-1 font-normal">
                {item.avatar !== undefined && <OptionAvatar src={item.avatar} label={item.label} />}
                {item.label}
                <button
                  type="button"
                  aria-label={`Bỏ ${item.label}`}
                  onClick={() => toggle(item.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>

          {/*  HÀNG THAO TÁC riêng, không trộn vào dải chip: hai nút này không
               phải là "một người đã chọn" nên đứng lẫn giữa các chip là đọc
               nhầm. Trái = xem thêm / thu gọn, phải = bỏ hết. */}
          {(exceedsCollapseLimit || (!clearInTrigger && selected.length > 1)) && (
            <div className="flex items-center justify-between gap-2">
              {exceedsCollapseLimit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={() => setXemHetChip((truoc) => !truoc)}
                >
                  {xemHetChip ? (
                    <>
                      <ChevronUp className="size-3.5" />
                      Thu gọn
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-3.5" />
                      Xem thêm {selected.length - MAX_CHIPS}
                    </>
                  )}
                </Button>
              ) : (
                <span />
              )}

              {!clearInTrigger && selected.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => onChange([])}
                  disabled={disabled}
                >
                  Bỏ hết
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Avatar nhỏ đứng trước nhãn; ảnh rỗng/hỏng thì hiện chữ cái đầu của nhãn. */
function OptionAvatar({ src, label }: { src: string; label: string }) {
  const initial = (label.trim()[0] || '?').toUpperCase()
  return (
    <Avatar size="sm" className="size-5 shrink-0">
      {src && <AvatarImage src={src} alt="" className="object-contain" />}
      <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
    </Avatar>
  )
}
