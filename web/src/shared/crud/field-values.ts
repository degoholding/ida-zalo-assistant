import { getPath, setPath } from './field-path'
import type { CrudFormField, CrudOption } from './types'

/**
 * Quy đổi giá trị giữa DẠNG LƯU (payload gửi backend) và DẠNG NHẬP (ô trên form).
 *
 * Tách ra khỏi hai màn dùng nó (`crud-form-dialog` thêm mới, `crud-detail-page`
 * sửa) vì cả hai BẮT BUỘC quy đổi giống hệt nhau: lệch một chỗ là thêm mới với
 * sửa cho ra hai kết quả khác nhau trên cùng một trường.
 */

/** Số chữ số thập phân giữ lại cho DẠNG LƯU của trường phần trăm. */
const RATIO_DECIMALS = 6

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * TỈ LỆ (0.08) -> SỐ PHẦN TRĂM để đổ vào ô nhập (8).
 *
 * Phải làm tròn: `0.07 * 100` trong JS ra `7.000000000000001`, đổ thẳng vào ô
 * `type="number"` là người dùng nhìn thấy nguyên cái đuôi đó.
 */
export function ratioToPercentInput(ratio: unknown): number {
  const num = Number(ratio)
  if (!Number.isFinite(num)) return 0
  return round(num * 100, RATIO_DECIMALS - 2)
}

/** SỐ PHẦN TRĂM người dùng gõ (8) -> TỈ LỆ để gửi backend (0.08). */
export function percentInputToRatio(percent: unknown): number {
  const num = Number(percent)
  if (!Number.isFinite(num)) return 0
  return round(num / 100, RATIO_DECIMALS)
}

/**
 * Giá trị khởi tạo cho react-hook-form.
 *
 * `defaultValue` khai trong config luôn ở DẠNG LƯU (vd `defaultValue: 0.08` cho
 * VAT 8%) để giống hệt thứ backend trả về — người viết config không phải nhớ
 * trường nào quy đổi, trường nào không.
 */
export function buildFormDefaults(
  fields: CrudFormField[],
  item?: Record<string, unknown> | null,
): Record<string, unknown> {
  let values: Record<string, unknown> = {}

  for (const field of fields) {
    //  ⚠️ `getPath`, không phải `item[field.name]`: ô lồng nhau khai tên có dấu
    //  chấm (`'extra_fields.so_gp'`) và react-hook-form hiểu đó là đường dẫn.
    //  Tra bằng khóa trần thì luôn ra `undefined` — giá trị ĐÃ LƯU không đổ vào
    //  ô, người dùng mở hồ sơ ra thấy trống và tin là chưa ai nhập.
    const stored = item ? getPath(item, field.name) : undefined
    const source = stored !== undefined ? stored : field.defaultValue

    //  ⚠️ `setPath`, không phải `values[field.name] = …`. Với ô lồng nhau,
    //  react-hook-form tra `defaultValues` bằng cách TÁCH tên theo dấu chấm —
    //  ghi một khóa trần `'extra_fields.so_gp'` thì nó không bao giờ tìm thấy,
    //  và ô hiện trống dù dữ liệu có sẵn ngay trong đối tượng này.
    if (source !== undefined) {
      values = setPath(
        values,
        field.name,
        field.type === 'percent' ? ratioToPercentInput(source) : source,
      )
    } else if (field.type === 'switch') {
      values = setPath(values, field.name, true)
    } else if (field.type === 'custom') {
      //  Ô tự vẽ hầu như luôn giữ một DANH SÁCH (bảng con, trình khai động). Để
      //  nó rơi vào nhánh chuỗi rỗng bên dưới thì component nhận `''` và
      //  `.map()` nổ ngay lượt vẽ đầu.
      values = setPath(values, field.name, [])
    } else if (field.type === 'number' || field.type === 'percent') {
      values = setPath(values, field.name, 0)
    } else {
      values = setPath(values, field.name, '')
    }
  }

  return values
}

/**
 * Bù giá trị ĐANG LƯU vào danh sách chọn khi nó không nằm trong danh sách khai.
 *
 * Các cột này ở backend là VARCHAR tự do, dữ liệu cũ nhập tay nên lệch bộ giá trị
 * chuẩn (vd `contract_type` từng có "Hợp đồng kinh tế", "Hợp đồng khuôn mẫu" ngoài
 * 5 loại khai ở config — 177/179 hợp đồng đang lưu không khớp mục nào; CR-118 đã
 * chuẩn hóa cột đó sang mã tiếng Anh nhưng các cột tự do khác thì chưa). Radix
 * `Select` không tìm được mục khớp thì hiện chữ gợi ý y như ô TRỐNG: người dùng
 * tưởng dữ liệu bị mất, chọn đại một loại khác và giá trị thật bị ghi đè mà không
 * ai biết. Hiện lại chính nó thì vừa đọc được, vừa bấm Lưu mà không đổi gì.
 */
export function withCurrentValue(options: CrudOption[], value: unknown): CrudOption[] {
  const current = String(value ?? '')
  //  `'0'` cũng là RỖNG với ô chọn tham chiếu (`convert_to_type_id`, `parent_id`…):
  //  backend khai id là số nên "chưa chọn" lưu thành `0`, không phải `null`. Bù
  //  nó vào danh sách thì ô hiện đúng chữ **0** — người dùng đọc ra một lựa chọn
  //  tên là "0". Bỏ qua thì ô rơi về chữ gợi ý, đúng nghĩa chưa chọn.
  if (!current || current === '0') return options
  if (options.some((option) => String(option.value) === current)) return options
  return [...options, { value: current, label: current }]
}

/** Giá trị trên form -> payload gửi backend. */
export function toApiPayload(
  fields: CrudFormField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  let payload: Record<string, unknown> = { ...values }

  for (const field of fields) {
    const raw = getPath(payload, field.name)
    if (raw === undefined) continue

    if (field.type === 'percent') {
      // Ô trống nghĩa là 0%, không phải "bỏ trường này đi": backend khai `vat`
      // là số bắt buộc nên gửi chuỗi rỗng sẽ 422.
      payload = setPath(payload, field.name, percentInputToRatio(raw === '' ? 0 : raw))
    } else if (field.type === 'number' && field.nullWhenEmpty && (raw === '' || raw === null)) {
      //  bao-CR-502: ô số KHAI `nullWhenEmpty` mà đang trống — kể cả khi bản ghi đọc về là `null`
      //  và người dùng không đụng tới — phải gửi lại `null`. Trước đây `null` rơi xuống nhánh dưới,
      //  `Number(null)` = 0, và «Năm bắt đầu cấm» (backend chặn 1900–2100) trả 422: MỌI hóa chất
      //  không có năm cấm đều không sửa được, từ bao-CR-470. Ô không khai giữ nguyên hành vi cũ.
      payload = setPath(payload, field.name, null)
    } else if (field.type === 'number' && raw !== '') {
      payload = setPath(payload, field.name, Number(raw))
    } else if (field.nullWhenEmpty && raw === '') {
      //  ⚠️ Ô để trống gửi `null` thay vì chuỗi rỗng — **chỉ khi ô KHAI xin**.
      //
      //  `DatePicker` không có cách nào khác để nói "chưa chọn": nó luôn giữ
      //  `''`. Mà `''` không phải một ngày, nên schema nào khai `date | None`
      //  đều trả **422** kèm câu *«input is too short»* — người dùng bấm Lưu mà
      //  không lưu được, cho một ô họ CỐ Ý bỏ trống.
      //
      //  ⚠️ **KHÔNG áp cho mọi ô ngày.** Thử rồi: các danh mục cũ khai ngày là
      //  `str = ""` ở backend (tức không kiểm gì cả, đúng thứ duoc-CR-316 dựng
      //  ra để chặn), và chúng trả 422 «Input should be a valid string» khi nhận
      //  `null` — đổi mặc định là làm vỡ màn *Hợp đồng* với *Phân loại VTBB*
      //  đang chạy thật. Nên cờ này phải do từng ô tự khai.
      payload = setPath(payload, field.name, null)
    }
  }

  return payload
}
