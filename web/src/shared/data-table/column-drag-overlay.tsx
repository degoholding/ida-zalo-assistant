import { GripVertical } from 'lucide-react'
import { useCallback } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/shared/utils/cn'
import type { ColumnDragState } from './use-column-drag'

interface ColumnDragOverlayProps {
  drag: ColumnDragState
}

/**
 * Lớp phủ lúc kéo đổi vị trí cột, dựng theo lối `DragOverlay` của **dnd-kit**:
 * thứ bay theo con trỏ là BẢN SAO THẬT của cột (xem `capture-column-snapshot.ts`)
 * — nhấc lên, nghiêng nhẹ, đổ bóng — chứ không phải một cái nhãn tượng trưng.
 * Chỗ cột vừa rời đi để lại một ô trống gạch đứt, đúng kiểu placeholder của
 * sortable.
 *
 * Bốn lớp, tất cả bằng toạ độ màn hình:
 *
 *  1. **Khung gạch đứt ở chỗ cũ** — biết cột vừa nhấc lên từ đâu; cột gốc bên
 *     dưới vẫn đọc được, chỉ mờ đi.
 *  2. **Dải sáng phủ nguyên cột đích** — nhìn cả chiều cao bảng là biết sẽ chèn
 *     cạnh cột nào, không phải dò theo một vạch mảnh trên hàng tiêu đề.
 *  3. **Bản sao cột bám con trỏ**, rộng đúng bằng cột thật.
 *  4. **Vạch thả chạy suốt chiều cao bảng**, chóp mũi tên nhọn ở hai đầu chỉ vào
 *     khe sẽ chèn.
 *
 * Vẽ vào `<body>` qua portal: khung bảng có `overflow-hidden` (LinesTable) hoặc
 * `overflow-auto` (DataTable) sẽ cắt mất phần tràn nếu đặt lớp phủ bên trong.
 * `position: fixed` nên toạ độ lấy thẳng từ `getBoundingClientRect` của hook,
 * không phải cộng trừ độ cuộn của trang.
 */
export function ColumnDragOverlay({ drag }: ColumnDragOverlayProps) {
  const { geometry } = drag
  const height = geometry.bottom - geometry.top
  const { snapshot } = drag

  // Nhét bản sao (DOM thuần) vào lớp phủ. `replaceChildren` nên gắn lại nhiều
  // lần vẫn chỉ có một bản — React gọi ref callback lại mỗi khi lớp phủ dựng lại.
  const mountSnapshot = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      if (snapshot) node.replaceChildren(snapshot)
      else node.replaceChildren()
    },
    [snapshot],
  )

  // Bảng cuộn khuất hẳn khỏi khung (chiều cao <= 0) thì không vẽ gì — vẽ tiếp
  // chỉ tạo ra một vệt mảnh lơ lửng ngoài bảng.
  if (height <= 0) return null

  const highlightTarget =
    geometry.overLeft !== null && geometry.overWidth !== null && drag.overKey !== drag.fromKey

  return createPortal(
    // `data-drag-layer` không phải trang trí: lớp phủ toàn `aria-hidden` nên
    // không có vai trò/chữ để bấu víu khi cần chỉ đích danh một lớp.
    <div className="pointer-events-none fixed inset-0 z-50">
      {/*
        Khung gạch đứt quanh chỗ cột vừa được nhấc lên. Nền để RẤT nhạt: cột gốc
        bên dưới chỉ mờ đi chứ vẫn còn chữ (xem `column-header-cell.tsx`), tô đậm
        là lấp mất, chỗ cũ lại thành ô trắng trơn như bảng đang tải dở.
      */}
      <div
        aria-hidden
        data-drag-layer="placeholder"
        className="absolute rounded-md border-2 border-dashed border-muted-foreground/30 bg-muted/15"
        style={{
          left: geometry.fromLeft,
          width: geometry.width,
          top: geometry.top,
          height,
        }}
      />

      {highlightTarget && (
        <div
          aria-hidden
          data-drag-layer="target"
          className="absolute bg-primary/5"
          style={{
            left: geometry.overLeft ?? 0,
            width: geometry.overWidth ?? 0,
            top: geometry.top,
            height,
          }}
        />
      )}

      {/* Vạch vẽ TRƯỚC bản sao: cầm cột đi ngang qua chính cái vạch mình đang
          nhắm thì vạch phải khuất sau cột, không cắt đôi nó. */}
      {geometry.dropX !== null && (
        <div
          aria-hidden
          data-drag-layer="drop-line"
          className="absolute w-[3px] -translate-x-1/2 rounded-full bg-primary"
          style={{ left: geometry.dropX, top: geometry.top, height }}
        >
          {/* Chóp trên/dưới là tam giác dựng bằng viền — nhẹ hơn SVG và ăn theo
              `--primary` như thân vạch. */}
          <span className={cn(ARROW_CAP, '-top-1 border-x-[5px] border-t-[6px] border-t-primary')} />
          <span
            className={cn(ARROW_CAP, '-bottom-1 border-x-[5px] border-b-[6px] border-b-primary')}
          />
        </div>
      )}

      {/*
        Bản sao cột: cao ĐÚNG bằng bảng, nhấc lên bằng viền màu nhấn + bóng đổ.
        Không xoay, không phóng to — cột phải khớp từng dòng với bảng bên dưới
        thì mắt mới so được nó sắp nằm vào đâu.
      */}
      <div
        aria-hidden
        data-drag-layer="ghost"
        // Nền ĐỤC hoàn toàn: để hở dù chỉ vài phần trăm là chữ của cột nằm dưới
        // hiện xuyên qua bản sao, đọc nhầm ngay.
        className="absolute overflow-hidden rounded-lg border-2 border-primary bg-background shadow-2xl"
        style={{
          left: geometry.ghostLeft,
          width: Math.max(geometry.width, MIN_GHOST_WIDTH),
          top: geometry.top,
          height,
        }}
      >
        <div ref={mountSnapshot} />

        {snapshot === null && (
          <span className="flex items-center gap-1 px-3 py-2 text-xs font-medium whitespace-nowrap">
            <GripVertical className="size-3.5 text-muted-foreground" />
            {drag.label}
          </span>
        )}
      </div>

      {geometry.dropX !== null && (
        <div
          aria-hidden
          data-drag-layer="drop-line"
          className="absolute w-[3px] -translate-x-1/2 rounded-full bg-primary"
          style={{ left: geometry.dropX, top: geometry.top, height }}
        >
          {/* Chóp trên/dưới là tam giác dựng bằng viền — nhẹ hơn SVG và ăn theo
              `--primary` như thân vạch. */}
          <span className={cn(ARROW_CAP, '-top-1 border-x-[5px] border-t-[6px] border-t-primary')} />
          <span
            className={cn(ARROW_CAP, '-bottom-1 border-x-[5px] border-b-[6px] border-b-primary')}
          />
        </div>
      )}
    </div>,
    document.body,
  )
}

/** Cột hẹp hơn ngần này (ô tick chọn) thì bản sao vẫn rộng bằng đây cho dễ thấy. */
const MIN_GHOST_WIDTH = 44

const ARROW_CAP = 'absolute left-1/2 size-0 -translate-x-1/2 border-x-transparent'
