import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils/cn'

interface CopyButtonProps {
  /** Chuỗi sẽ nằm trong bộ nhớ tạm. Rỗng thì không vẽ nút. */
  value: string
  /** Tên thứ đang chép — chỉ dùng cho nhãn trợ năng, ví dụ "mã hàng". */
  label?: string
  className?: string
}

/**
 * Nút chép một giá trị ra bộ nhớ tạm.
 *
 * Có mặt vì những ô CHỌN (mã hàng, ĐVT, kho nhận) thực chất là `<button>` chứ
 * không phải chữ: bôi đen không được nên người dùng không lấy nổi mã vật tư đem
 * đi tra ở MISA hay dán vào chat. Chữ thường thì copy sẵn rồi, nút này chỉ là
 * đường tắt.
 */
export function CopyButton({ value, label = 'giá trị', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  if (!value) return null

  async function copy() {
    try {
      // `navigator.clipboard` chỉ tồn tại ở ngữ cảnh bảo mật (https / localhost).
      // Mở app bằng IP nội bộ qua http là không có, nên phải có đường lui.
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      toast.error('Trình duyệt không cho chép tự động — bôi đen rồi bấm Ctrl+C.')
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={copied ? 'Đã chép' : `Chép ${label}`}
      aria-label={copied ? `Đã chép ${label}` : `Chép ${label}: ${value}`}
      className={cn('shrink-0 text-muted-foreground', className)}
      onClick={() => void copy()}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
    </Button>
  )
}
