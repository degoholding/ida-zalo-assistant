/**
 * Kiểu dữ liệu của BẢNG MÀU (theme preset).
 *
 * Một bảng màu = hai bộ biến CSS (nền sáng / nền tối). Nó KHÔNG thay thế công
 * tắc Sáng·Tối·Theo hệ thống: hai thứ vuông góc nhau — người dùng chọn bảng màu
 * *và* chọn chế độ nền, hệ sinh ra cả hai khối CSS một lượt rồi để class `.dark`
 * của `next-themes` quyết định khối nào có hiệu lực.
 */

/** Tên biến màu shadcn mà một bảng màu khai. Trùng tên biến trong `index.css`. */
export type ThemeColorKey =
  | 'background'
  | 'foreground'
  | 'card'
  | 'card-foreground'
  | 'popover'
  | 'popover-foreground'
  | 'primary'
  | 'primary-foreground'
  | 'secondary'
  | 'secondary-foreground'
  | 'muted'
  | 'muted-foreground'
  | 'accent'
  | 'accent-foreground'
  | 'destructive'
  | 'destructive-foreground'
  | 'border'
  | 'input'
  | 'ring'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'sidebar'
  | 'sidebar-foreground'
  | 'sidebar-primary'
  | 'sidebar-primary-foreground'
  | 'sidebar-accent'
  | 'sidebar-accent-foreground'
  | 'sidebar-border'
  | 'sidebar-ring'
  //  Token RIÊNG của DEGO, tweakcn không có. Bảng màu nhập từ tweakcn để trống
  //  và `build-theme-css.ts` tự suy ra; chỉ bảng màu DEGO khai tay để giữ đúng
  //  bộ màu gốc đã kiểm tương phản + mù màu.
  | 'canvas'
  //  Viên nền + chữ của MỤC MENU ĐANG MỞ. Bảng màu nào để trống thì
  //  `build-theme-css.ts` suy ra viên TÔ ĐẶC từ `sidebar-primary`; bảng màu DEGO
  //  khai tay một vệt nhạt vì xanh lơ #00aeef tô đặc thì chói quá so với phần
  //  còn lại của giao diện (quyết ngày 27/08/2026).
  | 'sidebar-active'
  | 'sidebar-active-foreground'
  //  SÁU tham số ĐỔ BÓNG, lấy nguyên từ tweakcn (họ cũng khai đúng sáu khoá
  //  này). Không phải màu, mà là nguyên liệu để `build-theme-css.ts` dựng cả
  //  thang `--shadow-2xs … --shadow-2xl` theo đúng công thức của họ.
  //
  //  Bảng màu nào để trống thì rơi về thang mặc định — đúng bằng `shadow-*` gốc
  //  của Tailwind, tức không đổi gì so với trước.
  | 'shadow-color'
  /** Số 0–1 dạng chuỗi. `0` nghĩa là bảng màu đó CỐ Ý không có bóng. */
  | 'shadow-opacity'
  | 'shadow-blur'
  | 'shadow-spread'
  | 'shadow-offset-x'
  | 'shadow-offset-y'
  //  Nền + chữ của ô CHỈ XEM (`shared/ui/read-only-value.tsx`).
  | 'locked'
  | 'locked-foreground'
  | 'row-head'
  | 'row-head-foreground'
  | 'row-stripe'
  | 'row-hover'
  | 'row-selected'
  | 'navy'
  | 'navy-deep'
  | 'navy-solid'
  | 'teal-dark'
  | 'sky-soft'
  | 'chart-neutral'
  | 'chart-track'
  | 'chart-grid'

/** Một chế độ nền của bảng màu. Khóa nào thiếu thì giữ nguyên giá trị `index.css`. */
export type ThemeModeColors = Partial<Record<ThemeColorKey, string>>

export interface ThemePresetColors {
  /** Định danh lưu xuống máy chủ — kebab-case, đừng đổi khi đã có người dùng chọn. */
  id: string
  /** Nhãn hiện trên thẻ chọn. */
  label: string
  /** Mô tả một dòng tiếng Việt. */
  description: string
  light: ThemeModeColors
  dark: ThemeModeColors
}
