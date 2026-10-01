import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { useUrlSearchParam } from './use-url-search-param'

const DELAY = 20

function Probe() {
  const { value, setValue, debouncedValue } = useUrlSearchParam('q', DELAY)
  const [, setSearchParams] = useSearchParams()

  return (
    <>
      <input
        aria-label="Tìm kiếm"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <span data-testid="debounced">{debouncedValue}</span>
      {/* Đóng vai nút "Xóa lọc": xóa param từ NGOÀI ô nhập. */}
      <button type="button" onClick={() => setSearchParams({}, { replace: true })}>
        Xóa lọc
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

describe('useUrlSearchParam', () => {
  it('nạp sẵn từ khóa có trên URL', () => {
    build('/?q=nguyen')
    expect(screen.getByLabelText('Tìm kiếm')).toHaveValue('nguyen')
  })

  it('ngừng gõ thì từ khóa mới có hiệu lực (debounce)', async () => {
    const nguoi = userEvent.setup()
    build()
    await nguoi.type(screen.getByLabelText('Tìm kiếm'), 'an')

    expect(screen.getByLabelText('Tìm kiếm')).toHaveValue('an')
    await waitFor(() => expect(screen.getByTestId('debounced')).toHaveTextContent('an'))
  })

  it('URL bị xóa từ NGOÀI thì ô nhập trống theo', async () => {
    //  Lỗi cũ: ô nhập là nguồn sự thật tuyệt đối sau lần khởi tạo, nên bấm
    //  "Xóa lọc" xong từ khóa vẫn nằm chình ình trong ô còn bảng thì đã trả về
    //  đủ dữ liệu — nhìn như bảng hỏng.
    const nguoi = userEvent.setup()
    build('/?q=nguyen')

    await nguoi.click(screen.getByRole('button', { name: 'Xóa lọc' }))

    expect(screen.getByLabelText('Tìm kiếm')).toHaveValue('')
    await waitFor(() => expect(screen.getByTestId('debounced')).toHaveTextContent(''))
  })

  it('gõ tiếp ngay sau khi nhịp ghi trước đáp xuống URL thì KHÔNG bị nuốt ký tự', async () => {
    //  Chính ô này ghi URL bằng `debouncedValue`; nếu nhận lại mọi thay đổi của
    //  URL thì lần ghi đó nhảy ngược vào ô và xóa mấy ký tự vừa gõ thêm.
    const nguoi = userEvent.setup()
    build()
    const o = screen.getByLabelText('Tìm kiếm')

    await nguoi.type(o, 'an')
    await waitFor(() => expect(screen.getByTestId('debounced')).toHaveTextContent('an'))

    await nguoi.type(o, 'h')
    expect(o).toHaveValue('anh')
    await waitFor(() => expect(screen.getByTestId('debounced')).toHaveTextContent('anh'))
    expect(o).toHaveValue('anh')
  })
})
