import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ACTIONS, ENTITIES, type PermissionMap } from './permission-types'
import { usePermission } from './use-permission'

/**
 * `can()` / `canAccess()` — cổng ẩn/hiện của TOÀN BỘ giao diện.
 *
 * Nhắc lại cho người đọc sau: đây là tiện ích GIAO DIỆN, chốt chặn thật là
 * `require()` + `apply_scope()` ở backend. Nhưng sai ở đây vẫn đắt theo hai
 * chiều mà backend không cứu được: **nút giả** (bày ra, bấm vào ăn 403) và
 * **giấu nhầm** (có quyền mà không thấy nút, người dùng tưởng chưa được cấp).
 * Nguy nhất là hỏng theo kiểu "mở toang" — `can()` trả `true` khi bản đồ quyền
 * chưa về; lúc đó cả menu bày ra rồi biến mất, trông y như hệ thống lỗi.
 */

//  Zustand thật đọc localStorage lúc nạp module và kéo theo cả http-client;
//  ở đây chỉ cần đúng hợp đồng selector.
let state: { user: { permissions?: PermissionMap } | null } = { user: null }

vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

beforeEach(() => {
  state = { user: null }
})

describe('B6 — bản đồ quyền chưa về / rỗng', () => {
  it('chưa đăng nhập thì can() trả false, không nổ', () => {
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('contact', 'read')).toBe(false)
    expect(result.current.canAccess('contact')).toBe(false)
  })

  it('đã có hồ sơ nhưng `permissions` chưa về thì vẫn là false, KHÔNG mở toang', () => {
    state = { user: {} }
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('group', 'read')).toBe(false)
    expect(result.current.canAccess('group')).toBe(false)
  })

  it('entity có mặt nhưng không có ô nào -> canAccess false', () => {
    state = { user: { permissions: { group: {} } } }
    const { result } = renderHook(() => usePermission())
    expect(result.current.canAccess('group')).toBe(false)
  })
})

describe('B7 — backend trả ô là CHUỖI thay vì boolean', () => {
  //  `PermissionMap` khai `boolean | string` chính vì chuyện này có thật (ô đi
  //  qua JSON của một vài route cũ). `!!` trên chuỗi là bẫy kinh điển: `"false"`
  //  và `"0"` đều TRUTHY trong JavaScript.
  it('"true" / "1" -> true', () => {
    state = { user: { permissions: { file: { read: 'true', export: '1' } } } }
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('file', 'read')).toBe(true)
    expect(result.current.can('file', 'export')).toBe(true)
  })

  it('chuỗi RỖNG -> false (đúng)', () => {
    state = { user: { permissions: { file: { read: '' } } } }
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('file', 'read')).toBe(false)
  })

  it.fails('chuỗi "false" PHẢI ra false — hôm nay `!!` cho ra true', () => {
    //  ⚠️ CỐ Ý ĐỎ, giữ bằng `it.fails`. Chưa thấy route nào backend trả đúng
    //  chuỗi `"false"`, nên đây là bẫy đang ngủ chứ chưa phải lỗ đang chảy: ngày
    //  nào có, người dùng sẽ thấy đủ nút của một quyền họ KHÔNG có (nút giả).
    //  Vá đúng chỗ: `use-permission.ts` đọc ô bằng một hàm ép kiểu riêng thay
    //  cho `!!`, và khi đó đổi `it.fails` này thành `it`.
    state = { user: { permissions: { file: { read: 'false' } } } }
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('file', 'read')).toBe(false)
  })

  it('canAccess cũng dính đúng cái bẫy đó — cùng một hàm ép kiểu phải sửa cả hai', () => {
    state = { user: { permissions: { file: { read: 'false' } } } }
    const { result } = renderHook(() => usePermission())
    expect(result.current.canAccess('file')).toBe(true) // hành vi HÔM NAY
  })
})

describe('B8 — đăng xuất', () => {
  it('bản đồ quyền biến mất thì can() về false NGAY ở lần render kế', () => {
    state = { user: { permissions: { group: { read: true } } } }
    const { result, rerender } = renderHook(() => usePermission())
    expect(result.current.can('group', 'read')).toBe(true)

    act(() => {
      state = { user: null }
    })
    rerender()

    //  `can` bọc trong `useCallback([permissions])`. Quên mảng phụ thuộc là
    //  người vừa đăng xuất vẫn thấy nguyên menu của tài khoản cũ.
    expect(result.current.can('group', 'read')).toBe(false)
  })
})

describe('B2 — hình dạng hằng số', () => {
  it('ACTIONS có đúng `process` nằm ngoài ma trận vai trò và đứng cuối', () => {
    //  `process` là CỜ TỔNG HỢP backend bồi thêm cho nhân sự thu mua, không phải
    //  một ô tick ở màn Phân quyền. Bài kiểm khớp với backend nằm ở
    //  `test/backend/test_dong_bo_giao_dien_v2.py` (chỉ bên đó đọc được
    //  cả hai danh sách).
    expect(ACTIONS.at(-1)).toBe('process')
    expect(ACTIONS.filter((a) => a === 'process')).toHaveLength(1)
  })

  it('ENTITIES matches the server list in `src/auth/principal.ts`, including the phase 4 user and recipient keys and ticket', () => {
    //  Chép tay từ máy chủ — thiếu một khóa thì `can()` trả false im lặng và cả màn (Người dùng, Người nhận) biến
    //  khỏi menu của chính quản trị.
    expect([...ENTITIES]).toEqual([
      'bot_account', 'conversation', 'contact', 'group', 'file', 'company', 'audit', 'setting', 'user', 'recipient', 'ticket',
    ])
  })

  it('ENTITIES không có khóa lặp', () => {
    expect(new Set(ENTITIES).size).toBe(ENTITIES.length)
  })

  it('ENTITIES viết snake_case thường — sai kiểu chữ là `can()` im lặng trả false', () => {
    const sai = ENTITIES.filter((e) => !/^[a-z][a-z0-9_]*$/.test(e))
    expect(sai).toEqual([])
  })
})
