import { Check } from 'lucide-react'

import { cn } from '@/shared/utils/cn'
import { ROW_MIX, SURFACE_LINE_MIN_CONTRAST } from './build-theme-css'
import { ensureVisibleAgainst, mixHexColors } from './color-hue'
import type { ThemeModeColors, ThemePresetColors } from './theme-types'

/**
 * Một thẻ chọn bảng màu, kèm bản thu nhỏ của giao diện thật.
 *
 * Vẽ ô vuông màu thì không đủ để quyết: người ta cần thấy chữ trên nền có đọc
 * được không, viền có chìm không, cột biểu đồ có tách nhau không. Nên thẻ này
 * dựng đúng bộ khung hay gặp nhất — menu trái, thẻ nội dung, nút chính, BẢNG
 * DANH SÁCH và bốn cột biểu đồ — bằng chính màu của bảng màu đó.
 *
 * Có bảng danh sách vì đó là mặt bằng lớn nhất của ứng dụng, và cũng chính là
 * chỗ lòi ra lỗi ngày 27/08/2026 (nền hàng viết cứng bằng màu Tailwind gốc nên
 * không đổi theo bảng màu). Nền hàng ở đây tính lại bằng đúng tỉ lệ `ROW_MIX` mà
 * `build-theme-css.ts` dùng, nên xem trước thấy sao thì mở màn danh sách ra thấy
 * vậy.
 *
 * ⚠️ Chỗ này là NGOẠI LỆ hợp lệ của luật "không dùng `style` nội tuyến": màu ở
 * đây là DỮ LIỆU đọc lúc chạy, không phải token của giao diện đang bật, nên
 * không có class Tailwind nào diễn tả được.
 */

interface ThemePresetCardProps {
  preset: ThemePresetColors
  /** Xem trước theo chế độ nền nào — bám chế độ người dùng đang bật. */
  mode: 'light' | 'dark'
  selected: boolean
  onSelect: (id: string) => void
}

/** Đọc màu, thiếu thì trả về màu dự phòng để bản xem trước không bị thủng. */
function pick(colors: ThemeModeColors, key: keyof ThemeModeColors, fallback: string): string {
  return colors[key] ?? fallback
}

export function ThemePresetCard({ preset, mode, selected, onSelect }: ThemePresetCardProps) {
  const colors = preset[mode]

  const background = pick(colors, 'background', '#ffffff')
  const foreground = pick(colors, 'foreground', '#000000')
  const card = pick(colors, 'card', background)
  //  Kéo cho nổi được trên mặt thẻ, đúng như `build-theme-css.ts` làm — bảng màu
  //  Twitter khai `--border` gần trùng nền nên không vá thì bản xem trước vẽ ra
  //  một cái bảng không có lưới, còn màn thật thì có.
  const border = ensureVisibleAgainst(
    pick(colors, 'border', foreground),
    card,
    SURFACE_LINE_MIN_CONTRAST,
  )
  const primary = pick(colors, 'primary', foreground)
  const primaryForeground = pick(colors, 'primary-foreground', background)
  const muted = pick(colors, 'muted-foreground', foreground)
  const sidebar = pick(colors, 'sidebar', card)
  const sidebarAccent = pick(colors, 'sidebar-accent', primary)

  const bars = [
    pick(colors, 'chart-1', primary),
    pick(colors, 'chart-2', primary),
    pick(colors, 'chart-3', primary),
    pick(colors, 'chart-4', primary),
  ]

  //  Nền hàng bảng: bảng màu nào tự khai (DEGO) thì lấy khai, còn lại tính bằng
  //  đúng tỉ lệ mà CSS sẽ dùng.
  const rowHead = pick(colors, 'row-head', mixHexColors(card, foreground, ROW_MIX.head))
  const rowStripe = pick(colors, 'row-stripe', mixHexColors(card, foreground, ROW_MIX.stripe))
  const rowHover = pick(colors, 'row-hover', mixHexColors(card, primary, ROW_MIX.hover))
  const rows = [card, rowStripe, rowHover]

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(preset.id)}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border-2 p-2 text-left transition-colors',
        selected ? 'border-primary' : 'border-transparent hover:border-border',
      )}
    >
      <div
        className="relative h-32 w-full overflow-hidden rounded-md border"
        style={{ background, borderColor: border }}
      >
        {/* Menu trái */}
        <div className="absolute inset-y-0 left-0 w-8 p-1" style={{ background: sidebar }}>
          <div className="h-1.5 w-full rounded-full" style={{ background: sidebarAccent }} />
          <div className="mt-1 h-1.5 w-4/5 rounded-full opacity-40" style={{ background: muted }} />
          <div className="mt-1 h-1.5 w-3/5 rounded-full opacity-40" style={{ background: muted }} />
        </div>

        <div className="absolute inset-y-0 right-0 left-8 space-y-1.5 p-1.5">
          {/* Thẻ nội dung + nút chính */}
          <div
            className="flex items-center justify-between gap-1 rounded border p-1"
            style={{ background: card, borderColor: border }}
          >
            <div className="flex-1 space-y-1">
              <div className="h-1 w-3/4 rounded-full" style={{ background: foreground }} />
              <div className="h-1 w-1/2 rounded-full opacity-50" style={{ background: muted }} />
            </div>
            <div
              className="h-3 w-6 shrink-0 rounded-sm"
              style={{ background: primary, color: primaryForeground }}
            />
          </div>

          {/* Bảng danh sách: hàng tiêu đề, hàng thường, hàng vằn, hàng đang rê chuột */}
          <div className="overflow-hidden rounded border" style={{ borderColor: border }}>
            <div className="flex h-2.5 items-center gap-1 px-1" style={{ background: rowHead }}>
              <div className="h-1 w-1/3 rounded-full opacity-70" style={{ background: foreground }} />
              <div className="h-1 w-1/4 rounded-full opacity-70" style={{ background: foreground }} />
            </div>
            {rows.map((rowBackground, index) => (
              <div
                key={rowBackground + String(index)}
                className="flex h-2.5 items-center gap-1 px-1"
                style={{ background: rowBackground }}
              >
                <div
                  className="h-1 w-2/5 rounded-full opacity-45"
                  style={{ background: foreground }}
                />
                <div
                  className="h-1 w-1/5 rounded-full opacity-45"
                  style={{ background: foreground }}
                />
              </div>
            ))}
          </div>

          {/* Bốn cột biểu đồ — chỗ dễ thấy nhất khi bảng màu làm các chuỗi dính nhau */}
          <div className="flex h-7 items-end gap-1">
            {bars.map((color, index) => (
              <div
                key={color + String(index)}
                className="flex-1 rounded-sm"
                style={{ background: color, height: `${40 + index * 18}%` }}
              />
            ))}
          </div>
        </div>

      </div>

      <div className="px-0.5">
        {/*  Dấu tick nằm CẠNH NHÃN chứ không đè lên bản xem trước: góc trên bên
             phải của bản xem trước đã là chỗ vẽ nút chính, chồng lên đó thì nhìn
             ra thành "cái nút có dấu check". */}
        <p className="flex items-center gap-1 text-sm font-medium">
          <span className="truncate">{preset.label}</span>
          {selected && <Check className="size-3.5 shrink-0 text-primary" />}
        </p>
        {/*  `line-clamp-2` chứ không `truncate`: mô tả là thứ người dùng dựa vào
             để chọn, cắt cụt ở nửa chừng thì đúng phần nói màu gì lại mất. */}
        <p className="line-clamp-2 text-xs text-muted-foreground">{preset.description}</p>
      </div>
    </button>
  )
}
