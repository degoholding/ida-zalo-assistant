import { Search, X } from 'lucide-react'

import { useIsMobile } from '@/shared/hooks/use-mobile'
import { cn } from '@/shared/utils/cn'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /**
   * Câu gợi ý RÚT GỌN dùng dưới 768px, nơi ô tìm phải chia hàng với mấy nút.
   *
   * ⚠️ Phải đổi bằng JS chứ không giấu bớt chữ bằng CSS được: `placeholder` là
   * một thuộc tính, không phải một nút trong cây DOM — không có gì để gắn
   * `max-md:hidden` vào. Cắt bằng bề rộng ô thì trình duyệt xén giữa chừng và ra
   * «Tìm tên, số hiệu, từ k…», tức người đọc mất đúng phần cuối — mà phần cuối
   * mới là thứ họ chưa đoán được (*từ khóa*, *loại*, *bước*).
   *
   * ⚠️ **TRẦN ~100px, tức khoảng HAI vế.** Đây là chỗ dễ viết hụt nhất: câu
   * "rút gọn" ba vế tốn 134–156px, mà ô tìm ở khổ hẹp chỉ còn **134px** (390px)
   * hoặc **102px** (iPhone SE/mini 375px) sau khi chia hàng với nút *Bộ lọc* và
   * *Tải lại* — màn nào có thêm chip trên thanh công cụ thì còn **73px**. Viết
   * dài thì bản rút gọn bị xén y như bản đầy đủ, tức nó chẳng giải quyết được
   * gì. Đo ngày 14/09/2026; sáu màn Thu mua đều phải rút lại một lượt.
   *
   * ⚠️ **Ô hẹp dưới ~100px thì rút chữ KHÔNG cứu được** — phải trả lại chỗ cho
   * ô: xem `QuickFilterSheetProps.iconOnly`.
   *
   * Bỏ trống thì dùng `placeholder` cho mọi khổ.
   */
  placeholderShort?: string
  className?: string
  'aria-label'?: string
}

/**
 * Ô TÌM KIẾM của thanh công cụ — một khối liền, có nút xóa chữ.
 *
 * Khác `<Input>` trần đúng một chỗ: **nút xóa chữ** hiện ngay khi có chữ. Trên
 * máy tính người ta bôi đen rồi xóa; trên điện thoại thao tác đó là giữ · kéo
 * hai đầu · bấm xóa, cho một việc đáng ra một chạm.
 *
 * ⚠️ **Đừng nhét nút «Bộ lọc» vào trong ô này.** Đã làm rồi và đã bỏ: một cái
 * phễu nằm lọt trong khung viền của ô tìm đọc ra như "tùy chọn tìm kiếm" chứ
 * không ra một bộ lọc riêng — người dùng nhìn vào không đoán được nó làm gì.
 * Nút lọc đứng RIÊNG bên cạnh, có chữ «Bộ lọc», thì không phải đoán.
 *
 * ⚠️ Dựng bằng `<input>` trần trong một khối có viền, KHÔNG lồng `<Input>` của
 * shadcn vào: `Input` tự vẽ viền + nền + vòng focus của riêng nó, lồng vào là
 * hai đường viền lồng nhau lệch 1px và hai vòng sáng khi bấm vào ô.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  placeholderShort,
  className,
  'aria-label': ariaLabel = 'Tìm kiếm',
}: SearchFieldProps) {
  const isMobile = useIsMobile()
  const hint = isMobile && placeholderShort ? placeholderShort : placeholder

  return (
    <div
      className={cn(
        //  `focus-within` chứ không `focus`: vòng sáng thuộc về cả khối, mà thứ
        //  nhận con trỏ lại là thẻ `<input>` bên trong.
        'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-transparent px-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

      <input
        type="text"
        aria-label={ariaLabel}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder={hint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {value && (
        <button
          type="button"
          aria-label="Xóa từ khóa tìm kiếm"
          className="-mr-1 shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onChange('')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
