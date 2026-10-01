import { ensureVisibleAgainst } from './color-hue'
import type { ThemeModeColors, ThemePresetColors } from './theme-types'

/**
 * Dựng khối CSS của một bảng màu, gồm CẢ hai chế độ nền một lượt.
 *
 * ## Vì sao sinh CSS thay vì ghi `style` thẳng lên `<html>`
 * Ghi biến vào `documentElement.style` thì mỗi lần người dùng bấm Sáng/Tối lại
 * phải chạy JS ghi lại toàn bộ biến — mà `next-themes` chỉ đổi class `.dark`,
 * không báo cho ai cả. Sinh sẵn hai khối `html:root` + `html.dark:root` để CSS
 * tự chọn, JS không phải xen vào lúc đổi chế độ nền; hiệu ứng loang của
 * View Transitions cũng chạy đúng vì màu đổi trong CÙNG một khung hình.
 *
 * ## Vì sao là `html:root` chứ không phải `:root`
 * Độ ưu tiên. `index.css` khai `:root` (0,1,0) và `.dark` (0,1,0); trong chế độ
 * phát triển Vite chèn/ghép lại thẻ style theo thứ tự không đoán trước được, nên
 * dựa vào "khối nào đứng sau thì thắng" là hên xui. `html:root` (0,1,1) và
 * `html.dark:root` (0,2,1) luôn thắng, khỏi phụ thuộc thứ tự.
 */

/** Biến MÀU của shadcn: chép thẳng từ bảng màu, khóa nào thiếu thì bỏ qua. */
const PASSTHROUGH_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
  //  ⚠️ CỐ Ý KHÔNG có `radius`. Bảng màu chỉ đổi MÀU, không đổi hình dạng.
  //  Bán kính bo góc do `index.css` giữ (0.5rem) và mọi bảng màu dùng chung:
  //  bo góc là một phần của bố cục chứ không phải của bảng màu — đổi nó thì
  //  ô nhập, nút, thẻ và ô của các bảng dòng chứng từ lệch nhau theo từng
  //  lựa chọn giao diện, mà bề rộng cột thì đã cân sẵn theo bán kính hiện tại.
] as const

/**
 * Tỉ lệ trộn của bốn nền hàng bảng, tính theo phần của `--card` giữ lại.
 *
 * Khai riêng vì thẻ chọn bảng màu vẽ lại đúng cái bảng này ở dạng thu nhỏ
 * (`theme-preset-card.tsx`) — hai chỗ tự gõ số thì sớm muộn lệch nhau, và lệch
 * kiểu đó thì bản xem trước nói dối chính cái nó đang xem trước.
 */
export const ROW_MIX = {
  head: 0.88,
  stripe: 0.95,
  hover: 0.82,
  selected: 0.68,
} as const

/**
 * Token RIÊNG của DEGO mà tweakcn không có. Bảng màu nào tự khai thì lấy giá trị
 * khai (bảng màu DEGO khai đủ để giữ nguyên bộ màu gốc đã kiểm mù màu); còn lại
 * suy ra từ chính bảng màu đó bằng `color-mix`, để không bảng màu nào rơi lại
 * màu xanh DEGO trong khi cả trang đã đổi tông.
 *
 * ⚠️ CỐ Ý KHÔNG suy ra `--success` · `--warning` · `--info`: đó là màu NGỮ NGHĨA
 * (đã duyệt / chờ duyệt / thông tin), xanh-lá-là-đã-duyệt phải đúng ở mọi bảng
 * màu. Chúng nằm nguyên trong `index.css` và không bảng màu nào chạm tới.
 *
 * ⚠️ Cũng KHÔNG có `--brand-green`: nó là màu xanh lá trong LOGO DEGO, hiện
 * không component nào dùng (chỉ được khai trong `index.css`). Từng thử map sang
 * `--chart-3` và ở bảng màu Claude nền tối nó ra gần như đen — suy ra một token
 * không ai đọc, để rồi ra màu sai, là lỗ hổng chờ ngày có người dùng tới nó.
 */
const DERIVED_TOKENS: Record<string, string> = {
  //  Nền trang = ĐÚNG `--background` của bảng màu, không tự pha thêm.
  //
  //  ⚠️ Trước đây là `color-mix(var(--background) 95%, var(--foreground))` — dìm
  //  nền trang xuống một bậc cho thẻ nội dung nổi lên. Hai chỗ hỏng, đo trên
  //  bảng màu Claude nền sáng:
  //  - Nó rơi TRÚNG KHÍT màu vằn hàng chẵn của bảng (`#f0eeea`), vì `--row-stripe`
  //    cũng là phép pha 95% và bảng màu nào để `card` = `background` thì hai công
  //    thức ra cùng một số. Dính 15/86 tổ hợp.
  //  - Nó làm nền trang (`#f0eeea`) TỐI HƠN cả menu trái (`#f5f4ee`), tức lộn
  //    ngược thứ tự chiều sâu: menu vốn là mặt lùi, khu nội dung phải là mặt
  //    sáng nhất. shadcn/tweakcn để khu nội dung đúng bằng `--background`, còn
  //    thẻ thì tách ra bằng viền + đổ bóng chứ không bằng một bậc màu.
  //
  //  KHÔNG lấy `--secondary` (xem chú thích `--canvas` trong `index.css`).
  //  Bảng màu DEGO khai tay nên vẫn giữ nguyên nền `#f6f8fb` như cũ.
  canvas: 'var(--background)',
  //  Ô CHỈ XEM. Trộn với `--foreground` nên tự đúng hướng ở cả hai chế độ nền
  //  (nền sáng thì xám đi, nền tối thì sáng lên) — điều duy nhất phải giữ là ô
  //  khóa KHÁC HẲN ô nhập được, nên 12% là mức đủ thấy mà chưa chói.
  locked: 'color-mix(in oklab, var(--card) 88%, var(--foreground))',
  //  Chữ trong ô khóa là DỮ LIỆU THẬT, không phải chữ gợi ý: giữ gần
  //  `--foreground` để đọc được, đừng rơi về `--muted-foreground`.
  'locked-foreground': 'color-mix(in oklab, var(--foreground) 85%, var(--card))',
  //  Nền các HÀNG của bảng danh sách. Cả năm suy ra từ `--card` (nền hàng lẻ) nên
  //  một cái bảng luôn nằm gọn trong MỘT họ màu; trộn với `--foreground` thì tự
  //  đúng hướng ở cả hai chế độ nền (nền sáng thì tối đi, nền tối thì sáng lên),
  //  khỏi phải khai riêng công thức cho `.dark`.
  //
  //  Hover và hàng đang chọn trộn với `--primary` chứ không với `--foreground`:
  //  đó là phản hồi thao tác, phải nhận ra ngay là "hệ thống đang đáp lại tôi",
  //  nên nó mượn màu nhấn của bảng màu thay vì đậm nhạt thêm một bậc.
  'row-head': `color-mix(in oklab, var(--card) ${ROW_MIX.head * 100}%, var(--foreground))`,
  'row-head-foreground': 'var(--foreground)',
  'row-stripe': `color-mix(in oklab, var(--card) ${ROW_MIX.stripe * 100}%, var(--foreground))`,
  'row-hover': `color-mix(in oklab, var(--card) ${ROW_MIX.hover * 100}%, var(--primary))`,
  'row-selected': `color-mix(in oklab, var(--card) ${ROW_MIX.selected * 100}%, var(--primary))`,
  //  `--navy` là màu CHỮ ĐẬM (hơn trăm chỗ dùng `text-navy`), không phải màu nền
  //  thương hiệu — nên nó đi theo `--foreground`, sáng hay tối đều đọc được.
  navy: 'var(--foreground)',
  'navy-deep': 'color-mix(in oklab, var(--foreground) 88%, var(--background))',
  'teal-dark': 'color-mix(in oklab, var(--primary) 80%, #000)',
  'sky-soft': 'color-mix(in oklab, var(--primary) 55%, #fff)',
  'chart-neutral': 'color-mix(in oklab, var(--muted-foreground) 45%, var(--background))',
  'chart-track': 'color-mix(in oklab, var(--chart-1) 22%, var(--background))',
  'chart-grid': 'color-mix(in oklab, var(--border) 65%, var(--background))',
}

/** Màu cột biểu đồ — chuẩn hoá theo `CHART_MIN_CONTRAST`. */
const CHART_KEYS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const

/**
 * Hai màu VẼ ĐƯỜNG KẺ trên mặt thẻ — chuẩn hoá theo `SURFACE_LINE_MIN_CONTRAST`.
 *
 * `--border` là lưới bảng + viền thẻ; `--input` là viền ô nhập, ô chọn, ô tick,
 * ô chọn tròn và vùng nhập nhiều dòng (`border-input` trong `shared/ui/`).
 */
const SURFACE_LINE_KEYS = ['border', 'input'] as const

/**
 * Tỉ số tương phản tối thiểu giữa CỘT biểu đồ và nền thẻ chứa nó.
 *
 * 2:1 là ngưỡng "nhìn thấy được", không phải ngưỡng đọc chữ (4.5:1) — cột là
 * mảng màu đặc lớn chứ không phải nét chữ mảnh. Đặt cao hơn thì phải bóp méo
 * màu của gần hết bảng màu; đặt thấp hơn thì vẫn còn cột chìm.
 */
const CHART_MIN_CONTRAST = 2

/**
 * Tỉ số tương phản tối thiểu giữa ĐƯỜNG KẺ (`--border`, `--input`) và mặt thẻ
 * chứa nó.
 *
 * ## Vì sao cần
 * tweakcn để `--input` là màu NỀN của ô nhập chứ không phải màu viền, nhưng
 * shadcn lại dùng nó làm `border-input` — nên bảng màu nào đặt `--input` gần
 * bằng nền thì toàn bộ ô nhập, ô chọn, ô tick MẤT HẲN VIỀN. Đo trên 43 bảng màu
 * × 2 chế độ nền: *Twitter* nền sáng ra 1.008:1 (`#f7f9fa` trên thẻ `#f7f8f8`),
 * *Notebook* và *Sage Garden* ra đúng 1.000:1 vì `--input` TRÙNG KHÍT nền. Báo
 * lỗi 28/08/2026 là đúng cái này: chọn bảng màu Twitter thì thanh công cụ của
 * màn danh sách chỉ còn chữ, không còn ô. `--border` chịu chung ngưỡng vì lưới
 * bảng dòng chứng từ cũng mờ theo (Twitter nền sáng 1.146:1).
 *
 * ## Vì sao là 1.2
 * Đây là ngưỡng NHÌN THẤY của một nét 1px, không phải ngưỡng đọc chữ — WCAG
 * không có mức nào cho đường kẻ trang trí, nên lấy mốc từ chính bảng màu đã
 * duyệt: DEGO là **1.233:1** ở cả `--border` lẫn `--input` nền sáng. Đặt ngay
 * dưới mốc đó thì DEGO không nhích một pixel, mà mọi bảng màu mờ hơn bản gốc
 * đều được kéo lên bằng nó.
 *
 * | Ngưỡng | Số tổ hợp bị chỉnh (trên 86) |
 * |--------|------------------------------|
 * | 1.2    | `--input` 18 · `--border` 10 |
 * | 1.25   | `--input` 34 · `--border` 23 |
 *
 * 1.25 vượt qua chính DEGO nên sẽ đổi luôn bảng màu gốc — không được.
 *
 * ⚠️ Ở chế độ nền tối `--input` còn được dùng làm NỀN mờ của ô nhập
 * (`dark:bg-input/30`), nên kéo nó cũng làm nền ô đậm/nhạt thêm một chút. Chấp
 * nhận: mười mấy phần trăm độ sáng trên một lớp phủ 30% thì gần như không thấy,
 * còn viền mất hẳn thì thấy ngay.
 *
 * Xuất ra ngoài vì thẻ chọn bảng màu vẽ lại bản thu nhỏ của chính giao diện này
 * (`theme-preset-card.tsx`) — hai chỗ tự gõ số thì bản xem trước sớm muộn nói
 * dối cái nó đang xem trước, đúng như `ROW_MIX` bên trên.
 */
export const SURFACE_LINE_MIN_CONTRAST = 1.2

/**
 * Tỉ số tương phản tối thiểu giữa CHỮ của mục menu đang mở và viên nền của nó.
 * Thiếu thì viên nền bị làm sâu thêm, chữ giữ nguyên (xem `buildSidebarActiveLines`).
 *
 * **3:1 — CỐ Ý không phải 4.5:1.** Đây là chỗ hiếm hoi hạ dưới chuẩn AA, và có
 * lý do: mục tiêu là GIỮ ĐÚNG dáng bảng màu gốc, chỉ vá chỗ thật sự hỏng. Quét
 * cả 42 bảng màu nhập ngoài × 2 chế độ nền:
 *
 * | Ngưỡng | Viên nền bị làm sâu | Tương phản chữ thấp nhất |
 * |--------|---------------------|--------------------------|
 * | 3:1    | **10/84**           | 3.01                     |
 * | 4.5:1  | 36/84               | 4.50                     |
 *
 * 4.5 phải động vào 36 bảng màu — quá nửa danh sách đổi tông chỉ để đạt một con
 * số. Ở 3:1 thì *Twitter* chỉ nhích `#1e9df1` → `#1498f0` (vẫn đúng xanh
 * Twitter), *Claude* giữ nguyên mocha `#c96442`.
 *
 * 3:1 cũng chính là ngưỡng WCAG cho chữ lớn và cho thành phần giao diện — nhãn
 * menu ở đây là 14px **font-semibold** nằm trên một mảng màu đặc, không phải chữ
 * chạy trong đoạn văn.
 *
 * ⚠️ Ngưỡng này KHÔNG áp cho bảng màu tự khai `sidebar-active` (bảng màu DEGO).
 */
const SIDEBAR_ACTIVE_MIN_CONTRAST = 3

/**
 * Thang ĐỔ BÓNG mặc định — đúng bằng `shadow-*` gốc của Tailwind (đen 10%,
 * lệch xuống 1px, nhoè 3px). Bảng màu DEGO và 8 bảng màu tweakcn không khai
 * tham số bóng đều rơi về đây, nên chúng không đổi một pixel nào.
 */
const DEFAULT_SHADOW = {
  'shadow-color': '#000000',
  'shadow-opacity': '0.1',
  'shadow-blur': '3px',
  'shadow-spread': '0px',
  'shadow-offset-x': '0px',
  'shadow-offset-y': '1px',
} as const

/**
 * Dựng thang `--erp-shadow-*` từ sáu tham số đổ bóng của bảng màu.
 *
 * ## Vì sao phải tự dựng
 * Trước đây ứng dụng không khai biến bóng nào: `shadow-sm` của thẻ và bảng luôn
 * là đen 10% của Tailwind, bất kể bảng màu. tweakcn thì cho mỗi bảng màu một bộ
 * bóng riêng và khoảng cách rất xa nhau — *Twitter* và *Mono* đặt `opacity: 0`
 * (CỐ Ý không có bóng), *Doom 64* đặt `0.4`, *Bubblegum* đặt `1.0` kèm lệch
 * `3px 3px` (bóng cứng, không nhoè). Đổ chung một kiểu lên tất cả thì bảng màu
 * nào cũng thấy bóng nặng hơn bản gốc (phản hồi 27/08/2026).
 *
 * ## Công thức
 * Chép đúng `getShadowMap` của tweakcn (`utils/shadows.ts`): lớp thứ nhất dùng
 * nguyên bốn tham số hình học, lớp thứ hai dùng `offset-y` và `blur` CỐ ĐỊNH
 * theo từng bậc, `spread` lùi 1px. Độ mờ nhân theo bậc: 0.5 cho hai bậc nhỏ
 * nhất, 1.0 cho nhóm giữa, 2.5 cho `2xl`.
 *
 * ⚠️ Alpha viết bằng `color-mix(... , transparent)` chứ không phải `hsl(h s l / a)`
 * như tweakcn: nhờ vậy `shadow-color` nhận MỌI cách viết màu (hex, hsl, rgb) mà
 * không phải tự phân tích chuỗi trong TS. `opacity: 0` ra `color-mix(… 0%, …)`,
 * tức trong suốt hoàn toàn — đúng ý "không có bóng".
 */
function buildShadowLines(colors: ThemeModeColors): string[] {
  const get = (key: keyof typeof DEFAULT_SHADOW) => colors[key] ?? DEFAULT_SHADOW[key]

  const color = get('shadow-color')
  const opacity = Number.parseFloat(get('shadow-opacity')) || 0
  const blur = get('shadow-blur')
  const spread = get('shadow-spread')
  const offsetX = get('shadow-offset-x')
  const offsetY = get('shadow-offset-y')

  /** Màu bóng ở một bậc độ mờ. */
  const tint = (multiplier: number) =>
    `color-mix(in srgb, ${color} ${(opacity * multiplier * 100).toFixed(2)}%, transparent)`

  const layer1 = (multiplier: number) =>
    `${offsetX} ${offsetY} ${blur} ${spread} ${tint(multiplier)}`

  //  Lớp thứ hai: `spread` lùi 1px so với lớp đầu — đúng như tweakcn làm.
  const spreadPx = Number.parseFloat(spread.replace('px', '')) || 0
  const layer2 = (fixedOffsetY: string, fixedBlur: string) =>
    `${offsetX} ${fixedOffsetY} ${fixedBlur} ${spreadPx - 1}px ${tint(1)}`

  const scale: Record<string, string> = {
    '2xs': layer1(0.5),
    xs: layer1(0.5),
    sm: `${layer1(1)}, ${layer2('1px', '2px')}`,
    md: `${layer1(1)}, ${layer2('2px', '4px')}`,
    lg: `${layer1(1)}, ${layer2('4px', '6px')}`,
    xl: `${layer1(1)}, ${layer2('8px', '10px')}`,
    '2xl': layer1(2.5),
  }

  return Object.entries(scale).map(([step, value]) => `  --erp-shadow-${step}: ${value};`)
}

/**
 * Hai biến của MỤC MENU ĐANG MỞ (`--sidebar-active` + `--sidebar-active-foreground`).
 *
 * Hai đường, cố ý khác nhau:
 *
 * 1. **Bảng màu tự khai** → dùng nguyên, KHÔNG ép tương phản. Khai tay nghĩa là
 *    đã có người cân nhắc; hiện chỉ mỗi bảng màu DEGO khai, và nó cố tình chọn
 *    một vệt nhạt thay vì viên đặc — xanh lơ `#00aeef` tô đặc thì chói hẳn so
 *    với phần còn lại của giao diện (quyết ngày 27/08/2026 theo yêu cầu).
 *
 * 2. **Bảng màu nhập từ tweakcn** → viên TÔ ĐẶC lấy `--sidebar-primary`, chữ lấy
 *    `--sidebar-primary-foreground` rồi ép đạt `SIDEBAR_ACTIVE_MIN_CONTRAST`.
 *    Đây đúng cách shadcn/tweakcn tô mục nổi bật trên menu của họ, và cặp
 *    `sidebar-primary*` được khai THÀNH CẶP nên chữ vốn đã nằm đúng trên nền
 *    của nó — chỉ cần vá mấy bảng màu có cặp quá sát nhau.
 */
function buildSidebarActiveLines(colors: ThemeModeColors): string[] {
  const declared = colors['sidebar-active']
  if (declared) {
    return [
      `  --sidebar-active: ${declared};`,
      `  --sidebar-active-foreground: ${colors['sidebar-active-foreground'] ?? colors.foreground};`,
    ]
  }

  //  Không có `sidebar-primary` thì rơi về `primary` — mọi bảng màu đều có nó.
  const background = colors['sidebar-primary'] ?? colors.primary
  const foreground = colors['sidebar-primary-foreground'] ?? colors.background
  if (!background || !foreground) return []

  //  Thiếu tương phản thì LÀM SÂU VIÊN NỀN, giữ nguyên màu chữ.
  //
  //  ⚠️ Ban đầu làm ngược — kéo màu CHỮ cho hợp với viên nền. Hỏng ngay: bảng màu
  //  Twitter khai chữ trắng trên xanh `#1e9df1`, ra 2.94:1, nên chữ trắng bị lật
  //  thành chữ tối và mục đang mở nhìn như bị lỗi (phản hồi 27/08/2026). Gần như
  //  bảng màu nào cũng chọn chữ SÁNG trên viên màu đặc — đó là ý đồ thiết kế,
  //  không phải chỗ để sửa. Làm sâu viên nền thì chữ sáng giữ nguyên, viên chỉ
  //  đậm thêm một bậc, và đằng nào nó cũng nổi hơn trên nền menu.
  return [
    `  --sidebar-active: ${ensureVisibleAgainst(background, foreground, SIDEBAR_ACTIVE_MIN_CONTRAST)};`,
    `  --sidebar-active-foreground: ${foreground};`,
  ]
}

/**
 * Kéo một biến màu cho đủ nổi trên mặt thẻ, nếu nó thuộc nhóm cần kiểm.
 * Khóa ngoài hai nhóm đó đi thẳng ra CSS, không đụng vào.
 */
function normalizeAgainstSurface(
  key: string,
  value: string,
  surface: string | undefined,
): string {
  if (!surface) return value
  if ((CHART_KEYS as readonly string[]).includes(key)) {
    return ensureVisibleAgainst(value, surface, CHART_MIN_CONTRAST)
  }
  if ((SURFACE_LINE_KEYS as readonly string[]).includes(key)) {
    return ensureVisibleAgainst(value, surface, SURFACE_LINE_MIN_CONTRAST)
  }
  return value
}

/** Dựng các dòng biến cho MỘT chế độ nền. `solidDark` xem chú thích bên dưới. */
function buildVarLines(colors: ThemeModeColors, solidDark: string): string[] {
  const lines: string[] = []
  //  Cột biểu đồ và đường kẻ đều nằm trong THẺ, không nằm trên nền trang — so
  //  với `card`. Bảng màu nào để `card` trùng `background` thì hai cái là một.
  const surface = colors.card ?? colors.background

  for (const key of PASSTHROUGH_KEYS) {
    const value = colors[key]
    if (!value) continue

    lines.push(`  --${key}: ${normalizeAgainstSurface(key, value, surface)};`)
  }

  lines.push(...buildSidebarActiveLines(colors))
  lines.push(...buildShadowLines(colors))

  for (const [key, formula] of Object.entries(DERIVED_TOKENS)) {
    const value = colors[key as keyof ThemeModeColors]
    lines.push(`  --${key}: ${value ?? formula};`)
  }

  //  Nền navy ĐẶC (ảnh đại diện, lớp phủ, bảng thương hiệu màn đăng nhập) — luôn
  //  là màu TỐI ở cả hai chế độ, vì chữ đè lên nó luôn màu trắng. Lấy màu nền
  //  chế độ tối của chính bảng màu để nó vẫn cùng tông với phần còn lại.
  lines.push(`  --navy-solid: ${colors['navy-solid'] ?? solidDark};`)

  return lines
}

/**
 * Trả về đoạn CSS đầy đủ của bảng màu. Chuỗi rỗng nghĩa là "dùng nguyên
 * `index.css`" — không bảng màu nào hiện trả về vậy, nhưng người gọi nên coi
 * chuỗi rỗng là hợp lệ và chỉ cần gỡ thẻ style đi.
 */
export function buildThemeCss(preset: ThemePresetColors): string {
  const solidDark = preset.dark.background ?? '#0f172a'
  const light = buildVarLines(preset.light, solidDark).join('\n')
  const dark = buildVarLines(preset.dark, solidDark).join('\n')

  return `html:root {\n${light}\n}\n\nhtml.dark:root {\n${dark}\n}\n`
}
