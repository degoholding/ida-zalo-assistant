import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { fromHere, useBackTarget } from './use-back-target'

function Probe() {
  const { url, fromElsewhere } = useBackTarget('/hr/employees')
  return (
    <>
      <span data-testid="url">{url}</span>
      <span data-testid="from">{String(fromElsewhere)}</span>
    </>
  )
}

function build(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe />
    </MemoryRouter>,
  )
}

const url = () => screen.getByTestId('url').textContent
const fromElsewhere = () => screen.getByTestId('from').textContent

describe('fromHere', () => {
  it('mang theo cả query, không chỉ đường dẫn', () => {
    //  Chỗ đứng của người dùng nằm trong query: tab đang mở, bộ lọc, số trang.
    //  Bỏ `search` thì quay lại đúng trang nhưng sai chỗ — đúng lỗi phải vá.
    expect(fromHere({ pathname: '/hr/job-positions/13', search: '?tab=holders' })).toEqual({
      from: '/hr/job-positions/13?tab=holders',
    })
  })

  it('trang không có query thì không đẻ ra dấu hỏi thừa', () => {
    expect(fromHere({ pathname: '/hr/departments/12', search: '' })).toEqual({
      from: '/hr/departments/12',
    })
  })
})

describe('useBackTarget', () => {
  it('có đường quay lại thì trỏ về ĐÚNG chỗ đã đến, kèm query', () => {
    build({ pathname: '/hr/employees/79', state: { from: '/hr/job-positions/13?tab=holders' } })

    expect(url()).toBe('/hr/job-positions/13?tab=holders')
    expect(fromElsewhere()).toBe('true')
  })

  it('gõ thẳng URL thì rơi về danh sách — luôn có một đích hợp lệ', () => {
    //  Mở tab mới, vào từ thông báo, hay bookmark: không có `state` nào cả.
    build('/hr/employees/79')

    expect(url()).toBe('/hr/employees')
    expect(fromElsewhere()).toBe('false')
  })

  it('state có nhưng THIẾU khóa `from` thì vẫn rơi về danh sách', () => {
    //  Trang khác gài `state` cho việc riêng của nó (vd cờ vừa-tạo-xong) —
    //  không được hiểu nhầm là đường quay lại rồi trỏ nút lùi vào `undefined`.
    build({ pathname: '/hr/employees/79', state: { justCreated: true } })

    expect(url()).toBe('/hr/employees')
    expect(fromElsewhere()).toBe('false')
  })

  it('`from` rỗng cũng tính là không có — nút lùi không được trỏ vào chuỗi rỗng', () => {
    build({ pathname: '/hr/employees/79', state: { from: '' } })

    expect(url()).toBe('/hr/employees')
    expect(fromElsewhere()).toBe('false')
  })
})
