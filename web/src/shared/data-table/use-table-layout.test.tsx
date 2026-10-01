import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DataTableColumn } from './types'
import { useTableLayout } from './use-table-layout'

type Row = { id: number }

const columns: DataTableColumn<Row>[] = [
  { key: 'code', header: 'Mã', cell: (row) => row.id, defaultPinned: true },
  { key: 'action', header: 'Thao tác', cell: () => null, stickyRight: true },
  { key: 'title', header: 'Tên', cell: () => null },
]

describe('bố cục cột cố định bên phải', () => {
  it('luôn đặt cột thao tác ở cuối dù khai báo hoặc kéo cột ở vị trí khác', () => {
    const { result } = renderHook(() => useTableLayout(columns))

    expect(result.current.visibleColumns.map((column) => column.key)).toEqual([
      'code',
      'title',
      'action',
    ])

    act(() => result.current.moveColumn('action', 'code', 'before'))

    expect(result.current.visibleColumns.map((column) => column.key)).toEqual([
      'code',
      'title',
      'action',
    ])
  })

  it('không cho ghim cột cố định bên phải sang trái', () => {
    const { result } = renderHook(() => useTableLayout(columns))

    act(() => result.current.togglePin('action'))

    expect(result.current.layout.pinnedColumns).not.toContain('action')
  })
})
