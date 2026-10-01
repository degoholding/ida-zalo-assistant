import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { splitMultiValue, useUrlMultiParam } from './use-url-multi-param'

function Probe() {
  const [values, setValues] = useUrlMultiParam('status')
  const [searchParams] = useSearchParams()

  return (
    <>
      <span data-testid="url">{searchParams.toString()}</span>
      <span data-testid="count">{values.length}</span>
      <span data-testid="values">{values.join('|')}</span>
      <button type="button" onClick={() => setValues(['ordered', 'received'])}>
        Chọn hai
      </button>
      <button type="button" onClick={() => setValues(['ordered'])}>
        Chọn một
      </button>
      <button type="button" onClick={() => setValues([])}>
        Bỏ hết
      </button>
    </>
  )
}

function build(url = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
    </MemoryRouter>,
  )
}

describe('splitMultiValue', () => {
  it('returns an empty list for an empty string instead of one blank entry', () => {
    //  Lọt một phần tử rỗng là ô lọc tưởng "đang lọc" trong khi người dùng chưa
    //  chọn gì — danh sách rỗng mà không ai hiểu vì sao.
    expect(splitMultiValue('')).toEqual([])
    expect(splitMultiValue('   ')).toEqual([])
    expect(splitMultiValue(',,')).toEqual([])
  })

  it('trims spaces and drops empty pieces from a hand-typed URL', () => {
    expect(splitMultiValue(' ordered , ,received ')).toEqual(['ordered', 'received'])
  })

  it('drops duplicates but keeps the order they were picked in', () => {
    expect(splitMultiValue('received,ordered,received')).toEqual(['received', 'ordered'])
  })
})

describe('useUrlMultiParam', () => {
  it('reads a comma-joined param from the URL', () => {
    build('/?status=ordered,received')

    expect(screen.getByTestId('count')).toHaveTextContent('2')
    expect(screen.getByTestId('values')).toHaveTextContent('ordered|received')
  })

  it('reports nothing selected when the param is absent', () => {
    build('/')

    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('writes one comma-joined param, not one repeated key per value', async () => {
    //  Hai kiểu backend đều đọc được, nhưng dạng nối phẩy cho link ngắn và giữ
    //  nguyên khuôn "một ô lọc = một param" của các màn khác.
    const nguoi = userEvent.setup()
    build()

    await nguoi.click(screen.getByRole('button', { name: 'Chọn hai' }))

    expect(screen.getByTestId('url')).toHaveTextContent('status=ordered%2Creceived')
  })

  it('keeps a single pick as a plain single-value param', async () => {
    const nguoi = userEvent.setup()
    build()

    await nguoi.click(screen.getByRole('button', { name: 'Chọn một' }))

    expect(screen.getByTestId('url')).toHaveTextContent('status=ordered')
  })

  it('clears the param entirely when nothing is left, keeping other filters', async () => {
    //  Bỏ hết KHÔNG được để lại `?status=` rỗng: backend coi chuỗi rỗng là
    //  "không lọc" nên kết quả vẫn đúng, nhưng link gửi đi thì bẩn và ô lọc
    //  khác dễ bị hiểu nhầm là đã bị xóa theo.
    const nguoi = userEvent.setup()
    build('/?company_id=3&status=ordered')

    await nguoi.click(screen.getByRole('button', { name: 'Bỏ hết' }))

    expect(screen.getByTestId('url')).toHaveTextContent('company_id=3')
    expect(screen.getByTestId('url')).not.toHaveTextContent('status')
  })
})
