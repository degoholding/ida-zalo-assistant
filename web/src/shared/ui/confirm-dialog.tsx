import { TriangleAlert } from 'lucide-react'
import { create } from 'zustand'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { buttonVariants } from '@/shared/ui/button'
import { cn } from '@/shared/utils/cn'

export interface ConfirmOptions {
  /** Tiêu đề — mặc định "Xác nhận". */
  title?: string
  message: string
  /** Nhãn nút đồng ý — mặc định "Đồng ý". */
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' (mặc định) = nút Đồng ý đỏ + biểu tượng cảnh báo đỏ. */
  tone?: 'danger' | 'default'
}

interface ConfirmStore {
  open: boolean
  options: ConfirmOptions | null
  resolve: ((v: boolean) => void) | null
  request: (o: ConfirmOptions) => Promise<boolean>
  settle: (v: boolean) => void
}

const useConfirmStore = create<ConfirmStore>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  request: (options) =>
    new Promise<boolean>((resolve) => {
      // Có hộp cũ chưa trả lời thì coi như hủy nó trước khi mở hộp mới.
      get().resolve?.(false)
      set({ open: true, options, resolve })
    }),
  settle: (v) => {
    get().resolve?.(v)
    set({ open: false, resolve: null })
  },
}))

/**
 * Mở hộp XÁC NHẬN có style (thay `window.confirm` xấu của trình duyệt), trả về
 * `Promise<boolean>` — Đồng ý = true, Hủy/đóng = false. Dùng ở bất kỳ đâu:
 * `if (await confirm({ message: '…' })) { … }`.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(options)
}

/** Đặt MỘT lần ở gốc app (cạnh Toaster) — nơi hộp xác nhận toàn cục hiện ra. */
export function ConfirmDialogHost() {
  const { open, options, settle } = useConfirmStore()
  const isDanger = (options?.tone ?? 'danger') === 'danger'

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && settle(false)}>
      <AlertDialogContent className="max-w-[430px] gap-0 overflow-hidden rounded-2xl p-0">
        <div className="px-[22px] pt-5">
          <div className="mb-2.5 flex items-center gap-3">
            <span
              className={cn(
                'grid size-[38px] shrink-0 place-items-center rounded-[11px]',
                isDanger
                  ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                  : 'bg-primary/10 text-primary',
              )}
            >
              <TriangleAlert className="size-[21px]" />
            </span>
            <AlertDialogTitle className="text-[16.5px] font-bold text-foreground">
              {options?.title ?? 'Xác nhận'}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="whitespace-pre-line text-[14px] leading-[1.55] text-muted-foreground">
            {options?.message}
          </AlertDialogDescription>
        </div>

        <div className="flex justify-end gap-2.5 px-[22px] pb-5 pt-[18px]">
          <AlertDialogCancel onClick={() => settle(false)} className="mt-0 rounded-[10px] font-medium">
            {options?.cancelLabel ?? 'Hủy'}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={cn('rounded-[10px] font-semibold', isDanger && buttonVariants({ variant: 'destructive' }))}
          >
            {options?.confirmLabel ?? 'Đồng ý'}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
