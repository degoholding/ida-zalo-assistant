import { ArrowUp, CircleAlert, ExternalLink, KeyRound, Loader2, Pencil, ShieldOff, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader } from '@/shared/ui/card'
import { confirm } from '@/shared/ui/confirm-dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/utils/cn'
import { AI_KEY_INTRO, AI_KEY_PROVIDER_OPTIONS, findAiKeyProviderOption } from '../config/ai-key-providers'
import { AiKeyProvider, type AiKeyInput, type AiKeyItem, type AiKeyPatch } from '../types/ai-key'
import { describeAiKeyUsage } from '../utils/describe-ai-key-usage'
import { formatAiKeyLastError } from '../utils/format-ai-key-last-error'

interface AiKeyListCardProps {
  items: AiKeyItem[]
  isLoading: boolean
  canWrite: boolean
  /** Đang gọi thử hãng / lưu khóa mới. */
  saving: boolean
  /** Ném lỗi khi máy chủ từ chối (sai khóa, sai trạm) — ô nhập giữ nguyên để sửa. */
  onAdd: (body: AiKeyInput) => Promise<unknown>
  onUpdate: (id: number, body: AiKeyPatch) => void
  onMoveUp: (id: number) => void
  onRemove: (id: number) => void
  /** Mốc «hôm nay» khi hiện «lỗi lúc hh:mm» — bài kiểm truyền ngày cố định. */
  now?: Date
}

/** Ô gợi ý tên mô hình theo hãng (datalist gốc của trình duyệt — gõ tên khác vẫn được). */
function ModelSuggestions({ id, provider }: { id: string; provider: AiKeyProvider }) {
  return (
    <datalist id={id}>
      {(findAiKeyProviderOption(provider)?.models ?? []).map((model) => (
        <option key={model} value={model} />
      ))}
    </datalist>
  )
}

/**
 * Thẻ «Khóa AI» (07/10/2026, theo khuôn thẻ Khóa AI của ERP DEGO — ai-CR-101/108): danh sách khóa có thứ tự 1, 2, 3…;
 * thêm khóa ba bước trên một hàng (Hãng → Địa chỉ trạm / Lấy khóa → Dán khóa); mô hình + trần lượt gập vào «Tùy chọn».
 * Khóa thô chỉ đi VÀO (ô password, xóa trắng sau khi lưu); màn hình chỉ thấy 4 ký tự cuối.
 */
export function AiKeyListCard({ items, isLoading, canWrite, saving, onAdd, onUpdate, onMoveUp, onRemove, now }: AiKeyListCardProps) {
  const idPrefix = useId()
  const [provider, setProvider] = useState<AiKeyProvider>(AI_KEY_PROVIDER_OPTIONS[0].value)
  const [draft, setDraft] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [modelHeavy, setModelHeavy] = useState('')
  const [cap, setCap] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  // Chặn bấm đúp ngay trong cùng nhịp — `saving` là state nên trễ một lượt vẽ
  const busy = useRef(false)
  const current = findAiKeyProviderOption(provider) ?? AI_KEY_PROVIDER_OPTIONS[0]
  const custom = provider === AiKeyProvider.OpenAICompatible
  const canSave = Boolean(draft.trim()) && !saving && (!custom || Boolean(baseUrl.trim()))
  const today = now ?? new Date()

  async function handleSave() {
    if (!canSave || busy.current) return
    busy.current = true
    try {
      await onAdd({
        provider,
        key: draft.trim(),
        model: model.trim(),
        model_heavy: modelHeavy.trim(),
        daily_cap: Math.max(0, Math.floor(Number(cap) || 0)),
        ...(custom ? { base_url: baseUrl.trim() } : {}),
      })
      setDraft('')
      setModel('')
      setModelHeavy('')
      setCap('')
      setBaseUrl('')
    } catch {
      // Câu lỗi của máy chủ đã hiện bằng toast; giữ nguyên ô nhập để sửa
    } finally {
      busy.current = false
    }
  }

  async function handleRemove(item: AiKeyItem) {
    const last = items.length === 1
    const ok = await confirm({
      title: 'Gỡ khóa AI',
      message: `Gỡ khóa số ${item.position} — ${item.provider_label} ${item.key_tail}? Bot sẽ không dùng khóa này nữa.${
        last ? ' Đây là khóa cuối cùng: gỡ xong bot quay về cài đặt cũ ở tab «Trợ lý AI».' : ''
      }`,
      confirmLabel: 'Gỡ khóa',
    })
    if (ok) onRemove(item.id)
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-start gap-3 border-b px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <KeyRound className="size-4" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold text-navy dark:text-foreground">Khóa AI</h3>
          <p className="text-xs text-muted-foreground">{AI_KEY_INTRO}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5 py-4 text-sm">
        {isLoading && <Skeleton className="h-10 w-full" />}
        {!isLoading && items.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-muted-foreground">
            Chưa có khóa nào — bot đang chạy bằng cài đặt cũ ở tab «Trợ lý AI». Thêm khóa bên dưới là bot chuyển sang dùng
            danh sách này.
          </p>
        )}
        {!isLoading && items.length > 0 && (
          <ol className="divide-y rounded-md border">
            {items.map((item, index) => {
              const lastError = formatAiKeyLastError(item, today)
              return (
                <li key={item.id} className={cn('space-y-2 px-3 py-2.5', item.allowed === false && 'bg-muted/40')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {index + 1}
                    </span>
                    {/* Hãng chưa được phép thì làm mờ phần thông tin (nút vẫn rõ để gỡ / sắp xếp) — bot đang bỏ qua khóa này */}
                    <div className={cn('min-w-0 flex-1', item.allowed === false && 'text-muted-foreground')}>
                      <p>
                        <span className="font-medium">{item.provider_label}</span>{' '}
                        <span className="font-mono text-xs text-muted-foreground">{item.key_tail}</span>
                        {item.broken && (
                          <Badge variant="destructive" className="ml-2">
                            Không đọc được — gỡ rồi thêm lại
                          </Badge>
                        )}
                        {item.allowed === false && (
                          <Badge
                            variant="outline"
                            className="ml-2 border-warning/40 bg-warning/10 text-warning"
                            title="Tick hãng này ở tab «Trợ lý AI» › «An toàn dữ liệu» › «Hãng AI được phép dùng» để bot dùng lại khóa"
                          >
                            <ShieldOff />
                            Hãng chưa được phép — bot bỏ qua
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{describeAiKeyUsage(item)}</p>
                      {lastError && (
                        <p className="flex items-center gap-1 text-xs text-destructive">
                          <CircleAlert className="size-3.5 shrink-0" />
                          {lastError}
                        </p>
                      )}
                    </div>
                    {canWrite && index > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Đưa khóa số ${index + 1} lên trước`}
                        onClick={() => onMoveUp(item.id)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                    )}
                    {canWrite && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Sửa khóa số ${index + 1}`}
                        aria-expanded={editing === item.id}
                        onClick={() => setEditing(editing === item.id ? null : item.id)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    {canWrite && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => void handleRemove(item)}>
                        <Trash2 className="size-4" /> Gỡ khóa
                      </Button>
                    )}
                  </div>
                  {editing === item.id && (
                    <AiKeyEditRow
                      item={item}
                      onCancel={() => setEditing(null)}
                      onSave={(body) => {
                        onUpdate(item.id, body)
                        setEditing(null)
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ol>
        )}

        {canWrite && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <p className="font-medium">Thêm khóa</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${idPrefix}-provider`}>1. Hãng</Label>
                <Select
                  value={String(provider)}
                  onValueChange={(value) => {
                    const option = AI_KEY_PROVIDER_OPTIONS.find((item) => String(item.value) === value)
                    if (option) setProvider(option.value)
                  }}
                >
                  <SelectTrigger id={`${idPrefix}-provider`} className="w-64 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_KEY_PROVIDER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {custom ? (
                <div className="min-w-56 space-y-1">
                  <Label htmlFor={`${idPrefix}-base`}>2. Địa chỉ trạm</Label>
                  <Input
                    id={`${idPrefix}-base`}
                    className="bg-background"
                    placeholder="https://modelapi.vn/v1"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <span className="block text-sm font-medium">2. Lấy khóa</span>
                  <Button asChild type="button" variant="outline" size="sm" className="h-9">
                    <a href={current.site} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" /> Mở trang {current.label}
                    </a>
                  </Button>
                </div>
              )}
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor={`${idPrefix}-key`}>3. Dán khóa {custom ? 'của trạm' : current.label}</Label>
                <Input
                  id={`${idPrefix}-key`}
                  className="bg-background"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleSave()
                    }
                  }}
                />
              </div>
              <Button type="button" size="sm" className="h-9" disabled={!canSave} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {saving ? 'Đang kiểm…' : 'Lưu khóa'}
              </Button>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              aria-expanded={showOptions}
              onClick={() => setShowOptions((value) => !value)}
            >
              {showOptions ? 'Ẩn tùy chọn' : 'Tùy chọn: chọn model, đặt trần lượt mỗi ngày'}
            </button>
            {showOptions && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-model`}>Mô hình (để trống = mặc định)</Label>
                  <Input
                    id={`${idPrefix}-model`}
                    className="w-60 bg-background"
                    list={`${idPrefix}-models`}
                    placeholder={current.models[0] ?? ''}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-heavy`}>Mô hình việc nặng (để trống = như trên)</Label>
                  <Input
                    id={`${idPrefix}-heavy`}
                    className="w-60 bg-background"
                    list={`${idPrefix}-models`}
                    value={modelHeavy}
                    onChange={(event) => setModelHeavy(event.target.value)}
                  />
                </div>
                <ModelSuggestions id={`${idPrefix}-models`} provider={provider} />
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-cap`}>Trần lượt/ngày (0 = không giới hạn)</Label>
                  <Input
                    id={`${idPrefix}-cap`}
                    className="w-40 bg-background"
                    type="number"
                    min={0}
                    value={cap}
                    onChange={(event) => setCap(event.target.value)}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Hệ thống gọi thử hãng một lượt không tốn token rồi mới lưu (đã mã hóa); sai khóa hay sai trạm thì báo ngay, không
              lưu. Màn hình chỉ hiện 4 ký tự cuối. Không bao giờ dán khóa vào khung chat.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface AiKeyEditRowProps {
  item: AiKeyItem
  onSave: (body: AiKeyPatch) => void
  onCancel: () => void
}

/** Sửa mô hình / trần lượt của một khóa. Đổi hãng hay khóa thì gỡ rồi thêm (máy chủ phải gọi thử lại). */
function AiKeyEditRow({ item, onSave, onCancel }: AiKeyEditRowProps) {
  const idPrefix = useId()
  const [model, setModel] = useState(item.model)
  const [modelHeavy, setModelHeavy] = useState(item.model_heavy)
  const [cap, setCap] = useState(item.daily_cap ? String(item.daily_cap) : '')
  return (
    <div className="flex flex-wrap items-end gap-2 pl-8">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-model`}>Mô hình</Label>
        <Input
          id={`${idPrefix}-model`}
          className="h-8 w-56 text-xs"
          list={`${idPrefix}-models`}
          placeholder={item.default_model}
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-heavy`}>Mô hình việc nặng</Label>
        <Input
          id={`${idPrefix}-heavy`}
          className="h-8 w-56 text-xs"
          list={`${idPrefix}-models`}
          value={modelHeavy}
          onChange={(event) => setModelHeavy(event.target.value)}
        />
      </div>
      <ModelSuggestions id={`${idPrefix}-models`} provider={item.provider} />
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-cap`}>Trần lượt/ngày</Label>
        <Input
          id={`${idPrefix}-cap`}
          className="h-8 w-32 text-xs"
          type="number"
          min={0}
          value={cap}
          onChange={(event) => setCap(event.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
        className="h-8"
        onClick={() =>
          onSave({ model: model.trim(), model_heavy: modelHeavy.trim(), daily_cap: Math.max(0, Math.floor(Number(cap) || 0)) })
        }
      >
        Lưu
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onCancel}>
        Hủy
      </Button>
    </div>
  )
}
