import { describe, expect, it } from 'vitest'

import { TAB_INFO, resolveTabKey } from './resolve-tab-key'

const TABS = [{ key: 'holders' }, { key: 'history' }]

describe('resolveTabKey', () => {
  it('mở đúng tab mà link trỏ tới', () => {
    //  Đây là cả lý do param này tồn tại: bấm một dòng trong tab con là rời
    //  trang, bấm Lùi phải quay về ĐÚNG tab đó chứ không về «Thông tin».
    expect(resolveTabKey('holders', TABS)).toBe('holders')
    expect(resolveTabKey('history', TABS)).toBe('history')
  })

  it('không có param thì về tab «Thông tin»', () => {
    expect(resolveTabKey(TAB_INFO, TABS)).toBe(TAB_INFO)
  })

  it('⚠️ tab KHÔNG CÓ THẬT thì lùi về «Thông tin», không để trang trắng', () => {
    //  Radix nhận `value` lạ mà không báo gì — nó chỉ không dựng tab nào cả.
    //  Hai đường tới đây đều bình thường: link cũ trỏ vào tab về sau bị bỏ, và
    //  người dùng sửa tay thanh địa chỉ.
    expect(resolveTabKey('khong-co-that', TABS)).toBe(TAB_INFO)
    expect(resolveTabKey('', TABS)).toBe(TAB_INFO)
  })

  it('màn KHÔNG khai tab nào thì mọi param đều rơi về «Thông tin»', () => {
    expect(resolveTabKey('holders', undefined)).toBe(TAB_INFO)
    expect(resolveTabKey('holders', [])).toBe(TAB_INFO)
    expect(resolveTabKey(TAB_INFO, undefined)).toBe(TAB_INFO)
  })

  it('khóa trùng tên tab «Thông tin» vẫn ra chính nó, không nhân đôi', () => {
    //  Config khai nhầm một tab tên `info` thì `TabsTrigger` bị trùng `value` —
    //  nhưng hàm này vẫn phải trả về một giá trị hợp lệ, không được ném.
    expect(resolveTabKey(TAB_INFO, [{ key: TAB_INFO }])).toBe(TAB_INFO)
  })
})
