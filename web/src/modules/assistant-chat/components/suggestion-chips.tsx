import { Button } from '@/shared/ui/button'

/** Vài câu gợi ý khi cuộc còn trống — giúp người mới thấy ngay trợ lý làm được gì. */
const SUGGESTIONS = [
  'Tóm tắt các nhóm hôm nay',
  'Có việc gì cần anh xử lý không?',
  'Tìm file báo giá gần đây',
  'Xuất Excel báo cáo các nhóm 3 ngày qua',
]

interface SuggestionChipsProps {
  onPick: (text: string) => void
}

export function SuggestionChips({ onPick }: SuggestionChipsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 px-4">
      {SUGGESTIONS.map((text) => (
        <Button key={text} type="button" variant="outline" size="sm" onClick={() => onPick(text)}>
          {text}
        </Button>
      ))}
    </div>
  )
}
