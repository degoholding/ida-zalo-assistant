import type { ReactNode } from 'react'

export interface DataTableColumn<T> {
  /** Khóa cột — dùng làm id khi ẩn/hiện và khi nhớ độ rộng. Phải duy nhất trong bảng. */
  key: string
  /**
   * Tiêu đề cột. Kết thúc bằng `" *"` = cột BẮT BUỘC nhập: bảng tự tách phần đó
   * ra và vẽ dấu sao màu đỏ (`required-header.ts`). Đừng tự chèn thẻ vào đây —
   * chuỗi này còn dùng làm nhãn kéo thả và tên cột trong menu ẩn/hiện.
   */
  header: string
  /**
   * Thay NHÃN tiêu đề bằng một thành phần (ô tick "chọn hết", huy hiệu đếm…).
   * `header` vẫn phải khai vì nó còn là nhãn lúc kéo cột và tên trong menu "Cột".
   *
   * Bảng đã tự chặn nổi bọt cả `pointerdown` (kéo đổi vị trí cột) lẫn `click`
   * (sắp xếp) quanh chỗ này, nên bên trong cứ đặt nút / ô tick bình thường.
   */
  headerContent?: ReactNode
  /** Nội dung ô. Trả `null`/chuỗi rỗng thì bảng tự hiện dấu gạch ngang. */
  cell: (row: T) => ReactNode
  /** Độ rộng ban đầu (px). Bỏ trống = cột co giãn theo phần còn lại. */
  width?: number
  /** Chặn dưới khi kéo giãn. Mặc định 64px. */
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /**
   * `false` = cột luôn hiện, không cho tắt trong menu "Cột".
   * Dùng cho cột định danh (tên, mã) — ẩn hết đi thì bảng vô nghĩa.
   */
  hideable?: boolean
  /** Mặc định ẩn khi mở bảng lần đầu; người dùng vẫn bật lại được. */
  defaultHidden?: boolean
  /**
   * Mặc định GHIM sang trái (dính khi cuộn ngang). Chỉ đặt cho cột định danh
   * của bảng nhiều cột — ghim nhiều quá thì không còn chỗ cho dữ liệu.
   */
  defaultPinned?: boolean
  /**
   * Cột nghiệp vụ được CỐ ĐỊNH bên phải và luôn xếp cuối bảng. Khác
   * `defaultPinned`, vị trí này do màn hình quy định nên người dùng không thể
   * kéo hoặc ghim nó sang trái. Dùng cho cột thao tác dạng icon.
   */
  stickyRight?: boolean
  /**
   * `true` = cho phép chữ dài tự xuống dòng thay vì cắt bằng dấu ba chấm "…".
   * Thích hợp cho cột Tên, Nhà cung cấp, Địa chỉ, Ghi chú.
   */
  wrap?: boolean
  /** `true` = cột có thể sắp xếp. */
  sortable?: boolean
  /**
   * Bấm lần đầu sắp GIẢM dần thay vì tăng (chu kỳ thành giảm → tăng → thôi).
   * Dành cho cột thời gian (*Ngày cập nhật*, *Ngày tạo*): người dùng bấm vào đó
   * là muốn xem BẢN GHI MỚI NHẤT trước — bắt họ bấm hai lần là ngược tay
   * (luật mang từ bản v1, bao-CR-294).
   */
  sortDescFirst?: boolean
  /**
   * Màu tô SẴN cho cột (mã trong `COLUMN_COLORS` hoặc hex) — cùng nghĩa với
   * `LinesTableColumn.defaultColor`: dùng khi màu mang NGHĨA (vd bốn cột giá Thấp nhất /
   * Khoảng phổ biến / Bình quân / Cao nhất, bao-CR-518). Màu người dùng tự chọn trong
   * menu «Cột» vẫn thắng.
   */
  defaultColor?: string
  /**
   * `true` = vạch dọc ĐẬM ở mép phải cột này — ngăn một NHÓM cột với phần còn lại
   * (vd bốn cột giá của Tra cứu thị trường, bao-CR-519: đánh dấu cột trước nhóm và cột
   * cuối nhóm). Chỉ đổi độ đậm vạch có sẵn, không đổi nền nên hàng tô nền vẫn nổi.
   */
  dividerAfter?: boolean
}

/**
 * Loại ô nhập mà một cột của `LinesTable` chứa — chỉ khai khi nó ÉP một sàn bề
 * rộng. Sàn tương ứng và lý do của từng con số nằm ở `line-column-width.ts`.
 */
export type LinesTableControl = 'date'

/**
 * Cột của `LinesTable` — bảng DÒNG CHỨNG TỪ (dòng hàng YCMH/ĐMH, dòng khảo sát,
 * các lần giao). Khác `DataTableColumn` ở chỗ KHÔNG khai `cell`: ô của bảng dòng
 * cần cả chỉ số dòng để sửa đúng phần tử, nên nội dung do một hàm `renderCell`
 * duy nhất vẽ theo `key`.
 */
export interface LinesTableColumn {
  /** Khóa cột — vừa là id nhớ bố cục, vừa là nhánh `switch` trong `renderCell`. */
  key: string
  /** Kết thúc bằng `" *"` = cột bắt buộc nhập — xem `DataTableColumn.header`. */
  header: string
  /**
   * Thay NHÃN tiêu đề bằng một thành phần (ô tick «chọn hết»…) — cùng nghĩa với
   * `DataTableColumn.headerContent`; bảng đã chặn kéo cột / sắp xếp quanh chỗ này.
   * `header` vẫn phải khai vì còn là nhãn lúc kéo cột và tên trong menu «Cột».
   */
  headerContent?: ReactNode
  /** Độ rộng ban đầu (px). */
  width?: number
  /** Chặn dưới khi kéo giãn. Mặc định 64px. */
  minWidth?: number
  /**
   * Cột chứa ô nhập có bề rộng TỐI THIỂU đo được — bảng tự nâng `width` và
   * `minWidth` lên sàn của loại ô đó (`line-column-width.ts`).
   *
   * Khai cho MỌI cột có `DatePicker`, kể cả cột đang khai đủ rộng: sàn là thứ giữ
   * cho lần sau ai đó chỉnh bề rộng xuống không âm thầm cắt mất ngày.
   */
  control?: LinesTableControl
  align?: 'left' | 'center' | 'right'
  /** `false` = cột luôn hiện, không cho tắt trong menu "Cột". */
  hideable?: boolean
  /** Mặc định GHIM sang trái (dính khi cuộn ngang). */
  defaultPinned?: boolean
  /**
   * Cột chỉ hiện ở chế độ "Bảng đầy đủ"; nút chuyển chế độ bật/tắt đúng nhóm này.
   * Vẫn bật/tắt lẻ được trong menu "Cột" như mọi cột khác.
   */
  compactHidden?: boolean
  /** `true` = cho phép chữ dài tự xuống dòng thay vì cắt bằng dấu ba chấm "…". */
  wrap?: boolean
  /**
   * Màu tô SẴN cho cột (mã trong `COLUMN_COLORS` hoặc hex), dùng khi màu của cột
   * mang NGHĨA chứ không chỉ để dò — vd ba cột tiền Dự toán / Tạm tính / Quyết toán.
   * Màu người dùng tự chọn trong menu «Cột» vẫn THẮNG; bỏ màu tự chọn thì cột quay
   * về màu này chứ không về trắng, vì trắng là mất đúng cái nghĩa ấy.
   */
  defaultColor?: string
}

export interface DataTablePagination {
  /** Trang hiện tại, đếm từ 1. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  /** Danh từ đếm được: "nhân sự", "công ty"… */
  unitLabel: string
}

/** Trạng thái bảng được nhớ lại giữa các phiên (localStorage). */
export interface DataTableLayout {
  hiddenColumns: string[]
  columnWidths: Record<string, number>
  /**
   * Thứ tự cột do người dùng kéo thả, kể cả cột đang ẩn (ẩn rồi hiện lại vẫn
   * về đúng chỗ cũ). Mảng RỖNG = giữ nguyên thứ tự khai báo trong code.
   *
   * Khóa lạ (cột đã bị xóa khỏi code) được bỏ qua khi đọc, cột mới thêm sau
   * này xếp nối vào cuối — nên đổi cấu hình cột không làm hỏng layout đã lưu.
   */
  columnOrder: string[]
  /**
   * Cột được GHIM sang trái: luôn đứng đầu bảng và dính lại khi cuộn ngang.
   * Dành cho bảng nhiều cột (vd Tiến độ mua hàng) — cuộn tới cột thứ 20 mà vẫn
   * biết đang xem đơn nào.
   */
  pinnedColumns: string[]
  /**
   * Màu người dùng tự đặt cho từng cột (mã màu gốc trong `COLUMN_COLORS`).
   * Không có khóa = cột dùng nền mặc định.
   */
  columnColors: Record<string, string>
}

/** Thả cột vào TRƯỚC hay SAU cột đang trỏ tới. */
export type ColumnDropSide = 'before' | 'after'
