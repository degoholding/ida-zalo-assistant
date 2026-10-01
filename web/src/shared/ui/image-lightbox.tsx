import { ChevronLeft, ChevronRight, Download, ExternalLink, Link, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { toast } from 'sonner'

import { cn } from '@/shared/utils/cn'

/** Một ảnh trong bộ xem: `url` bắt buộc, `name` để hiện tên + alt. */
export interface LightboxImage {
  url: string
  name?: string
}

/**
 * State gọn cho một cụm ảnh: `openAt(i)` để mở tại ảnh thứ i, rồi rải thẳng
 * `bind` vào `<ImageLightbox {...lb.bind} />`. Mỗi cụm (một tin nhắn, một dòng…)
 * dùng một hook riêng để chuyển ảnh trong đúng cụm đó.
 */
export function useImageLightbox() {
  const [index, setIndex] = useState<number | null>(null)
  return {
    openAt: (i: number) => setIndex(i),
    bind: {
      index: index ?? 0,
      open: index !== null,
      onOpenChange: (open: boolean) => {
        if (!open) setIndex(null)
      },
      onIndexChange: (i: number) => setIndex(i),
    },
  }
}

// Tải qua fetch -> blob vì gán thẳng href sẽ bị trình duyệt mở tab thay vì tải về.
async function downloadImage(img: LightboxImage) {
  try {
    const res = await fetch(img.url)
    if (!res.ok) throw new Error(String(res.status))
    const blobUrl = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = img.name || decodeURIComponent(img.url.split('/').pop() || 'anh')
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(blobUrl)
  } catch {
    toast.error('Tải ảnh thất bại')
  }
}

async function copyImageLink(img: LightboxImage) {
  const absolute = new URL(img.url, window.location.href).href
  try {
    await navigator.clipboard.writeText(absolute)
    toast.success('Đã sao chép liên kết ảnh')
  } catch {
    toast.error('Không sao chép được liên kết')
  }
}

interface ImageLightboxProps {
  images: LightboxImage[]
  /** Vị trí ảnh đang xem trong `images`. */
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onIndexChange: (index: number) => void
}

/**
 * Bộ xem ảnh tại chỗ (lightbox) dùng chung — thay hành vi mở tab mới của các
 * chỗ đính kèm ảnh (ticket, dòng chứng từ, bộ chứng từ, file giao hàng…).
 * Xem NF-10 trong `doc/erp/13-...md`.
 *
 * Chuyển ảnh: nút ‹ › · phím ArrowLeft/ArrowRight · bấm dải thumbnail bên dưới.
 * Đóng: nút X · phím Esc (Radix lo) · bấm vùng nền đen quanh ảnh.
 */
export function ImageLightbox({
  images,
  index,
  open,
  onOpenChange,
  onIndexChange,
}: ImageLightboxProps) {
  const count = images.length
  const current = images[index]

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return
      // Vòng tròn: quá đầu về cuối và ngược lại.
      onIndexChange((index + delta + count) % count)
    },
    [count, index, onIndexChange],
  )

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, go])

  if (!current) return null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">
            {current.name || 'Xem ảnh'}
          </DialogPrimitive.Title>

          {/* Thanh trên: tên · bộ đếm · sao chép liên kết · tải xuống · mở tab mới · đóng */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-sm" title={current.name}>
              {current.name}
            </span>
            {count > 1 && (
              <span className="shrink-0 text-xs text-white/70">
                {index + 1}/{count}
              </span>
            )}
            <button
              type="button"
              title="Sao chép liên kết ảnh"
              aria-label="Sao chép liên kết ảnh"
              onClick={() => void copyImageLink(current)}
              className="shrink-0 rounded-md p-1.5 opacity-80 transition-opacity hover:bg-white/10 hover:opacity-100"
            >
              <Link className="size-5" />
            </button>
            <button
              type="button"
              title="Tải ảnh xuống"
              aria-label="Tải ảnh xuống"
              onClick={() => void downloadImage(current)}
              className="shrink-0 rounded-md p-1.5 opacity-80 transition-opacity hover:bg-white/10 hover:opacity-100"
            >
              <Download className="size-5" />
            </button>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              title="Mở trong tab mới"
              className="shrink-0 rounded-md p-1.5 opacity-80 transition-opacity hover:bg-white/10 hover:opacity-100"
            >
              <ExternalLink className="size-5" />
            </a>
            <DialogPrimitive.Close
              title="Đóng"
              className="shrink-0 rounded-md p-1.5 opacity-80 transition-opacity hover:bg-white/10 hover:opacity-100"
            >
              <X className="size-5" />
              <span className="sr-only">Đóng</span>
            </DialogPrimitive.Close>
          </div>

          {/* Vùng ảnh — bấm nền quanh ảnh thì đóng */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-2"
            onClick={() => onOpenChange(false)}
          >
            {count > 1 && (
              <button
                type="button"
                aria-label="Ảnh trước"
                onClick={(e) => {
                  e.stopPropagation()
                  go(-1)
                }}
                className="absolute left-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
              >
                <ChevronLeft className="size-7" />
              </button>
            )}
            <img
              src={current.url}
              alt={current.name || ''}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full object-contain"
            />
            {count > 1 && (
              <button
                type="button"
                aria-label="Ảnh sau"
                onClick={(e) => {
                  e.stopPropagation()
                  go(1)
                }}
                className="absolute right-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
              >
                <ChevronRight className="size-7" />
              </button>
            )}
          </div>

          {/* Dải thumbnail để nhảy nhanh */}
          {count > 1 && (
            <div className="flex shrink-0 items-center justify-center gap-2 overflow-x-auto px-4 pb-4">
              {images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Xem ảnh ${i + 1}`}
                  onClick={() => onIndexChange(i)}
                  className={cn(
                    'size-14 shrink-0 overflow-hidden rounded border-2 transition',
                    i === index
                      ? 'border-white'
                      : 'border-transparent opacity-60 hover:opacity-100',
                  )}
                >
                  <img src={img.url} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
