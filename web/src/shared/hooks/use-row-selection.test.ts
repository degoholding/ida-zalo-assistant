import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRowSelection } from './use-row-selection'

describe('useRowSelection', () => {
  it('bắt đầu rỗng', () => {
    const { result } = renderHook(() => useRowSelection())
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('toggleRow: chưa chọn thì thêm, đã chọn thì bỏ', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleRow(5))
    expect(result.current.selectedIds.has(5)).toBe(true)
    act(() => result.current.toggleRow(5))
    expect(result.current.selectedIds.has(5)).toBe(false)
  })

  it('toggleRow không đụng tới id khác đang chọn', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleRow(1))
    act(() => result.current.toggleRow(2))
    act(() => result.current.toggleRow(1))
    expect(Array.from(result.current.selectedIds)).toEqual([2])
  })

  it('toggleAllOnPage: chưa ai chọn thì chọn HẾT trang', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleAllOnPage([1, 2, 3]))
    expect(Array.from(result.current.selectedIds).sort()).toEqual([1, 2, 3])
  })

  it('toggleAllOnPage: cả trang ĐÃ chọn hết thì bỏ chọn hết trang đó', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleAllOnPage([1, 2, 3]))
    act(() => result.current.toggleAllOnPage([1, 2, 3]))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('toggleAllOnPage: chọn MỘT PHẦN trang (indeterminate) thì bấm lại → chọn NỐT phần còn thiếu, không bỏ phần đã chọn', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleRow(1))
    act(() => result.current.toggleAllOnPage([1, 2, 3]))
    expect(Array.from(result.current.selectedIds).sort()).toEqual([1, 2, 3])
  })

  it('toggleAllOnPage: KHÔNG đụng tới id đã chọn ở TRANG KHÁC (không nằm trong idsOnPage)', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleRow(99)) // đã chọn ở trang trước
    act(() => result.current.toggleAllOnPage([1, 2, 3])) // sang trang mới, chọn hết
    expect(Array.from(result.current.selectedIds).sort((a, b) => a - b)).toEqual([1, 2, 3, 99])
    act(() => result.current.toggleAllOnPage([1, 2, 3])) // bỏ chọn hết trang mới
    expect(Array.from(result.current.selectedIds)).toEqual([99])
  })

  it('toggleAllOnPage với mảng RỖNG (trang không có dòng nào) — không nổ, không đổi gì', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleRow(1))
    act(() => result.current.toggleAllOnPage([]))
    expect(Array.from(result.current.selectedIds)).toEqual([1])
  })

  it('clear: xóa sạch mọi lựa chọn', () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.toggleAllOnPage([1, 2, 3]))
    act(() => result.current.clear())
    expect(result.current.selectedIds.size).toBe(0)
  })
})
