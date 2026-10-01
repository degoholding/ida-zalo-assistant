import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { useSingleFlight } from '@/shared/hooks/use-single-flight'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { confirm } from '@/shared/ui/confirm-dialog'
import { CrudFormFields } from './crud-form-fields'
import { buildFormDefaults, toApiPayload } from './field-values'
import { resolveFormFields } from './resolve-form-fields'
import type { CrudConfig, CrudRecord } from './types'
import { useCrudSave } from './use-crud'

interface CrudFormDialogProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: CrudConfig<T>
  item?: T | null
}

export function CrudFormDialog<T extends CrudRecord>({
  open,
  onOpenChange,
  config,
  item,
}: CrudFormDialogProps<T>) {
  const saveMutation = useCrudSave<T>(config.apiPath, config.title)
  const isEditing = Boolean(item)
  //  Chặn bấm trùng trong cùng một nhịp — xem `useSingleFlight`.
  const once = useSingleFlight()

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Record<string, unknown>>({
    defaultValues: buildFormDefaults(resolveFormFields(config.formFields, item ?? {}), item),
  })

  const pending = isSubmitting || saveMutation.isPending

  /** Đóng theo case C-01: chỉ Hủy/X; form đã sửa thì hỏi xác nhận, tránh mất dữ liệu. */
  const attemptClose = async () => {
    if (pending) return
    if (isDirty && !(await confirm({ message: 'Bạn có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?' }))) return
    onOpenChange(false)
  }

  // Nạp lại giá trị mỗi lần MỞ hộp thoại: cùng một component được dùng lại cho
  // cả "Thêm" lẫn "Sửa", không reset thì lần mở sau còn nguyên số của lần trước.
  useEffect(() => {
    if (open) {
      reset(buildFormDefaults(resolveFormFields(config.formFields, item ?? {}), item))
    }
  }, [open, item, config.formFields, reset])

  const onSubmit = (values: Record<string, unknown>) =>
    once(async () => {
      const idKey = (config.idKey as string) || 'id'
      const id = item ? (item[idKey] as string | number) : undefined

      const fields = resolveFormFields(config.formFields, values)
      const payload = toApiPayload(fields, values)
      await saveMutation.mutateAsync({
        id,
        values: config.buildPayload ? config.buildPayload(payload, item) : payload,
      })
      onOpenChange(false)
    })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Đóng (next=false) phải qua chốt chống mất dữ liệu; mở thì để nguyên.
        if (next) onOpenChange(true)
        else attemptClose()
      }}
    >
      <DialogContent
        className={config.dialogMaxWidth || 'sm:max-w-lg'}
        // C-01: KHÔNG đóng bằng Esc hay click ra ngoài — chỉ Hủy/X (qua onOpenChange).
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `Sửa ${config.unitLabel}` : `Thêm ${config.unitLabel}`}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
              e.preventDefault()
            }
          }}
          className="space-y-4 pt-2"
        >
          <CrudFormFields
            fields={config.formFields}
            register={register}
            control={control}
            errors={errors}
            watch={watch}
            sectionHints={config.formSections}
            isReadonly={(field) => isEditing && Boolean(field.readonlyOnEdit)}
          />

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={attemptClose}
              disabled={pending}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEditing ? 'Lưu thay đổi' : 'Tạo mới'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
