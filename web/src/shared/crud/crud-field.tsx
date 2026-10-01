import { Controller, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'

import { DatePicker } from '@/shared/ui/date-picker'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Textarea } from '@/shared/ui/textarea'
import { cn } from '@/shared/utils/cn'
import { formatDate } from '@/shared/utils/format-date'
import { getPath } from './field-path'
import { withCurrentValue } from './field-values'
import type { CrudFormField } from './types'
import { useCrudSourceOptions } from './use-crud'

type FormValues = Record<string, unknown>

interface CrudFieldProps {
  field: CrudFormField
  register: UseFormRegister<FormValues>
  control: Control<FormValues>
  errors: FieldErrors<FormValues>
  /** Chỉ xem: hiện chữ thường thay vì ô nhập (xem `ReadOnlyValue`). */
  isReadonly?: boolean
}

/**
 * Một ô của form CRUD — dùng CHUNG cho hộp thoại thêm mới và trang chi tiết.
 *
 * Trước đây hai màn mỗi màn giữ một bản sao y hệt nhau; thêm kiểu ô mới phải sửa
 * hai chỗ và quên một chỗ là thêm mới với sửa hiện khác nhau.
 */
export function CrudField({ field, register, control, errors, isReadonly }: CrudFieldProps) {
  const isFullWidth = field.fullWidth || field.type === 'textarea'
  //  ⚠️ `getPath`, không phải `errors[field.name]`. react-hook-form dựng cây
  //  lỗi LỒNG theo dấu chấm, nên ô `'extra_fields.so_gp'` có lỗi thì nó nằm ở
  //  `errors.extra_fields.so_gp` — tra bằng khóa trần luôn ra `undefined`. Hậu
  //  quả là im lặng tuyệt đối: react-hook-form chặn submit vì ô sai, mà không
  //  câu báo lỗi nào hiện ra, nên bấm Lưu thì **không có gì xảy ra** (đúng bẫy
  //  thứ nhất của duoc-CR-317).
  const errorMessage = (getPath(errors, field.name) as { message?: string } | undefined)
    ?.message
  //  Ô SỐ hẹp lại: bề ngang của ô là lời hứa về lượng chữ phải gõ. Kéo ô nhập
  //  «Tối đa mỗi lần nghỉ (ngày)» dài nửa màn hình cho một con số hai chữ số thì
  //  nó đọc như một ô ghi chú bỏ trống. Chỉ ô nhập bị chặn, còn nhãn và chú thích
  //  vẫn rộng bằng cả cột — chú thích mới là chỗ cần chỗ để xuống dòng.
  const isNumeric = field.type === 'number' || field.type === 'percent'

  //  Công tắc đi theo khuôn KHÁC hẳn ô nhập — xem `CrudSwitchRow`.
  if (field.type === 'switch') {
    return <CrudSwitchRow field={field} control={control} isReadonly={isReadonly} />
  }

  //  Ô TỰ VẼ — trả thẳng component của config, KHÔNG bọc nhãn/dấu sao/câu lỗi.
  //  Thứ dựng ở đây là bảng con hoặc trình khai động, tự có tiêu đề và luật báo
  //  lỗi riêng; thêm một cái nhãn bên trên là nói hai lần cùng một điều.
  if (field.type === 'custom') {
    return (
      <div className="col-span-full">
        {field.render?.({ control, name: field.name, disabled: Boolean(isReadonly) })}
      </div>
    )
  }

  return (
    //  `col-span-full`, KHÔNG phải `sm:col-span-2`: lưới bao ngoài đếm cột theo
    //  bề rộng CHỖ CHỨA (`@md:`), còn `sm:` đếm theo bề rộng MÀN HÌNH — hai
    //  ngưỡng khác hệ quy chiếu, nên mở hộp thoại hẹp trên màn 24" là ô ghi chú
    //  đòi 2 cột trong một lưới chỉ có 1.
    <div className={cn('space-y-1.5', isFullWidth && 'col-span-full')}>
      <Label htmlFor={field.name} className="flex items-center gap-1">
        {field.label}
        {field.required && !isReadonly && <span className="text-destructive">*</span>}
      </Label>

      {isReadonly ? (
        <CrudFieldReadOnly field={field} control={control} />
      ) : field.type === 'textarea' ? (
        <Textarea
          id={field.name}
          placeholder={field.placeholder}
          rows={3}
          {...register(field.name, {
            required: field.required ? `${field.label} là bắt buộc` : false,
          })}
        />
      ) : field.type === 'select' ? (
        <CrudSelectField field={field} control={control} />
      ) : field.type === 'date' ? (
        <Controller
          control={control}
          name={field.name}
          rules={{ required: field.required ? `${field.label} là bắt buộc` : false }}
          render={({ field: controllerField }) => (
            <DatePicker
              value={String(controllerField.value ?? '')}
              onChange={controllerField.onChange}
            />
          )}
        />
      ) : (
        <Input
          id={field.name}
          className={cn(isNumeric && 'max-w-[220px]')}
          type={isNumeric ? 'number' : 'text'}
          step={field.type === 'percent' ? '0.1' : undefined}
          placeholder={field.placeholder}
          {...register(field.name, {
            required: field.required ? `${field.label} là bắt buộc` : false,
            // Ràng buộc của backend cho trường tỉ lệ là `ge=0, lt=1` (CR-058), tức
            // 0 <= phần trăm < 100. Chặn ngay tại form cho khỏi ăn 422 sau khi bấm Lưu.
            ...(field.type === 'percent'
              ? {
                  min: { value: 0, message: `${field.label} không được âm` },
                  max: { value: 99.99, message: `${field.label} phải nhỏ hơn 100` },
                }
              : {}),
          })}
        />
      )}

      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
      {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
    </div>
  )
}

/**
 * CÔNG TẮC — một HÀNG NGANG, không phải một ô trong lưới.
 *
 * Bản cũ nhét công tắc vào đúng khuôn của ô nhập: nhãn ở trên, công tắc ở dưới,
 * cạnh nó là chữ *«Đang dùng / Hoạt động»*, rồi chú thích ở dòng thứ ba. Ba
 * chuyện hỏng cùng lúc, thấy rõ nhất ở màn *Loại nghỉ* (07/09/2026):
 *
 * 1. **Chữ trạng thái là chữ thừa** — nó nói lại đúng thứ cái công tắc ngay bên
 *    trái đang nói, mà lại nói bằng từ của danh mục ("Hoạt động") nên với một
 *    nút tên *«Có hưởng lương»* thì câu đó đọc không ra nghĩa gì.
 * 2. **Cao thấp lệch nhau.** Công tắc cao 3 dòng, ô nhập cao 2 — xếp xen kẽ
 *    trong lưới hai cột là hàng nào cũng so le, và hàng lẻ chừa một lỗ trắng
 *    bằng nửa màn hình.
 * 3. Người đọc phải quét theo chiều dọc để biết cái nào bật, cái nào tắt.
 *
 * Khuôn mới: **nhãn + chú thích bên trái, công tắc ở lề phải**, cả hàng có
 * viền — đọc một cột thẳng đứng là thấy ngay cái nào đang bật. Bấm vào nhãn
 * cũng lật được công tắc (`htmlFor`), nên vùng bấm rộng gấp mấy lần.
 *
 * ⚠️ Hàng này **KHÔNG chiếm trọn bề ngang** (xếp trong lưới 2 cột, xem
 * `CrudFormFields`). Bản đầu cho nó full-width: trên màn 24" nhãn nằm mép trái
 * còn công tắc dính mép phải, cách nhau gần một mét — mắt phải chạy ngang cả
 * màn hình mới biết cái nhãn vừa đọc đang bật hay tắt.
 */
function CrudSwitchRow({
  field,
  control,
  isReadonly,
}: {
  field: CrudFormField
  control: Control<FormValues>
  isReadonly?: boolean
}) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controllerField }) => (
        //  Lề trong hẹp lại ở khổ điện thoại — đây là lớp khung THỨ BA (thẻ form
        //  › nhóm › ô công tắc) và lề của cả ba cộng lại mới là thứ bóp chữ, xem
        //  ghi chú ở `crud-form-fields.tsx`.
        <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2.5 sm:px-3.5 sm:py-3">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor={field.name} className="cursor-pointer">
              {field.label}
            </Label>
            {field.hint && (
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            )}
          </div>

          {isReadonly ? (
            //  Chỉ xem thì phải nói bằng CHỮ. Một công tắc bị khóa nhìn y hệt
            //  một công tắc tắt — người xem không phân biệt được "đang tắt" với
            //  "không được sửa".
            <span className="shrink-0 text-sm font-medium">
              {controllerField.value ? 'Có' : 'Không'}
            </span>
          ) : (
            <Switch
              id={field.name}
              className="mt-0.5 shrink-0"
              checked={Boolean(controllerField.value)}
              onCheckedChange={controllerField.onChange}
            />
          )}
        </div>
      )}
    />
  )
}

/**
 * Ô CHỈ XEM.
 *
 * ⚠️ KHÔNG dùng `<Input disabled>` ở đây: `disabled` gỡ luôn khả năng nhận con
 * trỏ nên không bôi đen / không copy được — mã số thuế, số tài khoản ngân hàng
 * của nhà cung cấp là những thứ người dùng chép ra ngoài nhiều nhất (CR-105).
 */
function CrudFieldReadOnly({
  field,
  control,
}: {
  field: CrudFormField
  control: Control<FormValues>
}) {
  const { data: remoteOptions } = useCrudSourceOptions(
    // Ô chọn tĩnh thì khỏi gọi mạng chỉ để dịch một nhãn.
    field.type === 'select' && !field.options ? field.source : undefined,
  )

  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: controllerField }) => {
        const value = controllerField.value

        if (field.type === 'switch') {
          return (
            <ReadOnlyValue>{value ? 'Đang dùng / Hoạt động' : 'Ngừng / Ẩn'}</ReadOnlyValue>
          )
        }
        if (field.type === 'percent') {
          return <ReadOnlyValue>{`${Number(value ?? 0)}%`}</ReadOnlyValue>
        }
        if (field.type === 'date') {
          return <ReadOnlyValue>{formatDate(String(value ?? ''))}</ReadOnlyValue>
        }
        if (field.type === 'select') {
          const options = field.options ?? remoteOptions ?? []
          const matched = options.find((opt) => String(opt.value) === String(value ?? ''))
          return <ReadOnlyValue>{matched?.label ?? String(value ?? '')}</ReadOnlyValue>
        }

        return (
          <ReadOnlyValue multiline={field.type === 'textarea'}>
            {String(value ?? '')}
          </ReadOnlyValue>
        )
      }}
    />
  )
}

function CrudSelectField({
  field,
  control,
}: {
  field: CrudFormField
  control: Control<FormValues>
}) {
  const { data: remoteOptions, isLoading } = useCrudSourceOptions(field.source)
  const options = field.options ?? remoteOptions ?? []

  return (
    <Controller
      control={control}
      name={field.name}
      rules={{ required: field.required ? `${field.label} là bắt buộc` : false }}
      render={({ field: controllerField }) => (
        <Select
          //  Giá trị KHÔNG khớp mục nào (`0` / rỗng của ô chọn tham chiếu) thì
          //  đưa Radix chuỗi rỗng để nó rơi về CHỮ GỢI Ý. Đưa thẳng `'0'` thì ô
          //  trông trắng trơn — không phải chữ gợi ý, cũng không phải giá trị,
          //  người dùng không biết ô đó đã chọn gì hay chưa. Giá trị cũ ngoài
          //  danh sách vẫn hiện bình thường vì `withCurrentValue` đã bù nó vào.
          value={
            withCurrentValue(options, controllerField.value).some(
              (opt) => String(opt.value) === String(controllerField.value ?? ''),
            )
              ? String(controllerField.value ?? '')
              : ''
          }
          onValueChange={(val) => {
            // ⚠️ BỎ QUA chuỗi rỗng — KHÔNG phải người dùng chọn.
            //
            // Radix giữ một thẻ `<select>` ẩn để đồng bộ với form, và đồng bộ bằng
            // cách GÁN THẲNG `select.value`. Trình duyệt ép giá trị nào chưa có
            // `<option>` tương ứng NGAY LÚC ĐÓ về chuỗi rỗng rồi bắn `change`, Radix
            // gọi ngược `onValueChange('')` và giá trị thật trong form bị xóa trắng.
            // Trúng đúng hai ca hay gặp: ô nạp options từ API (options về SAU khi
            // `reset` đổ dữ liệu) và giá trị cũ ngoài danh sách khai (mục bù của
            // `withCurrentValue` vào danh sách chậm hơn một nhịp vẽ) — mở hợp đồng
            // HDX0177 thì "Loại hợp đồng" và "Công ty pháp nhân" đều hiện chữ gợi ý
            // như ô trống, bấm Lưu là ghi rỗng đè lên dữ liệu thật.
            // Người dùng không cách nào chọn ra chuỗi rỗng (`SelectItem value=""` là
            // lỗi của Radix), nên gặp '' thì chắc chắn là nhịp đồng bộ này.
            if (val === '') return
            // Options kiểu boolean gửi lên dạng chuỗi, phải dựng lại đúng kiểu.
            if (val === 'true') controllerField.onChange(true)
            else if (val === 'false') controllerField.onChange(false)
            else controllerField.onChange(val)
          }}
          disabled={isLoading}
        >
          <SelectTrigger id={field.name} className="w-full">
            <SelectValue placeholder={field.placeholder || `Chọn ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {withCurrentValue(options, controllerField.value).map((opt) => (
              <SelectItem key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  )
}
