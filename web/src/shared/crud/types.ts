import type { ComponentType, ReactNode } from 'react'
import type { Control } from 'react-hook-form'

import type { PermissionEntity } from '@/core/authorization/permission-types'
import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import type { DataTableColumn } from '@/shared/data-table'
import type { IdentityChip } from '@/shared/ui/record-identity-card'

/**
 * Ràng buộc chung cho bản ghi mà lớp CRUD thao tác: khóa chuỗi, giá trị CHƯA
 * biết kiểu. Cố ý dùng `unknown` chứ không `any` — `typescript.md` cấm để `any`
 * lọt vào chữ ký export; truy cập vào phải tự thu hẹp (String/Number/ép kiểu).
 */
export type CrudRecord = Record<string, unknown>

export interface CrudOption {
  value: string | number | boolean
  label: string
}

export interface CrudFormField {
  /** Tên trường trong payload JSON / record object. */
  name: string
  /** Nhãn tiếng Việt hiển thị trên form. */
  label: string
  /**
   * Loại trường form.
   *
   * `percent`: người dùng nhập PHẦN TRĂM (8) còn backend lưu TỈ LỆ (0.08) —
   * quy đổi do `field-values.ts` lo, config chỉ khai kiểu.
   */
  type?:
    | 'text'
    | 'number'
    | 'textarea'
    | 'select'
    | 'switch'
    | 'date'
    | 'percent'
    /**
     * Ô TỰ VẼ — config đưa hẳn một component vào lưới, xem `render`.
     *
     * Dành cho thứ không diễn đạt nổi bằng một ô nhập: bảng con, trình khai
     * động… Đổi lại thì nó nằm ngoài mọi tiện ích của lớp CRUD (nhãn, dấu sao,
     * câu báo lỗi, chế độ chỉ xem) — component tự lo hết.
     */
    | 'custom'
  /** Bắt buộc nhập. */
  required?: boolean
  /** Chỉ đọc khi sửa (vd `code` không cho đổi sau khi tạo). */
  readonlyOnEdit?: boolean
  /** Chiếm trọn 1 dòng (2 cột) trên form. Dành cho textarea / địa chỉ / ghi chú dài. */
  fullWidth?: boolean
  /** Chú thích gợi ý mờ phía dưới ô nhập. */
  hint?: string
  /**
   * Tên NHÓM ô. Các ô cùng nhóm được gom lại dưới một tiêu đề nhỏ, theo thứ tự
   * nhóm xuất hiện lần đầu trong `formFields`.
   *
   * Form quá 8–10 ô mà bày phẳng thì người khai không biết ô nào ăn với ô nào —
   * và ở màn danh mục, đoán sai quan hệ giữa hai ô là khai sai luật cho cả công
   * ty. Bỏ trống = ô đứng ở nhóm đầu, không tiêu đề (giữ nguyên khuôn cũ cho
   * các màn chưa chia nhóm).
   */
  section?: string
  /**
   * Chỉ hiện ô này khi giá trị đang nhập thỏa điều kiện.
   *
   * Dùng cho những ô CHỈ CÓ NGHĨA ở một nhánh cấu hình (vd tỷ lệ quy đổi khi
   * chưa chọn «quy đổi» thì không nói lên gì). Ẩn hẳn thay vì làm mờ: ô mờ vẫn
   * chiếm chỗ và vẫn khiến người đọc dừng lại đọc chú thích của nó.
   *
   * ⚠️ Ẩn chỉ là chuyện HIỂN THỊ — giá trị vẫn nằm trong form và vẫn gửi lên.
   * Luật thật phải nằm ở backend, xem `catalog_controller._check_year_end_config`.
   */
  showWhen?: (values: CrudRecord) => boolean
  placeholder?: string
  /** Tùy chọn tĩnh cho trường `select`. */
  options?: CrudOption[]
  /** Nạp tùy chọn động từ API (vd `/api/departments`). */
  source?: {
    url: string
    valueKey?: string
    labelKey?: string
  }
  /**
   * Giá trị mặc định khi tạo mới, khai theo DẠNG LƯU của backend (vd VAT 8% thì
   * khai `0.08`, không khai `8`).
   */
  defaultValue?: unknown
  /**
   * Ô để trống thì gửi `null` thay vì chuỗi rỗng.
   *
   * Khai nó khi backend khai trường đó là **kiểu thật** (`date | None`,
   * `int | None`) chứ không phải `str = ""`. `DatePicker` không có cách nào khác
   * để nói "chưa chọn" — nó luôn giữ `''` — mà `''` thì không phải một ngày, nên
   * schema chặt sẽ trả 422 «input is too short» cho một ô người dùng CỐ Ý bỏ
   * trống, và họ chỉ thấy bấm Lưu mà không có gì xảy ra.
   *
   * ⚠️ **Phải khai từng ô, cố ý không làm mặc định cho `type: 'date'`.** Các
   * danh mục cũ khai ngày là `str = ""` ở backend và chúng trả 422 khi nhận
   * `null` — bật đại trà là làm vỡ *Hợp đồng* với *Phân loại VTBB* đang chạy
   * thật (thử được ngày 17/09/2026).
   */
  nullWhenEmpty?: boolean
  /**
   * Nội dung của ô `type: 'custom'`.
   *
   * Nhận `control` của react-hook-form để component tự nối vào ĐÚNG form đang
   * mở — quan trọng ở màn THÊM MỚI, nơi chưa có bản ghi nên không thể tách ra
   * một khối lưu riêng (`renderExtra` chỉ dựng khi đã có bản ghi).
   *
   * ⚠️ Component phải tự đăng ký giá trị qua `useController`/`Controller` với
   * chính `field.name`. Đừng giữ state riêng rồi đồng bộ lại — hai nguồn sự
   * thật cho một ô là cách chắc chắn nhất để chúng lệch nhau.
   */
  render?: (ctx: {
    control: Control<CrudRecord>
    name: string
    /** Người dùng không sửa được (thiếu quyền, hoặc `readonlyOnEdit`). */
    disabled: boolean
  }) => ReactNode
}

/**
 * Khai báo bộ ô của biểu mẫu: một MẢNG tĩnh, hoặc một HÀM của giá trị đang nhập.
 *
 * Hàm dành cho biểu mẫu mà bộ ô chưa biết trước lúc viết config — xem
 * `resolveFormFields`. Ô lồng nhau khai bằng đường dẫn có dấu chấm
 * (`'extra_fields.so_giay_phep'`), react-hook-form hiểu sẵn.
 */
export type CrudFormFieldsSpec =
  | CrudFormField[]
  | ((values: CrudRecord) => CrudFormField[])

export interface CrudTab<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
}

export interface QuickFilterConfig {
  key: string
  label: string
  type: 'select' | 'date-range' | 'chip'
  options?: CrudOption[]
  sourceUrl?: string
}

export interface CrudConfig<T> {
  /** Khóa phân quyền — khớp ENTITIES trong backend (vd 'warehouse', 'unit'). */
  entity: PermissionEntity
  /** Tiêu đề danh mục tiếng Việt (vd 'Kho', 'Đơn vị tính'). */
  title: string
  /**
   * Câu dưới tiêu đề — nói màn này để làm gì.
   *
   * Bỏ trống thì `PageHeader` chỉ có mỗi dòng tiêu đề, và màn CRUD đứng cạnh
   * những màn viết tay (vốn luôn có mô tả) sẽ trông cụt lủn — khách chỉ đúng
   * chỗ đó ngày 04/09/2026 ở tab «Danh mục phòng».
   */
  description?: string
  /** Tên đơn vị danh từ (vd 'kho', 'đơn vị tính', dùng cho nút "Thêm kho"). */
  unitLabel: string
  /** Đường dẫn API (vd '/api/warehouses'). */
  apiPath: string
  /** Khóa lưu cấu hình bảng trong localStorage (vd 'inventory.warehouses'). */
  storageKey: string
  /** Trường định danh duy nhất (mặc định 'id'). */
  idKey?: keyof T
  /** Trường tìm kiếm nhanh trên thanh công cụ (mặc định 'name', hoặc 'q'). */
  searchParam?: string
  /**
   * Thứ tự sắp xếp khi người dùng CHƯA bấm tiêu đề cột nào. Bỏ trống = để
   * backend sắp theo mặc định của nó (`id desc` — bản ghi mới lên đầu), đúng
   * như mọi danh mục vẫn chạy từ trước; đây là thêm mới thuần túy.
   *
   * Khai nó khi thứ tự của danh mục **mang nghĩa nghiệp vụ** chứ không phải
   * "mới nhất trước". Sinh ra cho *Loại hồ sơ* (16/09/2026): năm dòng của nó là
   * năm GIAI ĐOẠN của một lô nhập hàng (Pháp lý → Đặt hàng → Sản xuất → Kiểm
   * tra → Nhận hàng), bày ngược lại là đọc sai cả quy trình.
   *
   * ⚠️ `by` phải là tên CỘT THẬT của model — `apply_sort` ở backend lọc theo
   * whitelist cột, tên lạ bị bỏ qua trong im lặng và danh sách về lại `id desc`
   * mà không có gì báo.
   */
  defaultSort?: { by: string; dir: 'asc' | 'desc' }
  searchPlaceholder?: string
  /** Cấu hình thanh lọc nhanh ngoài bảng. */
  quickFilters?: QuickFilterConfig[]
  /** Cấu hình các cột hiển thị trên DataTable. */
  columns: DataTableColumn<T>[]
  /**
   * Nội dung MỘT THẺ ở khổ điện thoại (< 768px) — khai nó là bật chế độ thẻ,
   * xem `DataTableProps.mobileCard`.
   *
   * ⚠️ **Tự nguyện, không mặc định.** Khung CRUD này chạy cho hơn hai chục danh
   * mục; bật thẻ cho tất cả bằng một dòng ở đây là hai chục màn đồng loạt đổi
   * hình dạng mà không ai xem lại từng cái. Danh mục hai ba cột thì bảng cuộn
   * ngang vẫn đọc được — chỉ những màn nhiều cột mới cần dời.
   *
   * ⚠️ Thẻ KHÔNG suy ra từ `columns`: cột khai bề rộng, thứ tự, ghim — toàn thứ
   * chỉ có nghĩa trong lưới. Ở thẻ, người dựng tự chọn bày trường nào theo thứ
   * bậc nào.
   */
  mobileCard?: (row: T) => ReactNode
  /** Cấu hình bộ lọc nâng cao (ConditionalFilter). */
  filterConfig?: {
    fields: FilterFieldDefinition[]
    preserveParams?: string[]
    allowConjunctionToggle?: boolean
  }
  /**
   * Cấu hình các trường trong Form thêm / sửa.
   *
   * Khai bằng HÀM khi bộ ô phụ thuộc vào giá trị đang nhập — xem
   * `CrudFormFieldsSpec` và `resolveFormFields`.
   */
  formFields: CrudFormFieldsSpec
  /**
   * Câu mô tả của từng NHÓM ô (khóa = `field.section`). Tùy chọn — nhóm nào
   * không khai thì chỉ hiện tiêu đề. Dùng để nói bằng tiếng người cái mà tên
   * nhóm nói bằng từ chuyên môn.
   */
  formSections?: Record<string, string>
  /** Đường dẫn trang danh sách (vd '/inventory/warehouses'). */
  listRoute?: string
  /** Đường dẫn tới trang chi tiết (vd (id) => `/inventory/warehouses/${id}`). */
  detailRoute?: (id: number | string) => string
  /**
   * Đường dẫn trang THÊM MỚI (vd '/hr/leave-types/new'). Khai nó thì nút «Thêm»
   * **điều hướng sang trang đó** thay vì bật hộp thoại; bỏ trống = giữ hộp thoại
   * như cũ.
   *
   * Dùng cho danh mục mà form thêm mới dài hoặc nhiều ô cần đọc kỹ (Loại nghỉ có
   * 10 ô, kèm bậc thâm niên) — nhồi vào hộp thoại thì người dùng phải cuộn TRONG
   * một khung nổi, bấm ra ngoài là mất sạch, và không dán được link cho người
   * khác. Danh mục hai ba ô thì hộp thoại vẫn nhanh hơn, đừng dời hết sang trang.
   *
   * Trang đó dựng bằng chính `CrudDetailPage`: đăng ký route TĨNH (không có
   * `:id`) trỏ vào cùng component chi tiết, nó tự nhận ra chế độ tạo mới.
   */
  createRoute?: string
  /** Thẻ danh tính hiển thị trên đầu trang chi tiết. */
  chips?: (row: T) => IdentityChip[]
  /**
   * Ảnh / logo đặt trước tên trên thẻ danh tính (Bot trợ lý: ảnh Zalo của người, của nhóm).
   * Bỏ trống với danh mục không có ảnh.
   */
  detailMedia?: (row: T) => ReactNode
  /**
   * Nút hành động THÊM ở hàng nút dính của trang chi tiết, đứng trước Lưu / Xóa — việc riêng của
   * bản ghi mà biểu mẫu không diễn đạt được (vd «Lấy tin cũ» của nhóm, «Quét QR lại» của tài khoản bot).
   */
  detailActions?: (row: T) => ReactNode
  /**
   * Trang chi tiết CHỈ XEM: không dựng biểu mẫu, không có nút «Lưu». Nội dung do `renderExtra` / `tabs` vẽ.
   *
   * Sinh ra cho màn Ticket (08/10/2026): ticket do bot lập từ tin Zalo, không có ô nào sửa tay — đổi trạng thái đi
   * bằng nút riêng ở `detailActions`. Không có cờ này thì người có quyền `write` thấy nút Lưu, bấm vào là PATCH một
   * đường máy chủ không có. Bỏ trống = giữ nguyên hành vi cũ (có biểu mẫu + nút Lưu).
   */
  readOnlyDetail?: boolean
  /** Cảnh báo khi xóa bản ghi (vd 'Dữ liệu tồn kho liên quan có thể bị ảnh hưởng'). */
  deleteWarning?: string
  /** Tab mở rộng ở trang chi tiết (vd Lịch sử mua hàng, Đơn hàng về kho). */
  tabs?: CrudTab<T>[]
  /** Khối bổ sung hiển thị dưới form ở trang chi tiết. */
  renderExtra?: (row: T) => ReactNode
  /** Hàm lấy tên bản ghi để hiển thị trong câu hỏi xác nhận Xóa. */
  getItemName?: (row: T) => string
  /**
   * Chỉnh payload LẦN CUỐI trước khi gửi backend. Nhận cả bản ghi đang sửa
   * (`undefined` khi tạo mới).
   *
   * Sinh ra cho ô JSON tùy biến của phân hệ Hồ sơ (16/09/2026), và lý do là một
   * bài học đáng nhớ: biểu mẫu chỉ dựng ô cho những trường LOẠI ĐANG KHAI, nên
   * `extra_fields` gửi lên chỉ chứa chúng. Người quản trị bỏ một ô khỏi loại
   * thì giá trị cũ của ô đó vẫn nằm dưới DB — và lần bấm Lưu kế tiếp của bất kỳ
   * ai sẽ **xóa sạch nó mà không báo gì**. Backend cố ý giữ lại khóa không còn
   * khai (`field_values.py`), nhưng nó chỉ giữ được thứ nó nhận được.
   *
   * ⚠️ Chỉ dùng cho việc GHÉP / GIỮ dữ liệu. Đừng đặt luật nghiệp vụ ở đây —
   * người gọi thẳng API đi đường khác, luật phải nằm ở backend.
   */
  buildPayload?: (payload: CrudRecord, item?: T | null) => CrudRecord
  /** Chiều rộng tối đa của hộp thoại thêm mới (mặc định 'sm:max-w-lg'). */
  dialogMaxWidth?: string
  /**
   * Bề ngang tối đa của TRANG CHI TIẾT (mặc định `'max-w-5xl'`).
   *
   * Danh mục thường chỉ có một biểu mẫu, mà lưới ô nhập nhiều nhất 2 cột: thả
   * cho giãn hết màn 24" thì mỗi cột rộng ~800px — ô nhập một con số dài bằng
   * nửa màn hình, hàng công tắc thì nhãn dính mép trái nút dính mép phải. Chặn
   * ở TRANG (không chặn riêng biểu mẫu) để thẻ danh tính, tab và dấu vết cùng
   * một cột — chặn mỗi biểu mẫu thì nó ngắn cụt dưới một cái thẻ rộng gấp rưỡi.
   *
   * Đặt `'max-w-none'` cho màn có tab chứa BẢNG rộng (Sản phẩm, Nhà cung cấp,
   * Phòng họp) — bảng bị bóp còn 1024px là cụt cột.
   */
  detailMaxWidth?: string
  /** Render thêm nội dung ở đầu thanh công cụ. */
  renderToolbarExtra?: () => ReactNode
  /**
   * Câu khi danh sách RỖNG mà không lọc gì. Mặc định mời bấm «Thêm» — sai với danh mục do Zalo
   * sinh ra (Danh bạ, Nhóm, Tệp) vốn không có nút Thêm.
   */
  emptyMessage?: string
  /**
   * Ghi đè hộp thoại Thêm/Sửa bằng component RIÊNG khi biểu mẫu quá đặc thù cho khung
   * generic (vd form Tài xế có nút Nội bộ/Thuê ngoài + tìm nhân sự theo SĐT). Nhận đúng
   * props như `CrudFormDialog`; bỏ trống thì dùng form dựng từ `formFields`.
   */
  FormDialog?: ComponentType<CrudFormDialogProps<T>>
  /**
   * Bấm một dòng MỞ POPUP Thêm/Sửa (với bản ghi đó) thay vì điều hướng sang trang chi
   * tiết. Dùng khi danh mục xem/sửa gọn trong popup (vd Tài xế). Bỏ trống = giữ hành vi
   * cũ: điều hướng theo `detailRoute`.
   */
  openFormOnRowClick?: boolean
}

/** Props chuẩn của hộp thoại Thêm/Sửa — dùng cho cả `CrudFormDialog` lẫn bản ghi đè. */
export interface CrudFormDialogProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: CrudConfig<T>
  /** Có = SỬA bản ghi này; bỏ trống = THÊM mới. */
  item?: T | null
}
