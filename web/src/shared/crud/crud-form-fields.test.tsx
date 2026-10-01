import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import { CrudFormFields } from './crud-form-fields'
import { buildFormDefaults } from './field-values'
import type { CrudFormField, CrudRecord } from './types'

vi.mock('@/core/api', () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [] }),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}))

/**
 * LƯỚI Ô của form CRUD.
 *
 * Hai việc nó làm hơn một vòng `map`, và cả hai đều sinh ra từ màn *Loại nghỉ*
 * (07/09/2026) — form 15 ô bày phẳng, trong đó bốn ô chỉ có nghĩa ở một nhánh
 * cấu hình. Người khai danh mục là nhân sự, không phải người viết luật; đoán sai
 * quan hệ giữa hai ô ở màn đó là khai sai luật nghỉ cho cả công ty.
 */

const FIELDS: CrudFormField[] = [
  { name: 'code', label: 'Mã' },
  { name: 'mode', label: 'Chế độ', type: 'number', defaultValue: 0 },
  {
    name: 'ratio',
    label: 'Tỷ lệ quy đổi',
    type: 'number',
    defaultValue: 1,
    section: 'Số dư cuối năm',
    showWhen: (values) => Number(values.mode) === 2,
  },
  { name: 'active', label: 'Đang dùng', type: 'switch', defaultValue: true, section: 'Hiển thị' },
  //  Ô KHÔNG khai nhóm, đứng CUỐI — chốt luật gom theo dải liên tiếp.
  { name: 'note', label: 'Ghi chú' },
]

function Harness({ fields = FIELDS }: { fields?: CrudFormField[] }) {
  const { register, control, watch, formState } = useForm<CrudRecord>({
    defaultValues: buildFormDefaults(fields, undefined),
  })
  return (
    <CrudFormFields
      fields={fields}
      register={register}
      control={control}
      errors={formState.errors}
      watch={watch}
      isReadonly={() => false}
    />
  )
}

function build(fields?: CrudFormField[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness fields={fields} />
    </QueryClientProvider>,
  )
}

describe('CrudFormFields', () => {
  it('gom ô theo nhóm và dựng tiêu đề nhóm', () => {
    build()
    expect(screen.getByRole('heading', { name: 'Hiển thị' })).toBeInTheDocument()
  })

  it('KHÔNG dựng tiêu đề rỗng cho những ô chưa khai nhóm', () => {
    //  Màn cũ chưa chia nhóm phải giữ nguyên khuôn — thêm một dòng chữ rỗng
    //  phía trên còn khó đọc hơn không có.
    build([{ name: 'code', label: 'Mã' }])
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('ẩn ô mà `showWhen` trả về false — ô đó chưa có câu trả lời đúng', () => {
    build()
    expect(screen.queryByLabelText('Tỷ lệ quy đổi')).not.toBeInTheDocument()
  })

  it('hiện lại NGAY khi giá trị điều kiện đổi, không đợi lưu', async () => {
    build()
    await userEvent.clear(screen.getByLabelText('Chế độ'))
    await userEvent.type(screen.getByLabelText('Chế độ'), '2')
    expect(screen.getByLabelText('Tỷ lệ quy đổi')).toBeInTheDocument()
    //  Nhóm của ô vừa hiện cũng phải mọc theo, không nằm lạc sang nhóm khác.
    expect(screen.getByRole('heading', { name: 'Số dư cuối năm' })).toBeInTheDocument()
  })

  it('ô bị ẩn KHÔNG kéo theo tiêu đề nhóm rỗng', () => {
    build()
    expect(screen.queryByRole('heading', { name: 'Số dư cuối năm' })).not.toBeInTheDocument()
  })
})

describe('CrudFormFields — trật tự và khuôn ô', () => {
  it('giữ ô không khai nhóm ở ĐÚNG CHỖ CUỐI, không kéo ngược lên đầu', () => {
    //  Gom theo TÊN nhóm thì «Ghi chú» nhập chung với cụm không tên mở màn và
    //  nhảy lên trên cùng — người khai config không cách nào xếp nó xuống dưới.
    build()
    const labels = screen
      .getAllByText(/^(Mã|Chế độ|Đang dùng|Ghi chú)$/)
      .map((node) => node.textContent)
    expect(labels).toEqual(['Mã', 'Chế độ', 'Đang dùng', 'Ghi chú'])
  })

  it('nhóm mở đầu bằng CÔNG TẮC thì công tắc nằm TRÊN ô nhập nó mở ra', () => {
    //  Bản cũ luôn đẩy ô nhập lên trên, nên bật «Trừ quỹ phép» ở dưới thì ô
    //  «Hạn mức» mọc ra PHÍA TRÊN cái nút vừa bấm — ngoài tầm mắt đang nhìn.
    build([
      { name: 'counts', label: 'Trừ quỹ phép', type: 'switch', defaultValue: true, section: 'Quỹ' },
      { name: 'quota', label: 'Hạn mức', type: 'number', defaultValue: 0, section: 'Quỹ' },
    ])
    const labels = screen.getAllByText(/^(Trừ quỹ phép|Hạn mức)$/).map((node) => node.textContent)
    expect(labels).toEqual(['Trừ quỹ phép', 'Hạn mức'])
  })

  it('nhóm mở đầu bằng Ô NHẬP thì công tắc vẫn xuống dưới như cũ', () => {
    build([
      { name: 'gender', label: 'Giới tính', section: 'Điều kiện' },
      { name: 'attach', label: 'Bắt buộc đính kèm', type: 'switch', section: 'Điều kiện' },
    ])
    const labels = screen
      .getAllByText(/^(Giới tính|Bắt buộc đính kèm)$/)
      .map((node) => node.textContent)
    expect(labels).toEqual(['Giới tính', 'Bắt buộc đính kèm'])
  })

  it('công tắc KHÔNG lặp lại chữ trạng thái bên cạnh chính nó', () => {
    //  Bản cũ in «Đang dùng / Hoạt động» cạnh mỗi công tắc — nói lại đúng thứ
    //  công tắc đang nói, mà lại bằng từ của danh mục nên với một nút tên «Có
    //  hưởng lương» thì câu đó vô nghĩa.
    build()
    expect(screen.queryByText(/Hoạt động/)).not.toBeInTheDocument()
  })

  it('bấm vào NHÃN cũng lật được công tắc — vùng bấm rộng hơn hẳn', async () => {
    build()
    const toggle = screen.getByRole('switch', { name: 'Đang dùng' })
    expect(toggle).toBeChecked()
    await userEvent.click(screen.getByText('Đang dùng'))
    expect(toggle).not.toBeChecked()
  })
})
