import { describe, expect, it } from 'vitest'

import { USER_ROLE } from '@/core/auth/user-role'
import { describeUserScope } from './describe-user-scope'

describe('describeUserScope', () => {
  it('says an admin sees every group even when the «all groups» switch is off and the scope is empty', () => {
    expect(describeUserScope({ role: USER_ROLE.admin, all_groups: false, group_count: 0 })).toBe('Mọi nhóm (quản trị)')
  })

  it('treats the role as a number even when the form hands it back as a string', () => {
    //  Ô chọn của khung CRUD trả CHUỖI («1»), máy chủ trả SỐ — so bằng `===` thô là quản trị bị đếm như nhân viên.
    expect(describeUserScope({ role: '1', all_groups: false, group_count: 0 })).toBe('Mọi nhóm (quản trị)')
  })

  it('reports «all groups» for a non-admin with the switch on, ignoring the stored scope count', () => {
    expect(describeUserScope({ role: USER_ROLE.staff, all_groups: true, group_count: 3 })).toBe('Mọi nhóm')
  })

  it('warns when a non-admin has no group at all — they would see an empty app', () => {
    expect(describeUserScope({ role: USER_ROLE.manager, all_groups: false, group_count: 0 })).toBe('Chưa có nhóm nào')
  })

  it('counts the scoped groups otherwise', () => {
    expect(describeUserScope({ role: USER_ROLE.staff, all_groups: false, group_count: 1 })).toBe('1 nhóm')
  })
})
