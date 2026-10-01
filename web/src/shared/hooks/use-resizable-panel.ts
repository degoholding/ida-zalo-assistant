import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

interface Options {
  /** Khóa localStorage để nhớ bề rộng sang phiên sau. Bỏ trống = không nhớ. */
  storageKey?: string
  /** Hẹp hơn nữa thì nội dung bị cắt cụt vô nghĩa. */
  min: number
  /** Rộng hơn nữa thì lấn hết chỗ của phần chính. */
  max: number
  defaultValue: number
}

/**
 * Bề ngang một cột KÉO GIÃN ĐƯỢC, nhớ lại giữa các phiên.
 *
 * Tách ra dùng chung vì đây là chỗ **thứ ba** cần đúng hành vi này — trước đó
 * `app/layouts/sidebar-resize-handle.tsx` (menu trái) và
 * `shared/ui/rich-text-editor/editor-outline-panel.tsx` (mục lục) mỗi nơi tự
 * viết một bản. Hai bản cũ chưa dời sang đây; dời được thì nên dời, nhưng đó là
 * việc riêng chứ không gộp vào đợt này.
 *
 * Nghe `pointermove` trên **window** chứ không trên chính thanh kéo: kéo nhanh
 * thì con trỏ rời khỏi vạch 8px trước khi trình duyệt kịp bắn sự kiện, và cột
 * đứng khựng giữa chừng.
 *
 * Ghi vào `localStorage` lúc THẢ TAY, không phải mỗi nhịp kéo — mỗi nhịp một
 * lần ghi đĩa là mấy trăm lượt cho một cú kéo.
 */
export function useResizablePanel({ storageKey, min, max, defaultValue }: Options) {
  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, Math.round(v))),
    [min, max],
  )

  const [width, setWidth] = useState(() => {
    if (!storageKey) return defaultValue
    try {
      const raw = localStorage.getItem(storageKey)
      const so = raw ? Number(raw) : Number.NaN
      return Number.isFinite(so) ? Math.min(max, Math.max(min, so)) : defaultValue
    } catch {
      //  Trình duyệt chặn storage: vẫn kéo được, chỉ là không nhớ sang phiên sau.
      return defaultValue
    }
  })

  const dragOrigin = useRef<{ x: number; width: number } | null>(null)

  const startDrag = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault()
      dragOrigin.current = { x: event.clientX, width }
      let last = width

      const drag = (e: PointerEvent) => {
        const moc = dragOrigin.current
        if (!moc) return
        last = clamp(moc.width + (e.clientX - moc.x))
        setWidth(last)
      }

      const thaTay = () => {
        dragOrigin.current = null
        window.removeEventListener('pointermove', drag)
        window.removeEventListener('pointerup', thaTay)
        //  `document.body` chứ không phải thẻ cột: trong lúc kéo, con trỏ đi lạc
        //  ra ngoài cột nên đặt trên cột thì con trỏ đổi hình nhấp nháy.
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, String(last))
          } catch {
            //  Không nhớ được thì thôi, không phá thao tác đang làm.
          }
        }
      }

      //  Khóa bôi đen trong lúc kéo, nếu không thì kéo qua danh sách là bôi đen
      //  cả loạt tiêu đề, nhìn như bị lỗi.
      document.body.style.setProperty('cursor', 'col-resize')
      document.body.style.setProperty('user-select', 'none')
      window.addEventListener('pointermove', drag)
      window.addEventListener('pointerup', thaTay)
    },
    [width, clamp, storageKey],
  )

  /** Chỉnh bằng phím mũi tên khi thanh kéo đang được chọn. */
  const resizeByKey = useCallback(
    (buoc: number) => {
      setWidth((truoc) => {
        const latest = clamp(truoc + buoc)
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, String(latest))
          } catch {
            //  bỏ qua
          }
        }
        return latest
      })
    },
    [clamp, storageKey],
  )

  return { width, startDrag, resizeByKey }
}
