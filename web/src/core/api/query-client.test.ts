import { describe, expect, it } from 'vitest'

import { queryClient } from './query-client'

/** Chạy một mutation qua ĐÚNG client dùng chung để kích hoạt `mutationCache`. */
async function runMutation(fn: () => Promise<unknown> = async () => 'ok') {
  const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: fn })
  await mutation.execute(undefined)
}

/**
 * ⚠️ LỖI ĐÃ XẢY RA (04/09/2026, màn Quỹ phép năm): điều chỉnh tay lưu thật,
 * backend ghi `tab_audit_log` thật, nhưng khối «Lịch sử thao tác» đứng ngay dưới
 * nút vừa bấm vẫn ghi *"Chưa có thao tác nào"* — người dùng đọc ra là hệ thống
 * không ghi nhận việc mình vừa làm.
 */
describe('queryClient — làm mới nhật ký thao tác', () => {
  it('mutation nào thành công cũng đánh dấu `audit-logs` là cũ', async () => {
    const key = ['audit-logs', 'leave_balance', 2]
    queryClient.setQueryData(key, [])
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)

    await runMutation()

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('quét MỌI bản ghi, không riêng một entity', async () => {
    //  Khóa là `['audit-logs', entity, id]` — invalidate theo gốc nên một màn mở
    //  nhiều dòng dấu vết (vd tab chứng từ) cũng được làm mới cùng lúc.
    const a = ['audit-logs', 'leave_type', 7]
    const b = ['audit-logs', 'employee', 3]
    queryClient.setQueryData(a, [])
    queryClient.setQueryData(b, [])

    await runMutation()

    expect(queryClient.getQueryState(a)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(b)?.isInvalidated).toBe(true)
  })

  it('mutation HỎNG thì không đụng tới nhật ký', async () => {
    //  Lệnh ghi thất bại nghĩa là backend chưa ghi gì — gọi lại API dấu vết chỉ
    //  tốn một request để nhận đúng dữ liệu cũ.
    const key = ['audit-logs', 'company', 1]
    queryClient.setQueryData(key, [])

    await expect(
      runMutation(async () => {
        throw new Error('400')
      }),
    ).rejects.toThrow()

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
  })

  it('không đụng tới các khóa khác — đừng nạp lại cả trang vì một dòng dấu vết', async () => {
    const other = ['crud', '/api/leave-balances', 'detail', 2]
    queryClient.setQueryData(other, { id: 2 })

    await runMutation()

    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false)
  })
})
