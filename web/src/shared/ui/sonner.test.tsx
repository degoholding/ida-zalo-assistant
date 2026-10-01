import { render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { Toaster } from './sonner'

//  `next-themes` không có provider trong test — chỉ cần nó trả về một theme.
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light' }) }))

/**
 * Dựng Toaster rồi bắn MỘT bóng thông báo, trả về thẻ toaster.
 *
 * Phải có bóng thật: sonner không vẽ gì cả khi hàng đợi rỗng, nên
 * `[data-sonner-toaster]` chưa tồn tại — hỏi ngay sau `render` là hỏi hụt.
 */
async function dungVoiMotBong(props: Parameters<typeof Toaster>[0] = {}) {
  render(<Toaster closeButton {...props} />)
  toast('Không xuất được danh sách. Thử lọc bớt rồi xuất lại.')
  const text = await screen.findByText(/Không xuất được danh sách/)

  const thanh = document.querySelector('[data-sonner-toaster]')
  if (!(thanh instanceof HTMLElement)) throw new Error('không dựng được thẻ toaster')
  return { thanh, toastBox: text.closest('[data-sonner-toast]') }
}

describe('Toaster', () => {
  it('nút đóng nằm bên PHẢI, TRONG khung và canh GIỮA chiều cao', async () => {
    //  Trước dùng ba biến `--toast-close-button-*` để định vị; nay chuyển sang
    //  lớp Tailwind ở `classNames.closeButton` (dễ đọc, khỏi đấu đặc tả với sonner).
    //  Nút X phải bám mép PHẢI (`right-2.5`), TRONG khung (không `left-0`) và canh
    //  giữa chiều cao (`top-1/2` + `translateY(-50%)`).
    const { toastBox } = await dungVoiMotBong()
    const closeButton = toastBox?.querySelector('[data-close-button]')
    expect(closeButton).toBeTruthy()

    expect(closeButton?.className).toMatch(/\bright-2\.5!/)
    expect(closeButton?.className).toMatch(/\btop-1\/2!/)
    expect(closeButton?.className).toMatch(/\bleft-auto!/)
    expect(closeButton?.className).not.toMatch(/\bleft-0!/)
  })

  it('chừa lề phải cho nút đóng, kẻo chữ chạy xuống dưới nút', async () => {
    const { toastBox } = await dungVoiMotBong()
    //  `!` (important) là cố ý, không phải thói quen xấu: luật gốc của sonner là
    //  `[data-sonner-toast][data-styled="true"]` — đặc tả 0,2,0, cao hơn một lớp
    //  Tailwind thường, mà lớp tiện ích lại còn nằm trong `@layer` nên thua cả
    //  luật không-lớp. Bỏ dấu `!` đi là lề biến mất và chữ chui xuống dưới nút X.
    expect(toastBox?.className).toMatch(/\bpr-9!/)
  })

  it('props của bên gọi vẫn thắng — `style` riêng không bị ba biến kia nuốt', async () => {
    //  `{...props}` từng đứng CUỐI nên nó ghi đè trọn gói `style` và
    //  `toastOptions` của chính component này. Nay props đứng trước và hai thứ
    //  đó được trộn tay; bài này giữ cho lần dọn sau không lỡ tay đảo lại.
    const { thanh } = await dungVoiMotBong({ style: { '--width': '420px' } as React.CSSProperties })

    expect(thanh.style.getPropertyValue('--width').trim()).toBe('420px')
    //  Đồng thời style RIÊNG của component (nền toast) vẫn còn, không bị props nuốt.
    expect(thanh.style.getPropertyValue('--normal-bg').trim()).toBe('var(--popover)')
  })
})
