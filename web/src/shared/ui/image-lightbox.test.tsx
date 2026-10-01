import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ImageLightbox, type LightboxImage } from './image-lightbox'

const IMAGES: LightboxImage[] = [
  { url: 'a.png', name: 'Ảnh A' },
  { url: 'b.png', name: 'Ảnh B' },
  { url: 'c.png', name: 'Ảnh C' },
]

afterEach(cleanup)

describe('ImageLightbox', () => {
  it('hiện bộ đếm theo vị trí đang xem (1-based)', () => {
    render(
      <ImageLightbox
        images={IMAGES}
        index={0}
        open
        onOpenChange={vi.fn()}
        onIndexChange={vi.fn()}
      />,
    )
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('bấm "Ảnh sau" thì báo vị trí kế tiếp', async () => {
    const onIndexChange = vi.fn()
    render(
      <ImageLightbox
        images={IMAGES}
        index={0}
        open
        onOpenChange={vi.fn()}
        onIndexChange={onIndexChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }))
    expect(onIndexChange).toHaveBeenCalledWith(1)
  })

  it('ở ảnh đầu bấm "Ảnh trước" thì vòng về ảnh cuối', async () => {
    const onIndexChange = vi.fn()
    render(
      <ImageLightbox
        images={IMAGES}
        index={0}
        open
        onOpenChange={vi.fn()}
        onIndexChange={onIndexChange}
      />,
    )
    // Lỗi hay gặp: quá đầu không vòng lại mà kẹt ở 0 (hoặc ra -1).
    await userEvent.click(screen.getByRole('button', { name: 'Ảnh trước' }))
    expect(onIndexChange).toHaveBeenCalledWith(2)
  })

  it('bấm "Sao chép liên kết ảnh" thì chép URL tuyệt đối vào clipboard', async () => {
    // CR-190 port: liên kết chép ra phải là URL tuyệt đối, không phải đường dẫn tương đối.
    const writeText = vi.fn().mockResolvedValue(undefined)
    // Dùng fireEvent thay vì userEvent vì userEvent tự thay navigator.clipboard bằng stub riêng.
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(
      <ImageLightbox
        images={IMAGES}
        index={0}
        open
        onOpenChange={vi.fn()}
        onIndexChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết ảnh' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(new URL('a.png', window.location.href).href),
    )
  })

  it('có nút tải ảnh xuống trên thanh công cụ', () => {
    render(
      <ImageLightbox
        images={IMAGES}
        index={0}
        open
        onOpenChange={vi.fn()}
        onIndexChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Tải ảnh xuống' })).toBeInTheDocument()
  })

  it('chỉ một ảnh thì ẩn nút chuyển', () => {
    render(
      <ImageLightbox
        images={[IMAGES[0]]}
        index={0}
        open
        onOpenChange={vi.fn()}
        onIndexChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Ảnh sau' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ảnh trước' })).not.toBeInTheDocument()
  })
})
