import type { CrudFormField, CrudFormFieldsSpec, CrudRecord } from './types'

/**
 * Dựng danh sách ô của biểu mẫu từ khai báo trong config.
 *
 * Phần lớn danh mục khai một MẢNG tĩnh và hàm này chỉ trả lại nguyên nó. Khai
 * bằng HÀM là dành cho biểu mẫu mà bộ ô **phụ thuộc vào chính giá trị đang
 * nhập** — sinh ra cho phân hệ Hồ sơ (16/09/2026): mỗi loại hồ sơ tự khai bộ ô
 * riêng của nó (`tab_dossier_type.field_schema`), nên chọn loại nào thì biểu mẫu
 * mọc ra ô của loại ấy.
 *
 * ⚠️ **Khác `field.showWhen` ở một điểm cốt lõi.** `showWhen` ẩn/hiện một ô đã
 * biết trước; hàm này dựng ra những ô mà lúc viết config **chưa ai biết tên**.
 * Ô nào diễn tả được bằng `showWhen` thì dùng `showWhen` — nó rẻ hơn và đọc rõ
 * hơn.
 *
 * ⚠️ Hàm phải THUẦN và phải rẻ: nó chạy lại mỗi lần gõ một phím (xem
 * `CrudFormFields`). Đừng gọi API hay dựng mảng lớn trong đó — dữ liệu ngoài
 * (vd danh mục loại hồ sơ) thì nạp bằng hook rồi truyền vào lúc dựng config.
 */
export function resolveFormFields(
  spec: CrudFormFieldsSpec,
  values: CrudRecord,
): CrudFormField[] {
  return typeof spec === 'function' ? spec(values) : spec
}
