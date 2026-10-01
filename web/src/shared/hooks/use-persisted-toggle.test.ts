import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { usePersistedToggle } from './use-persisted-toggle'

const KEY = 'erp.thu-cong-tac'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('usePersistedToggle', () => {
  it('chưa lưu gì thì lấy giá trị mặc định', () => {
    const { result } = renderHook(() => usePersistedToggle(KEY))
    expect(result.current[0]).toBe(false)

    const { result: b } = renderHook(() => usePersistedToggle('khoa-khac', true))
    expect(b.current[0]).toBe(true)
  })

  it('bấm một cái là đảo trạng thái và ghi xuống localStorage', () => {
    const { result } = renderHook(() => usePersistedToggle(KEY))
    act(() => result.current[1]())

    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('mở lại thì giữ đúng trạng thái đã lưu', () => {
    localStorage.setItem(KEY, '1')
    const { result } = renderHook(() => usePersistedToggle(KEY))
    expect(result.current[0]).toBe(true)
  })

  it('đã lưu «tắt» thì KHÔNG bị mặc định «bật» đè lên', () => {
    //  Chỗ dễ sai: viết `raw === '1' || macDinh` thì người dùng tắt đi xong mở
    //  lại vẫn thấy bật, vì `'0'` rơi về mặc định.
    localStorage.setItem(KEY, '0')
    const { result } = renderHook(() => usePersistedToggle(KEY, true))
    expect(result.current[0]).toBe(false)
  })

  it('bấm hai lần thì về chỗ cũ', () => {
    const { result } = renderHook(() => usePersistedToggle(KEY))
    act(() => result.current[1]())
    act(() => result.current[1]())

    expect(result.current[0]).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('0')
  })
})
