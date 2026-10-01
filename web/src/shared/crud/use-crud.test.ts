import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { getCrudDetailKey, getCrudQueryKey, getCrudRootKey } from './use-crud'

/**
 * B-09 (CR-142) dời khóa cache của lớp CRUD từ mảng viết tay sang ba helper.
 * Cả `useCrudSave` lẫn `useCrudDelete` chỉ `invalidateQueries` theo GỐC
 * `getCrudRootKey`, tin rằng nó là tiền tố của khóa danh sách và khóa chi tiết.
 * Nếu một helper lệch một phần tử thì tạo/sửa/xóa xong màn danh sách KHÔNG tự
 * làm mới — lỗi âm thầm, cổng typecheck vẫn xanh. Test này khóa đúng chỗ đó.
 */
describe('khóa cache lớp CRUD', () => {
  const api = '/api/warehouses'

  it('gốc là tiền tố của cả khóa danh sách lẫn khóa chi tiết', () => {
    const root = getCrudRootKey(api)
    const list = getCrudQueryKey(api, { page: 1 })
    const detail = getCrudDetailKey(api, 7)

    // khớp tiền tố: từng phần tử của gốc phải trùng đầu mảng khóa con
    expect(list.slice(0, root.length)).toEqual([...root])
    expect(detail.slice(0, root.length)).toEqual([...root])
  })

  it('khóa danh sách bỏ trống tham số vẫn ra object rỗng, không phải undefined', () => {
    // undefined ở cuối mảng làm khóa danh sách rỗng KHÁC khóa có tham số →
    // cache hai lần cho cùng một màn. Chốt mặc định là `{}`.
    expect(getCrudQueryKey(api)).toEqual(['crud', api, {}])
  })

  it('khóa chi tiết chèn "detail" nên không đụng khóa danh sách theo tham số', () => {
    // nếu thiếu segment 'detail', chi tiết id=7 trùng khóa danh sách params=7
    expect(getCrudDetailKey(api, 7)).toEqual(['crud', api, 'detail', 7])
    expect(getCrudDetailKey(api, 7)).not.toEqual(getCrudQueryKey(api, { id: 7 }))
  })

  it('invalidate theo GỐC quét trúng cả danh sách lẫn chi tiết CÙNG apiPath', () => {
    const client = new QueryClient()
    client.setQueryData(getCrudQueryKey(api, { page: 1 }), { items: [] })
    client.setQueryData(getCrudDetailKey(api, 7), { id: 7 })

    void client.invalidateQueries({ queryKey: getCrudRootKey(api) })

    expect(client.getQueryState(getCrudQueryKey(api, { page: 1 }))?.isInvalidated).toBe(true)
    expect(client.getQueryState(getCrudDetailKey(api, 7))?.isInvalidated).toBe(true)
  })

  it('invalidate GỐC của apiPath này KHÔNG đụng apiPath khác', () => {
    const client = new QueryClient()
    const other = '/api/units'
    client.setQueryData(getCrudQueryKey(other, { page: 1 }), { items: [] })

    void client.invalidateQueries({ queryKey: getCrudRootKey(api) })

    expect(client.getQueryState(getCrudQueryKey(other, { page: 1 }))?.isInvalidated).toBe(false)
  })
})
