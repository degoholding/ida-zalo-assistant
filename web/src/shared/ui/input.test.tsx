import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Input } from './input'

/**
 * Ô số bị hai thói mặc định của trình duyệt phá: cặp mũi tên tăng/giảm và lăn
 * chuột đổi giá trị. Cả app dùng chung một `Input` nên luật phải nằm ở đây —
 * trước đó mỗi bảng tự chép một chuỗi class, chép sót chỗ nào là chỗ đó lại mọc
 * mũi tên (ô MOQ của phiếu khảo sát).
 */
describe('Input kiểu số', () => {
  it('giấu mũi tên tăng giảm của trình duyệt', () => {
    render(<Input type="number" defaultValue={0} />)
    expect(screen.getByRole('spinbutton').className).toContain(
      '[&::-webkit-inner-spin-button]:appearance-none',
    )
  })

  it('ô chữ thì không dính luật của ô số', () => {
    render(<Input placeholder="Tên sản phẩm" />)
    expect(screen.getByPlaceholderText('Tên sản phẩm').className).not.toContain(
      'appearance-none',
    )
  })

  it('bôi đen sẵn khi ô đang là 0, để gõ tiếp không thành "0124"', () => {
    render(<Input type="number" defaultValue={0} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    const select = vi.spyOn(input, 'select')

    fireEvent.focus(input)

    expect(select).toHaveBeenCalled()
  })

  it('có sẵn số thật thì để yên, không bôi đen cướp mất chỗ con trỏ', () => {
    render(<Input type="number" defaultValue={1500} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    const select = vi.spyOn(input, 'select')

    fireEvent.focus(input)

    expect(select).not.toHaveBeenCalled()
  })

  it('lăn chuột trên ô số thì nhả con trỏ ra, đơn giá không tự nhảy khi cuộn bảng', () => {
    render(<Input type="number" defaultValue={0} />)
    const input = screen.getByRole('spinbutton')
    input.focus()
    expect(document.activeElement).toBe(input)

    fireEvent.wheel(input)

    expect(document.activeElement).not.toBe(input)
  })

  it('vẫn gọi onFocus / onWheel do nơi dùng truyền vào', () => {
    const onFocus = vi.fn()
    const onWheel = vi.fn()
    render(<Input type="number" defaultValue={0} onFocus={onFocus} onWheel={onWheel} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.focus(input)
    fireEvent.wheel(input)

    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onWheel).toHaveBeenCalledTimes(1)
  })
})
