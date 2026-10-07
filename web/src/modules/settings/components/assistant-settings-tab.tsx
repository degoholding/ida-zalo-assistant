import { ChevronRight, Info, KeyRound } from 'lucide-react'

import { Skeleton } from '@/shared/ui/skeleton'
import { ASSISTANT_SECTIONS } from '../config/settings-sections'
import { useAiKeys } from '../hooks/use-ai-keys'
import type { SettingView } from '../types/setting'
import { splitLegacyAiSettings } from '../utils/split-legacy-ai-settings'
import { SettingsSectionsForm } from './settings-sections-form'

interface AssistantSettingsTabProps {
  settings: SettingView[]
  disabled?: boolean
}

/**
 * Tab «Trợ lý AI». Đã có khóa ở tab «Khóa AI» thì các ô AI cách cũ (nhà cung cấp, khóa, mô hình Gemini / OpenAI) KHÔNG còn
 * tác dụng — gập vào mục «Nâng cao (cách cũ)» kèm câu giải thích, thay vì bày 10 ô khiến quản trị tưởng phải điền.
 */
export function AssistantSettingsTab({ settings, disabled }: AssistantSettingsTabProps) {
  const aiKeys = useAiKeys()
  const { current, legacy } = splitLegacyAiSettings(settings)

  if (aiKeys.isLoading) return <Skeleton className="h-96 w-full" />

  const usingKeyList = (aiKeys.data ?? []).some((item) => !item.broken)
  if (!usingKeyList) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          Dễ hơn: thêm khóa ở tab «Khóa AI» — xếp thứ tự khóa, khóa hỏng thì bot tự chuyển khóa kế. Có khóa ở đó thì các ô
          nhà cung cấp / khóa / mô hình dưới đây thôi dùng.
        </p>
        <SettingsSectionsForm settings={settings} sections={ASSISTANT_SECTIONS} disabled={disabled} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SettingsSectionsForm settings={current} sections={ASSISTANT_SECTIONS} disabled={disabled} />
      {legacy.length > 0 && (
        <details className="group rounded-md border bg-background">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
            Nâng cao (cách cũ): nhà cung cấp, khóa và mô hình Gemini / OpenAI
          </summary>
          <div className="space-y-4 border-t px-4 py-3">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              Bot đang dùng danh sách ở tab «Khóa AI», nên các ô dưới đây không có tác dụng. Chúng chỉ được dùng lại khi tab
              «Khóa AI» không còn khóa nào. Giữ lại để cấu hình .env cũ không vỡ.
            </p>
            <SettingsSectionsForm settings={legacy} sections={ASSISTANT_SECTIONS} disabled={disabled} />
          </div>
        </details>
      )}
    </div>
  )
}
