import { TriangleAlert } from 'lucide-react'

/** Cảnh báo trợ lý AI đang tắt — hiện phía trên khung chat, ô soạn bị khoá kèm theo. */
export function AssistantOffBanner() {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <TriangleAlert className="size-4 shrink-0" />
      Trợ lý AI đang tắt — đặt khóa Gemini ở màn Cài đặt.
    </div>
  )
}
