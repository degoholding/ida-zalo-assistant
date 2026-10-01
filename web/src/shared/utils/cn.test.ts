import { describe, expect, it } from 'vitest'

import { cn } from './cn'

describe('cn', () => {
  it('class sau ghi đè class trước khi cùng nhóm Tailwind', () => {
    // Đây là lý do tồn tại của hàm: nối chuỗi bằng tay thì cả `p-2` lẫn `p-4`
    // cùng nằm trong DOM và thắng thua tùy thứ tự trong tệp CSS.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm text-muted-foreground', 'text-destructive')).toBe(
      'text-sm text-destructive',
    )
  })

  it('bỏ qua giá trị falsy của điều kiện', () => {
    const off = false
    const on = true
    expect(cn('rounded-md', off && 'bg-accent', undefined, null, '')).toBe('rounded-md')
    expect(cn('rounded-md', on && 'bg-accent')).toBe('rounded-md bg-accent')
  })

  it('className truyền từ ngoài đặt cuối thì ghi đè được mặc định', () => {
    const base = 'border p-4'
    expect(cn(base, 'p-6')).toBe('border p-6')
  })

  it('nhận mảng và object như clsx', () => {
    expect(cn(['flex', 'gap-2'], { hidden: false, 'items-center': true })).toBe(
      'flex gap-2 items-center',
    )
  })
})
