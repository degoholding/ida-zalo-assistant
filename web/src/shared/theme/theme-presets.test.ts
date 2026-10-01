import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildThemeCss } from './build-theme-css'
import { DEFAULT_THEME_ID, themePresets } from './theme-presets'
import type { ThemeModeColors } from './theme-types'

/**
 * Bảng màu DEGO là bản sao của khối `:root` / `.dark` trong `index.css`. Hai chỗ
 * cùng giữ một bộ số thì sớm muộn lệch nhau, mà lệch thì không ai thấy: người
 * dùng để nguyên bảng màu mặc định vẫn ra màu khác so với lúc chưa có tính năng
 * này, đúng những chỗ khó nhận ra nhất (màu cột biểu đồ, nền rãnh thanh tỉ lệ).
 * Test này bắt lệch ngay lúc chạy `npm run test`.
 */

/** Bóc các dòng `--ten: giá trị;` trong một khối CSS. */
function parseCssVars(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`Không tìm thấy khối "${selector}" trong index.css`)

  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)

  const vars: Record<string, string> = {}
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim()
  }
  return vars
}

const testDir = dirname(fileURLToPath(import.meta.url))
const indexCss = readFileSync(resolve(testDir, '../../index.css'), 'utf8')
const rootVars = parseCssVars(indexCss, ':root {')
const darkVars = parseCssVars(indexCss, '.dark {')

const degoPreset = themePresets.find((preset) => preset.id === DEFAULT_THEME_ID)!

describe('bảng màu DEGO', () => {
  it('là bảng màu đầu tiên trong danh sách, để rơi về mặc định thì rơi đúng chỗ', () => {
    expect(themePresets[0].id).toBe(DEFAULT_THEME_ID)
  })

  it('khớp từng biến với khối :root của index.css', () => {
    const drift: string[] = []
    for (const [key, value] of Object.entries(degoPreset.light)) {
      // `chart-5` là màu MỚI thêm cho bảng màu, index.css chưa có — bỏ qua.
      if (key === 'chart-5') continue
      if (rootVars[key] !== value) drift.push(`--${key}: index.css=${rootVars[key]} ≠ preset=${value}`)
    }
    expect(drift).toEqual([])
  })

  it('khớp từng biến với khối .dark của index.css', () => {
    const drift: string[] = []
    for (const [key, value] of Object.entries(degoPreset.dark)) {
      if (key === 'chart-5') continue
      //  Khối `.dark` chỉ khai lại biến nào ĐỔI so với `:root`; biến không có ở
      //  đó thì thừa hưởng giá trị sáng, nên so với `:root` mới đúng.
      const expected = darkVars[key] ?? rootVars[key]
      if (expected !== value) drift.push(`--${key}: index.css=${expected} ≠ preset=${value}`)
    }
    expect(drift).toEqual([])
  })
})

describe('buildThemeCss', () => {
  it('sinh cả hai khối với độ ưu tiên cao hơn :root và .dark của index.css', () => {
    const css = buildThemeCss(degoPreset)
    expect(css).toContain('html:root {')
    expect(css).toContain('html.dark:root {')
  })

  it('suy ra token riêng của DEGO cho bảng màu ngoài không khai chúng', () => {
    const modernMinimal = themePresets.find((preset) => preset.id === 'modern-minimal')!
    expect(modernMinimal.light['chart-track']).toBeUndefined()

    const css = buildThemeCss(modernMinimal)
    expect(css).toContain('--chart-track: color-mix(')
    expect(css).toContain('--navy: var(--foreground)')
  })

  it('giữ nguyên token riêng khi bảng màu tự khai — bộ màu biểu đồ đã kiểm mù màu không bị công thức đè', () => {
    const css = buildThemeCss(degoPreset)
    expect(css).toContain('--chart-track: #cde2fb')
    expect(css).toContain('--chart-neutral: #cbd5e1')
  })

  it('không bảng màu nào đổi bo góc — bảng màu chỉ đổi MÀU, không đổi hình dạng', () => {
    //  Bo góc thuộc về bố cục chứ không thuộc bảng màu: bề rộng cột của các
    //  bảng dòng chứng từ đã cân theo bán kính hiện tại, để mỗi lựa chọn giao
    //  diện một kiểu bo là ô nhập, nút và thẻ lệch nhau. `--radius` nằm nguyên
    //  trong `index.css`.
    for (const preset of themePresets) {
      expect(buildThemeCss(preset)).not.toContain('--radius')
    }
  })

  it('không đụng tới --success/--warning/--info vì đó là màu ngữ nghĩa', () => {
    for (const preset of themePresets) {
      const css = buildThemeCss(preset)
      expect(css).not.toContain('--success:')
      expect(css).not.toContain('--warning:')
      expect(css).not.toContain('--info:')
    }
  })

  it('dùng nền tối của chính bảng màu cho --navy-solid ở CẢ hai chế độ', () => {
    //  `--navy-solid` là nền ĐẶC có chữ trắng đè lên (ảnh đại diện, lớp phủ).
    //  Lật nó theo chế độ nền là chữ trắng trên nền trắng.
    const vercel = themePresets.find((preset) => preset.id === 'vercel')!
    const css = buildThemeCss(vercel)
    const matches = [...css.matchAll(/--navy-solid: ([^;]+);/g)].map((m) => m[1])
    expect(matches).toHaveLength(2)
    expect(matches[0]).toBe(matches[1])
  })
})

describe('danh sách bảng màu', () => {
  it('không có id trùng — id là khoá lưu xuống máy chủ', () => {
    const ids = themePresets.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('bảng màu nào cũng khai đủ nền, chữ và màu chính cho cả hai chế độ', () => {
    const missing: string[] = []
    const required: (keyof ThemeModeColors)[] = ['background', 'foreground', 'primary', 'border']

    for (const preset of themePresets) {
      for (const mode of ['light', 'dark'] as const) {
        for (const key of required) {
          if (!preset[mode][key]) missing.push(`${preset.id}.${mode}.${key}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
