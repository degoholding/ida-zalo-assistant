import { useMemo, useState } from 'react'

import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/utils/cn'
import { ThemePresetCard } from './theme-preset-card'
import { themePresets } from './theme-presets'
import { useThemeStore } from './theme-store'
import { useColorScheme } from './use-color-scheme'

/**
 * Lưới chọn bảng màu. Dùng chung cho phân hệ Giao diện và tab «Giao diện» ở
 * Trang cá nhân, nên nằm ở `shared/` chứ không thuộc phân hệ nào.
 *
 * Bấm là ĐỔI NGAY, không có nút Lưu: đổi màu là loại thay đổi phải nhìn mới
 * biết có ưng không, bắt bấm Lưu rồi mới thấy thì người dùng phải thử đi thử
 * lại. Việc ghi xuống máy chủ do `useThemeStore` lo, im lặng ở nền.
 */

interface ThemePresetPickerProps {
  /** Số cột lớn nhất — trang phân hệ rộng hơn tab hồ sơ. */
  columnsClassName?: string
}

export function ThemePresetPicker({
  //  Mốc 5 cột đặt ở  1280px — đó là bề ngang "máy để bàn" theo yêu cầu, chứ
  //  không phải `xl` (1280px) hay `2xl` (1536px) của Tailwind, nên phải viết
  //  biến thể tuỳ ý. Dưới mốc đó giữ 4 cột: 5 thẻ ở khổ ~1024px thì bản thu nhỏ
  //  hẹp tới mức không còn đọc được bảng màu.
  columnsClassName = 'sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
}: ThemePresetPickerProps) {
  const themeId = useThemeStore((state) => state.themeId)
  const setTheme = useThemeStore((state) => state.setTheme)
  const [keyword, setKeyword] = useState('')

  //  Vẽ thẻ xem trước theo ĐÚNG chế độ nền đang bật; đổi Sáng/Tối là 42 thẻ vẽ
  //  lại theo. Xem `use-color-scheme.ts` về việc vì sao không hỏi `next-themes`.
  const mode = useColorScheme()

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return themePresets
    return themePresets.filter(
      (preset) =>
        preset.label.toLowerCase().includes(needle) ||
        preset.description.toLowerCase().includes(needle),
    )
  }, [keyword])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="Tìm bảng màu theo tên hoặc mô tả…"
          className="max-w-sm"
        />
        <p className="text-xs text-muted-foreground">
          {filtered.length}/{themePresets.length} bảng màu · bản thu nhỏ vẽ theo chế độ nền đang bật
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Không có bảng màu nào khớp “{keyword}”.
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Bảng màu giao diện"
          className={cn('grid grid-cols-2 gap-3', columnsClassName)}
        >
          {filtered.map((preset) => (
            <ThemePresetCard
              key={preset.id}
              preset={preset}
              mode={mode}
              selected={preset.id === themeId}
              onSelect={setTheme}
            />
          ))}
        </div>
      )}
    </div>
  )
}
