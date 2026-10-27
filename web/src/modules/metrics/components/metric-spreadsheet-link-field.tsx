import { useController, type Control } from 'react-hook-form'

import type { CrudRecord } from '@/shared/crud/types'
import { CopyButton } from '@/shared/ui/copy-button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { useMetricServiceAccountEmail } from '../hooks/use-metric-service-account-email'

interface MetricSpreadsheetLinkFieldProps {
  control: Control<CrudRecord>
  name: string
  disabled: boolean
}

/** Ô "Link bảng Google Sheets" kèm hộp gợi ý "Chia sẻ bảng cho <email service account> quyền Người xem". */
export function MetricSpreadsheetLinkField({ control, name, disabled }: MetricSpreadsheetLinkFieldProps) {
  const { field } = useController({ control, name })
  const { data: email } = useMetricServiceAccountEmail()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>Link bảng Google Sheets *</Label>
      <Input
        id={name}
        value={String(field.value ?? '')}
        disabled={disabled}
        placeholder="https://docs.google.com/spreadsheets/d/…"
        onChange={(e) => field.onChange(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        {email ? (
          <>
            <span>Chia sẻ bảng cho</span>
            <b className="text-foreground">{email}</b>
            <CopyButton value={email} label="email service account" />
            <span>với quyền Người xem, rồi dán link bảng vào ô trên.</span>
          </>
        ) : (
          <span>Chưa dán khóa service account — vào Cài đặt → Google dán khóa trước, rồi chia sẻ bảng cho email của nó (quyền Người xem).</span>
        )}
      </div>
    </div>
  )
}
