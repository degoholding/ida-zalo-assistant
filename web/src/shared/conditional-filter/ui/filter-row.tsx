import { Trash2 } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { useFilterContext } from '../provider/filter-context'
import { FieldSelect } from './field-select'
import { OperatorSelect } from './operator-select'
import { ValueInput } from './value-input'

/**
 * Một dòng điều kiện: [trường] [phép so sánh] [giá trị] [xóa].
 *
 * ⚠️ **Dưới 768px ba ô XẾP DỌC trong một thẻ riêng.** Bề rộng tối thiểu của hàng
 * ngang là 176 + 160 + 128 + 32 cộng khoảng cách ≈ **510px**, nên trên máy 393px
 * nó tự xuống dòng lung tung: ô «trường» ở dòng một, «phép so sánh» rơi xuống
 * dòng hai cạnh nửa ô giá trị, và khi có hai ba điều kiện thì không còn nhìn ra
 * đâu là ranh giới giữa chúng.
 *
 * ⚠️ **Nút xóa nằm ở HÀNG TIÊU ĐỀ của thẻ, không đứng cạnh ô «trường».** Đặt
 * cạnh ô trường thì ô đó hụt đi 40px so với hai ô dưới, và ba ô đáng ra thẳng
 * hàng lại so le đúng một chỗ — thứ đập vào mắt trước cả nội dung. Đẩy nút lên
 * hàng riêng cùng số thứ tự thì cả ba ô rộng bằng nhau, mà thẻ cũng có được một
 * dòng nói nó là điều kiện thứ mấy.
 *
 * ⚠️ Chỉ dựng **MỘT** nút xóa cho cả hai khổ màn (`md:contents` + `md:order-last`
 * đưa nó về cuối hàng ngang), không chép hai bản: hai nút cùng `aria-label`
 * trong một dòng là trình đọc màn hình đọc ra hai lựa chọn xóa cho một điều
 * kiện.
 *
 * ⚠️ Ô nhập phải ép `bg-background` ở khổ hẹp. Nền thẻ là `bg-muted`, mà
 * `SelectTrigger`/`Input` của shadcn để nền TRONG SUỐT — không ép thì ba ô ăn
 * luôn màu thẻ và cả cụm bệt thành một mảng xám, chỉ còn đường viền mảnh phân
 * biệt "chỗ bấm được" với "nền". Ép ở đây bằng biến thể con thay vì sửa từng ô:
 * `ValueInput` rẽ tới sáu nhánh (ngày · khoảng · số · danh sách · chọn nhiều ·
 * chữ), vá từng nhánh là sót.
 */
export function FilterRowItem({ rowId }: { rowId: string }) {
  const { state, removeRow } = useFilterContext()
  const index = state.rows.findIndex((item) => item.id === rowId)
  const row = state.rows[index]

  if (!row) return null

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-muted/60 p-3 md:flex-row md:items-center md:gap-2 md:rounded-none md:bg-transparent md:p-0 md:py-1 [&_[data-slot=select-trigger]]:bg-background [&_input]:bg-background md:[&_[data-slot=select-trigger]]:bg-transparent md:[&_input]:bg-transparent">
      {/*  `md:contents` gỡ khối bọc này ở màn rộng để nút xóa trở lại làm con
           trực tiếp của hàng — nhờ vậy `md:ml-auto` của nó mới đo theo cả hàng
           chứ không theo mỗi khối bọc. */}
      <div className="flex items-center justify-between md:contents">
        <span className="text-xs font-medium text-muted-foreground md:hidden">
          Điều kiện {index + 1}
        </span>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground md:order-last md:ml-auto"
          aria-label="Xóa điều kiện"
          onClick={() => removeRow(row.id)}
        >
          <Trash2 />
        </Button>
      </div>

      <FieldSelect rowId={row.id} selectedField={row.field} />

      {row.field && (
        <OperatorSelect
          rowId={row.id}
          field={row.field}
          selectedOperator={row.operator}
        />
      )}

      {row.field && row.operator && (
        <div className="flex min-w-0 flex-1">
          <ValueInput
            rowId={row.id}
            field={row.field}
            operator={row.operator}
            value={row.value}
          />
        </div>
      )}
    </div>
  )
}
