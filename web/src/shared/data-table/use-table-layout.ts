import { useCallback, useMemo, useState } from 'react'

import type { ColumnDropSide, DataTableColumn, DataTableLayout } from './types'

const STORAGE_PREFIX = 'erp.table.'

/**
 * Nhớ cột nào đang ẩn, độ rộng và THỨ TỰ từng cột.
 *
 * Có `storageKey` thì ghi vào localStorage — người dùng chỉnh bảng một lần,
 * lần sau mở lại vẫn thế. Không có thì trạng thái chỉ sống trong phiên.
 */
export function useTableLayout<T>(columns: DataTableColumn<T>[], storageKey?: string) {
  const defaultLayout = useMemo<DataTableLayout>(
    () => ({
      hiddenColumns: columns.filter((c) => c.defaultHidden).map((c) => c.key),
      columnWidths: {},
      columnOrder: [],
      pinnedColumns: columns.filter((c) => c.defaultPinned).map((c) => c.key),
      columnColors: {},
    }),
    [columns],
  )

  const [layout, setLayout] = useState<DataTableLayout>(
    () => readLayout(storageKey) ?? defaultLayout,
  )

  const persist = useCallback(
    (next: DataTableLayout) => {
      setLayout(next)
      if (!storageKey) return
      try {
        localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next))
      } catch {
        // Hết quota hoặc trình duyệt chặn storage: bảng vẫn dùng được, chỉ là
        // không nhớ được sang phiên sau.
      }
    },
    [storageKey],
  )

  /**
   * Cột theo đúng thứ tự đang xem: phần đã lưu xếp trước (bỏ qua khóa của cột
   * không còn tồn tại), cột mới khai thêm trong code nối vào cuối.
   */
  const orderedColumns = useMemo(() => {
    if (layout.columnOrder.length === 0) return columns

    const byKey = new Map(columns.map((column) => [column.key, column]))
    const ordered = layout.columnOrder
      .map((key) => byKey.get(key))
      .filter((column): column is DataTableColumn<T> => !!column)
    const rest = columns.filter((column) => !layout.columnOrder.includes(column.key))
    return [...ordered, ...rest]
  }, [columns, layout.columnOrder])

  const toggleColumn = useCallback(
    (key: string) => {
      const hidden = layout.hiddenColumns.includes(key)
        ? layout.hiddenColumns.filter((item) => item !== key)
        : [...layout.hiddenColumns, key]
      persist({ ...layout, hiddenColumns: hidden })
    },
    [layout, persist],
  )

  const setHiddenColumns = useCallback(
    (hiddenOrFn: string[] | ((prev: string[]) => string[])) => {
      const next = typeof hiddenOrFn === 'function' ? hiddenOrFn(layout.hiddenColumns) : hiddenOrFn
      persist({ ...layout, hiddenColumns: next })
    },
    [layout, persist],
  )

  const setColumnWidth = useCallback(
    (key: string, width: number) => {
      persist({ ...layout, columnWidths: { ...layout.columnWidths, [key]: width } })
    },
    [layout, persist],
  )

  /** Đặt độ rộng cho NHIỀU cột một lượt (nút "vừa nội dung tất cả cột"). */
  const setColumnWidths = useCallback(
    (widths: Record<string, number>) => {
      persist({ ...layout, columnWidths: { ...layout.columnWidths, ...widths } })
    },
    [layout, persist],
  )

  /** Tô màu cột; `colorId` rỗng = bỏ màu, về nền mặc định. */
  const setColumnColor = useCallback(
    (key: string, colorId: string) => {
      const columnColors = { ...layout.columnColors }
      if (colorId) columnColors[key] = colorId
      else delete columnColors[key]
      persist({ ...layout, columnColors })
    },
    [layout, persist],
  )

  /**
   * Chuyển cột `fromKey` tới trước/sau cột `toKey`.
   *
   * Luôn tính trên danh sách ĐẦY ĐỦ (kể cả cột đang ẩn) rồi mới lưu: nếu chỉ
   * sắp lại các cột đang hiện thì cột ẩn sẽ bị dồn hết xuống cuối lúc bật lại.
   */
  const moveColumn = useCallback(
    (fromKey: string, toKey: string, side: ColumnDropSide) => {
      if (fromKey === toKey) return

      const keys = orderedColumns.map((column) => column.key)
      const next = keys.filter((key) => key !== fromKey)
      const target = next.indexOf(toKey)
      if (target < 0) return

      next.splice(side === 'before' ? target : target + 1, 0, fromKey)
      persist({ ...layout, columnOrder: next })
    },
    [orderedColumns, layout, persist],
  )

  /** Ghim / bỏ ghim một cột sang trái. Ghim cột đang ẩn thì hiện nó lại luôn. */
  const togglePin = useCallback(
    (key: string) => {
      // Cột thao tác cố định bên phải là một phần của bố cục màn hình, không
      // cho layout cũ hoặc thao tác trong menu chuyển nó sang mép trái.
      if (columns.some((column) => column.key === key && column.stickyRight)) return
      const pinned = layout.pinnedColumns.includes(key)
      persist({
        ...layout,
        pinnedColumns: pinned
          ? layout.pinnedColumns.filter((item) => item !== key)
          : [...layout.pinnedColumns, key],
        hiddenColumns: pinned
          ? layout.hiddenColumns
          : layout.hiddenColumns.filter((item) => item !== key),
      })
    },
    [columns, layout, persist],
  )

  const resetLayout = useCallback(() => persist(defaultLayout), [defaultLayout, persist])

  /**
   * Cột đang hiện: ghim trái xếp đầu, cột thường ở giữa, cột cố định phải xếp
   * cuối. Phải sắp lại thật (không chỉ tô CSS) vì cột sticky nằm giữa bảng sẽ
   * chồng lên hàng xóm khi cuộn ngang. Trong mỗi nhóm vẫn giữ thứ tự người dùng.
   */
  const visibleColumns = useMemo(() => {
    const shown = orderedColumns.filter((column) => !layout.hiddenColumns.includes(column.key))
    const isPinned = (key: string) => layout.pinnedColumns.includes(key)
    return [
      ...shown.filter((column) => isPinned(column.key) && !column.stickyRight),
      ...shown.filter((column) => !isPinned(column.key) && !column.stickyRight),
      ...shown.filter((column) => column.stickyRight),
    ]
  }, [orderedColumns, layout.hiddenColumns, layout.pinnedColumns])

  return {
    layout,
    orderedColumns,
    visibleColumns,
    toggleColumn,
    setHiddenColumns,
    setColumnWidth,
    setColumnWidths,
    setColumnColor,
    moveColumn,
    togglePin,
    resetLayout,
  }
}

function readLayout(storageKey?: string): DataTableLayout | null {
  if (!storageKey) return null
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DataTableLayout>
    return {
      hiddenColumns: Array.isArray(parsed.hiddenColumns) ? parsed.hiddenColumns : [],
      columnWidths:
        parsed.columnWidths && typeof parsed.columnWidths === 'object' ? parsed.columnWidths : {},
      // Ba trường dưới thêm sau; bản lưu cũ không có -> coi như rỗng.
      columnOrder: Array.isArray(parsed.columnOrder) ? parsed.columnOrder : [],
      pinnedColumns: Array.isArray(parsed.pinnedColumns) ? parsed.pinnedColumns : [],
      columnColors:
        parsed.columnColors && typeof parsed.columnColors === 'object' ? parsed.columnColors : {},
    }
  } catch {
    // Dữ liệu cũ hỏng định dạng -> bỏ qua, dùng mặc định.
    return null
  }
}
