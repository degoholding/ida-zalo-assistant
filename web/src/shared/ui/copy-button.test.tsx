import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CopyButton } from './copy-button'

/** jsdom không cài `navigator.clipboard` — dựng bản giả để đo lời gọi. */
function stubClipboard(writeText = vi.fn(async () => {})) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
  return writeText
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('CopyButton', () => {
  /**
   * Lỗi đã gặp: mã hàng trên bảng dòng nằm trong ô CHỌN (một `<button>`), bôi
   * đen không được nên không ai chép nổi mã đem đi tra ở nơi khác.
   */
  it('bấm là chép đúng giá trị vào bộ nhớ tạm', async () => {
    const writeText = stubClipboard()
    render(<CopyButton value="NAP0029" label="mã hàng" />)

    await userEvent.click(screen.getByRole('button', { name: /Chép mã hàng/ }))

    expect(writeText).toHaveBeenCalledWith('NAP0029')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Đã chép mã hàng/ })).toBeInTheDocument(),
    )
  })

  it('không có giá trị thì không vẽ nút, khỏi chép ra chuỗi rỗng', () => {
    render(<CopyButton value="" />)

    expect(screen.queryByRole('button')).toBeNull()
  })
})
