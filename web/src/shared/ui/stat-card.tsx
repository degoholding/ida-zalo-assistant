import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/utils/cn'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: number | string
  hint?: string
  /** Tô màu dòng chú thích khi có việc cần làm. */
  tone?: 'warning' | 'danger'
  loading?: boolean
  /** Có `to` thì cả thẻ thành liên kết — bấm vào mở danh sách đã lọc theo nội dung thẻ. */
  to?: string
  /**
   * Lớp phụ cho Ô LƯỚI chứa thẻ — chỗ để trang tự quyết thẻ nào chiếm mấy cột.
   *
   * Có prop này vì ở khổ điện thoại dải KPI xếp HAI ô một hàng, mà ô chứa số
   * TIỀN thì không vừa nửa hàng: `1.025.242.640 đ` ở `text-xl` cần ~150px trong
   * khi nửa hàng 390px chỉ còn ~131px cho nội dung — số tự gãy làm đôi. Trang
   * truyền `max-sm:col-span-2` cho riêng ô đó.
   */
  className?: string
}

/**
 * Ô số liệu của trang tổng quan — dùng chung cho mọi phân hệ.
 *
 * Trước đây khai riêng trong trang Thu mua; tách ra khi phân hệ Văn thư cần
 * đúng khối này. Chép sang là hai trang tổng quan lệch nhau dần từ lần sửa
 * đầu tiên.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  loading = false,
  to,
  className,
}: StatCardProps) {
  //  10 ký tự ≈ `9.999.999 đ`. Dưới mức đó thì `text-xl` vừa cả thẻ hẹp nhất.
  const isLongValue = String(value).length > 10

  const card = (
    //  Đệm 16px và chữ nhỏ hơn một bậc so với thẻ shadcn mặc định: dải này
    //  thường xếp NĂM ô một hàng, mà năm ô rộng theo cỡ mặc định thì dưới
    //  1500px là nhãn nào cũng gãy đôi.
    <Card
      className={cn(
        //  ⚠️ `@container/stat` là để CON SỐ tự co theo bề rộng THẺ, không theo
        //  bề rộng màn hình — xem ghi chú ở thẻ `<p>` bên dưới.
        '@container/stat gap-1.5 py-4',
        //  ⚠️ `h-full` là chốt CAO ĐỀU CẢ HÀNG, không phải trang trí. Thẻ CÓ `to`
        //  thì ô lưới là thẻ `Link` bọc ngoài: ô lưới giãn cao bằng hàng, nhưng
        //  `Card` bên trong vẫn cao theo nội dung nên nó THỤT LÊN, chừa một
        //  khoảng trống dưới đáy. Thẻ KHÔNG có `to` thì chính `Card` là ô lưới
        //  nên nó cao đủ. Hậu quả: cùng một dải KPI, thẻ bấm được thấp hơn thẻ
        //  không bấm được, và chỉ cần một dòng chú thích gãy hai dòng là cả dải
        //  so le (thấy trên Tổng quan Đặt xe, 19/09/2026).
        'h-full',
        //  Có `to`: cho cảm giác bấm được (con trỏ + đổi nền/viền khi rê chuột).
        to && 'cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40',
        //  Có `to` thì ô lưới là thẻ `Link` bọc ngoài, `className` gắn ở đó.
        !to && className,
      )}
    >
      {/*  `flex` chứ không chỉ `flex-row`: `CardHeader` gốc là `grid`, hai lớp khác
           nhóm nên `grid` vẫn thắng — thiếu chữ này thì biểu tượng và nhãn xếp
           CHỒNG lên nhau thay vì nằm cạnh (đo được 25/08/2026: y=229 vs y=269).

           ⚠️ `min-h-8` là chốt CANH HÀNG, không phải khoảng thở. Nhãn dài gãy
           làm hai dòng thì hàng này cao thêm ~17px và con số của riêng thẻ đó
           tụt xuống, tức năm con số trên cùng một hàng không còn thẳng — thứ
           đập vào mắt trước cả nội dung. Chặn sàn đúng bằng chiều cao biểu
           tượng (32px) thì một dòng hay hai dòng cũng cao như nhau: 2 dòng
           `text-xs` + `leading-tight` = 30px, vẫn lọt. Đo ở 1440px: trước khi
           có nó, thẻ «Đơn nghỉ chờ duyệt» có số nằm thấp hơn bốn thẻ kia 3px. */}
      {/*  ⚠️ `px-4` dưới 640px là chỗ THỞ CHO CHỮ, không phải tinh chỉnh: dải KPI
           ở khổ điện thoại xếp hai ô một hàng, mỗi ô còn ~171px, trừ đệm và ô
           biểu tượng thì nhãn chỉ còn ~95px. Mỗi bên bớt 4px là nhãn dài kiểu
           «YC báo giá chờ duyệt» đổi từ ba dòng (vượt `line-clamp-2`, mất chữ
           cuối) xuống hai dòng. Từ `sm` trở lên thẻ đã rộng, trả về `px-5`. */}
      <CardHeader className="flex min-h-8 flex-row items-center gap-2 px-4 pb-0 sm:px-5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-3.5" />
        </span>
        {/*  `leading-tight` đè `leading-none` của `CardTitle`: nhãn dài xuống hai
             dòng thì hai dòng đó dính sát nhau, đọc ra như một khối chữ đặc.
             `line-clamp-2` chặn nhãn ba dòng làm vỡ chiều cao cả hàng. */}
        <CardTitle className="line-clamp-2 text-xs leading-tight font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 sm:px-5">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          //  ⚠️ **Số DÀI hạ một bậc cỡ chữ khi THẺ hẹp** — hai điều kiện, thiếu
          //  vế nào cũng sai:
          //
          //  · Theo CHỖ CHỨA (`@max-[200px]/stat`) chứ không theo bề rộng màn
          //    hình: cùng khổ 390px, thẻ nửa hàng chỉ còn 139px cho chữ, còn
          //    thẻ khai `col-span-2` có tới 326px — luật theo `max-sm:` sẽ bóp
          //    nhầm cả thẻ đang rộng rãi. 200px là chỗ `1.463.393.999 đ` ở
          //    `text-xl` (~141px + 32px đệm) bắt đầu không vừa.
          //  · Chỉ áp cho số DÀI (`isLongValue`): thẻ đếm việc bày «0» hay «96»,
          //    hạ cỡ chúng là làm nhỏ đi đúng thứ người ta mở trang ra để đọc,
          //    mà chúng thì có bao giờ chật chỗ đâu.
          //
          //  Thiếu luật này thì ở dải KPI hai cột, số tiền **gãy làm hai dòng**
          //  và thẻ đó cao hơn thẻ bên cạnh — thấy rõ nhất ở Báo cáo mua hàng,
          //  nơi bốn trong năm thẻ đều là tiền.
          <p
            className={cn(
              'text-xl font-semibold text-navy dark:text-foreground',
              isLongValue && '@max-[200px]/stat:text-base',
            )}
          >
            {value}
          </p>
        )}
        {hint && (
          //  Dòng chú thích được phép xuống hai dòng, KHÔNG cắt bằng `truncate`:
          //  ở Tài chính nó chứa số tiền (`Tổng phát sinh: 4.760.000.000 đ`),
          //  cắt đuôi là giấu mất chữ số. Bù lại, nơi gọi phải giữ câu ngắn.
          <p
            className={cn(
              'mt-0.5 text-[11px] leading-snug text-muted-foreground',
              tone === 'warning' && 'text-warning',
              tone === 'danger' && 'text-destructive',
            )}
          >
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  )

  if (!to) return card
  return (
    <Link
      to={to}
      aria-label={`${label} — mở danh sách`}
      className={cn(
        //  `h-full`: ô lưới giãn cao bằng hàng thì thẻ bên trong mới có gì để
        //  bám vào mà giãn theo (xem ghi chú `h-full` ở `Card`).
        'block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {card}
    </Link>
  )
}
