import type { Control, FieldErrors, UseFormRegister, UseFormWatch } from 'react-hook-form'

import { CrudField } from './crud-field'
import { resolveFormFields } from './resolve-form-fields'
import type { CrudFormField, CrudFormFieldsSpec, CrudRecord } from './types'

interface CrudFormFieldsProps {
  /** Mảng ô, hoặc HÀM của giá trị đang nhập — xem `CrudFormFieldsSpec`. */
  fields: CrudFormFieldsSpec
  register: UseFormRegister<CrudRecord>
  control: Control<CrudRecord>
  errors: FieldErrors<CrudRecord>
  watch: UseFormWatch<CrudRecord>
  /** Câu mô tả của từng nhóm, khai ở `CrudConfig.formSections`. */
  sectionHints?: Record<string, string>
  /** Ô này có bị khóa không — mỗi màn một luật (tạo mới / thiếu quyền / `readonlyOnEdit`). */
  isReadonly: (field: CrudFormField) => boolean
}

/**
 * LƯỚI Ô của form CRUD — dùng chung cho trang chi tiết và hộp thoại.
 *
 * Tách ra khỏi hai chỗ gọi vì chúng vốn dựng cùng một lưới; để hai bản chép thì
 * thêm một tính năng là phải nhớ sửa cả hai, và bản quên sửa sẽ im lặng lệch đi.
 *
 * Ba việc nó làm hơn một vòng `map`:
 *
 * 1. **Chia nhóm theo `field.section`** — form 15 ô bày phẳng thì người khai
 *    không biết ô nào ăn với ô nào. Nhóm có tên thì thành một THẺ có viền, chứ
 *    không phải một dòng chữ mờ: đường kẻ mảnh không đủ để mắt thấy đâu là ranh
 *    giới, nên cụm dưới vẫn đọc như phần đuôi của cụm trên.
 * 2. **Tách CÔNG TẮC khỏi lưới ô nhập** — hai thứ này cao thấp khác nhau, xếp
 *    xen kẽ trong lưới hai cột là hàng nào cũng so le và hàng lẻ chừa một lỗ
 *    trắng bằng nửa màn hình (đúng lỗi phải sửa ở màn *Loại nghỉ*, 07/09/2026).
 *    Ô nhập đi một lưới, công tắc đi lưới RIÊNG bên dưới — mỗi rổ tự đều nhau
 *    nên không còn hàng nào so le.
 * 3. **Ẩn ô theo `field.showWhen`** — ô chỉ có nghĩa ở một nhánh cấu hình thì
 *    nhánh khác không dựng. Theo dõi bằng `watch()` nên ẩn/hiện ngay lúc gõ.
 * 4. **Dựng ô theo giá trị đang nhập** (`fields` khai bằng hàm) — biểu mẫu mà
 *    bộ ô chưa biết trước lúc viết config, xem `resolveFormFields`.
 *
 * ⚠️ Việc thứ 4 cố ý làm Ở ĐÂY chứ không ở hai màn gọi tới. Component này vốn
 * đã gọi `watch()` cho `showWhen`, nên dựng ô ở đây không thêm một lượt vẽ nào;
 * làm ở `CrudDetailPage` thì cả trang — kể cả tab, dòng thời gian, thẻ danh
 * tính — vẽ lại sau MỖI phím gõ.
 *
 * ⚠️ Thứ tự khai trong `formFields` được giữ **trong từng rổ**; hai rổ (ô nhập /
 * công tắc) thì **rổ nào lên trước do ô ĐẦU TIÊN của nhóm quyết định** — xem
 * `renderGroup`. Cần một công tắc nằm CHÍNH GIỮA các ô nhập thì vẫn phải tách nó
 * sang nhóm riêng, đừng trông vào thứ tự khai.
 */
export function CrudFormFields({
  fields,
  register,
  control,
  errors,
  watch,
  sectionHints,
  isReadonly,
}: CrudFormFieldsProps) {
  //  Theo dõi TOÀN BỘ form: `showWhen` là hàm của người khai config, không khai
  //  trước nó đọc ô nào. Form danh mục cỡ chục ô nên chi phí vẽ lại không đáng kể.
  const values = watch()
  const resolved = resolveFormFields(fields, values)
  const visible = resolved.filter((field) => !field.showWhen || field.showWhen(values))

  //  Gom theo DẢI LIÊN TIẾP, không gom theo tên nhóm. Gom theo tên thì ô không
  //  khai nhóm nằm ở CUỐI form bị kéo ngược lên đầu — nhập chung với cụm không
  //  tên mở màn — và người khai config không cách nào xếp «Ghi chú» xuống dưới
  //  cùng. Dải liên tiếp giữ đúng thứ tự khai, đọc đúng như lúc viết config.
  const groups: { section: string; fields: CrudFormField[] }[] = []
  for (const field of visible) {
    const key = field.section ?? ''
    const last = groups[groups.length - 1]
    if (last && last.section === key) last.fields.push(field)
    else groups.push({ section: key, fields: [field] })
  }

  const renderGroup = (group: CrudFormField[]) => {
    const inputs = group.filter((field) => field.type !== 'switch')
    const switches = group.filter((field) => field.type === 'switch')

    //  ⚠️ RỔ NÀO LÊN TRƯỚC do ô ĐẦU TIÊN người khai config viết ra quyết định.
    //  Bản cũ luôn để ô nhập lên trên, nên ở cụm *«Quỹ phép và lương»* ô «Hạn
    //  mức mỗi năm» — thứ chỉ hiện ra khi bật công tắc «Trừ vào quỹ phép năm» —
    //  lại nằm PHÍA TRÊN chính cái công tắc mở nó: bật một nút ở dưới thì một ô
    //  mọc ra ở trên, ngoài tầm mắt đang nhìn. Ô phụ thuộc phải đứng sau ô chi
    //  phối nó, và thứ tự khai trong config đã nói đúng điều đó rồi.
    const switchesFirst = group[0]?.type === 'switch'

    const inputGrid = inputs.length > 0 && (
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
        {inputs.map((field) => (
          <CrudField
            key={field.name}
            field={field}
            register={register}
            control={control}
            errors={errors}
            isReadonly={isReadonly(field)}
          />
        ))}
      </div>
    )

    const switchGrid = switches.length > 0 && (
      <div className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2">
        {switches.map((field) => (
          <CrudField
            key={field.name}
            field={field}
            register={register}
            control={control}
            errors={errors}
            isReadonly={isReadonly(field)}
          />
        ))}
      </div>
    )

    return (
      <>
        {switchesFirst ? switchGrid : inputGrid}
        {switchesFirst ? inputGrid : switchGrid}
      </>
    )
  }

  //  ⚠️ `@container` + ngưỡng `@md` / `@2xl`: lưới bám bề rộng CHỖ CHỨA, không
  //  bám bề rộng MÀN HÌNH. Cùng một form chạy ở hai nơi rộng hẹp khác hẳn nhau —
  //  trang chi tiết rộng cả nghìn điểm ảnh, còn hộp thoại thêm mới chỉ hơn 500.
  //  Dùng `sm:` (ngưỡng theo màn hình) thì mở hộp thoại trên màn 24" vẫn ra hai
  //  cột, mỗi cột hơn 200 điểm ảnh: chú thích của một công tắc xuống ba dòng và
  //  hàng đó chật cứng.
  return (
    <div className="@container space-y-5">
      {groups.map(({ section, fields: group }, index) => {
        //  Nhóm KHÔNG TÊN (màn chưa chia nhóm, cụm nhận dạng mở màn, hay mấy ô
        //  lặt vặt ở cuối) dựng trần, không viền: bọc vào thẻ nữa là thẻ lồng
        //  trong thẻ, mà tiêu đề của nó thì không có gì để ghi.
        if (!section) {
          return (
            <div key={`plain-${index}`} className="space-y-4">
              {renderGroup(group)}
            </div>
          )
        }
        //  ⚠️ **Lề trong hẹp lại ở khổ điện thoại.** Form này lồng BA lớp khung —
        //  thẻ form (`CrudDetailPage`) › nhóm có tên (chỗ này) › ô công tắc
        //  (`CrudField`) — và lề của cả ba cộng lại: đo trên màn 390px thì câu
        //  giải thích của một công tắc chỉ còn **208px, tức 53% bề ngang màn
        //  hình**, phần còn lại là lề với viền (báo 09/09/2026). Từng lớp nhìn
        //  riêng đều hợp lý, cái sai chỉ lộ ra khi cộng dồn — nên phải sửa cả ba
        //  chỗ, sửa một chỗ thì không đủ để thấy khác.
        return (
          <section key={section} className="rounded-lg border bg-card">
            <header className="border-b bg-muted/30 px-3 py-2.5 sm:px-4">
              <h3 className="text-sm font-semibold">{section}</h3>
              {sectionHints?.[section] && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {sectionHints[section]}
                </p>
              )}
            </header>
            <div className="space-y-4 px-3 py-3.5 sm:px-4 sm:py-4">{renderGroup(group)}</div>
          </section>
        )
      })}
    </div>
  )
}
