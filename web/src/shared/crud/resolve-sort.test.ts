import { describe, expect, it } from 'vitest'

import { resolveSort } from './resolve-sort'

const STAGE_SORT = { defaultSort: { by: 'sort_order', dir: 'asc' as const } }

/** URLSearchParams gọn cho từng ca. */
function url(query: string) {
  return new URLSearchParams(query)
}

describe('resolveSort', () => {
  it('không khai gì thì trả khóa RỖNG — chỗ gọi bỏ hẳn sort_by để backend tự sắp', () => {
    //  Rỗng KHÁC với 'id': gửi `sort_by=id` là ép một cột cụ thể, còn ở đây ta
    //  cố ý không nói gì để backend giữ mặc định của nó.
    expect(resolveSort(url(''), {})).toEqual({ by: '', dir: 'asc' })
  })

  it('URL trống thì rơi về defaultSort của danh mục', () => {
    expect(resolveSort(url(''), STAGE_SORT)).toEqual({ by: 'sort_order', dir: 'asc' })
  })

  it('URL có sort_by thì URL thắng — người dùng vừa bấm tiêu đề cột', () => {
    expect(resolveSort(url('sort_by=name&sort_dir=desc'), STAGE_SORT)).toEqual({
      by: 'name',
      dir: 'desc',
    })
  })

  it('sắp theo cột KHÁC mà thiếu sort_dir thì là asc, KHÔNG mượn chiều của defaultSort', () => {
    //  Lỗi dễ mắc: để `?? defaultSort.dir` cho cả hai ô. Người dùng đang sắp
    //  theo cột khác hẳn, mượn chiều của cột mặc định là đoán mò — và nếu
    //  defaultSort là `desc` thì cú bấm đầu tiên ra chiều ngược với mũi tên.
    expect(
      resolveSort(url('sort_by=name'), { defaultSort: { by: 'sort_order', dir: 'desc' } }),
    ).toEqual({ by: 'name', dir: 'asc' })
  })

  it('bỏ sort_by khỏi URL (nhịp "thôi sắp xếp") là quay về defaultSort, không phải id desc', () => {
    //  Với danh mục có thứ tự nghiệp vụ — năm giai đoạn của Loại hồ sơ —
    //  "thôi sắp xếp" phải trả về đúng thứ tự giai đoạn.
    expect(resolveSort(url('sort_dir=desc'), STAGE_SORT)).toEqual({
      by: 'sort_order',
      dir: 'asc',
    })
  })

  it('sort_dir rác coi như asc chứ không ném lỗi', () => {
    //  Query string là thứ người dùng dán được, sửa được bằng tay.
    for (const junk of ['', 'DESC', 'xuôi', '1', 'undefined']) {
      expect(resolveSort(url(`sort_by=code&sort_dir=${junk}`), {}).dir).toBe('asc')
    }
    //  Chỉ đúng chữ 'desc' thường mới là giảm dần.
    expect(resolveSort(url('sort_by=code&sort_dir=desc'), {}).dir).toBe('desc')
  })
})
