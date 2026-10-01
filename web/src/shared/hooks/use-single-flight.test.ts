import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useSingleFlight } from './use-single-flight'

/** Một việc chạy mất thời gian, tự cầm sẵn cái chốt để kết thúc lúc muốn. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useSingleFlight', () => {
  it('ba cú bấm trong cùng một nhịp chỉ chạy MỘT lần', async () => {
    //  LỖI ĐÃ XẢY RA (04/09/2026): `disabled={isPending}` là state React, chỉ
    //  bật sau lần render kế — nhấp nhấp ba cái ra ba lệnh POST.
    const { result } = renderHook(() => useSingleFlight())
    const cho = deferred()
    const task = vi.fn(() => cho.promise)

    void result.current(task)
    void result.current(task)
    void result.current(task)

    expect(task).toHaveBeenCalledTimes(1)
    cho.resolve()
  })

  it('chạy xong thì MỞ khóa cho lượt sau', async () => {
    const { result } = renderHook(() => useSingleFlight())
    const task = vi.fn(async () => {})

    await result.current(task)
    await result.current(task)

    expect(task).toHaveBeenCalledTimes(2)
  })

  it('việc HỎNG cũng phải mở khóa — không thì nút chết vĩnh viễn', async () => {
    //  Lưu thất bại (400/500) rồi khóa không nhả thì người dùng sửa lại dữ liệu
    //  xong bấm Lưu không ăn nữa, phải tải lại cả trang.
    const { result } = renderHook(() => useSingleFlight())
    const hong = vi.fn(async () => {
      throw new Error('400')
    })

    await expect(result.current(hong)).rejects.toThrow()
    await expect(result.current(hong)).rejects.toThrow()
    expect(hong).toHaveBeenCalledTimes(2)
  })

  it('việc đồng bộ (không async) cũng chặn được trùng', async () => {
    const { result } = renderHook(() => useSingleFlight())
    const task = vi.fn(() => 'xong')

    const p1 = result.current(task)
    void result.current(task)
    await p1

    expect(task).toHaveBeenCalledTimes(1)
  })
})
