import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CrudField } from './crud-field'
import { buildFormDefaults } from './field-values'
import type { CrudFormField } from './types'

const apiGet = vi.fn()

vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}))

const FIELDS: CrudFormField[] = [
  {
    name: 'contract_type',
    label: 'Loại hợp đồng',
    type: 'select',
    // Mã tiếng Anh + nhãn tiếng Việt, đúng bộ của CR-118.
    options: [
      { value: 'principle', label: 'Hợp đồng nguyên tắc' },
      { value: 'purchase', label: 'Hợp đồng mua bán' },
    ],
    defaultValue: 'purchase',
  },
  {
    name: 'company_id',
    label: 'Công ty pháp nhân',
    type: 'select',
    source: { url: '/api/companies', valueKey: 'id', labelKey: 'name' },
    defaultValue: 0,
    placeholder: 'Chọn pháp nhân đứng tên',
  },
]

let queryClient: QueryClient

/**
 * Dựng lại đúng nhịp của trang chi tiết: vẽ form bằng giá trị mặc định trước,
 * bản ghi về sau mới `reset` đè lên. Chính nhịp hai bước này làm lộ lỗi.
 *
 * Thẻ `<form>` bọc ngoài là BẮT BUỘC — thấy có form thì Radix mới dựng thẻ
 * `<select>` ẩn để đồng bộ, mà thủ phạm nằm ở đó.
 */
function Harness({
  item,
  onSubmit,
}: {
  item?: Record<string, unknown>
  onSubmit?: (values: Record<string, unknown>) => void
}) {
  const {
    register,
    control,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, unknown>>({
    defaultValues: buildFormDefaults(FIELDS),
  })

  useEffect(() => {
    if (item) reset(buildFormDefaults(FIELDS, item))
  }, [item, reset])

  return (
    <QueryClientProvider client={queryClient}>
      <form onSubmit={handleSubmit((values) => onSubmit?.(values))}>
        {FIELDS.map((field) => (
          <CrudField
            key={field.name}
            field={field}
            register={register}
            control={control}
            errors={errors}
          />
        ))}
        <button type="submit">Lưu</button>
      </form>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  apiGet.mockReset()
  apiGet.mockResolvedValue({ items: [{ id: 1, name: 'CÔNG TY CP DEGO' }] })
})

describe('CrudField — ô chọn', () => {
  /**
   * Lỗi đã gặp (hợp đồng HDX0177): Radix đồng bộ thẻ `<select>` ẩn bằng cách gán
   * thẳng `select.value`; giá trị chưa có `<option>` tương ứng ngay lúc đó bị trình
   * duyệt ép về chuỗi rỗng rồi bắn `change` ngược lại thành `onValueChange('')`.
   * Hai ô "Loại hợp đồng" và "Công ty pháp nhân" hiện chữ gợi ý y như ô TRỐNG dù
   * bản ghi có dữ liệu, bấm Lưu là ghi rỗng đè lên giá trị thật.
   */
  it('giá trị cũ ngoài danh sách chọn không bị xóa trắng sau khi nạp bản ghi', async () => {
    const saved = vi.fn()
    render(<Harness item={{ contract_type: 'Hợp đồng kinh tế', company_id: 1 }} onSubmit={saved} />)

    const typeCombobox = await screen.findByRole('combobox', { name: 'Loại hợp đồng' })
    await waitFor(() => expect(typeCombobox).toHaveTextContent('Hợp đồng kinh tế'))

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(saved.mock.calls[0][0].contract_type).toBe('Hợp đồng kinh tế')
  })

  /**
   * Ô nạp danh sách từ API còn dễ dính hơn: `reset` đổ giá trị vào lúc danh sách
   * chưa về, nên KHÔNG có `<option>` nào khớp ở nhịp vẽ đó.
   */
  it('ô chọn nạp từ API giữ nguyên giá trị dù danh sách về sau', async () => {
    const saved = vi.fn()
    render(<Harness item={{ contract_type: 'purchase', company_id: 1 }} onSubmit={saved} />)

    const companyField = await screen.findByRole('combobox', { name: 'Công ty pháp nhân' })
    await waitFor(() => expect(companyField).toHaveTextContent('CÔNG TY CP DEGO'))

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(saved.mock.calls[0][0].company_id).toBe(1)
  })
})
