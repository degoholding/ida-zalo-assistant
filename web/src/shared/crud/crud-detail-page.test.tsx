import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CrudDetailPage } from './crud-detail-page'
import type { CrudConfig, CrudRecord } from './types'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPatch = vi.fn()

//  `useCrudSave` gọi thẳng `httpClient` để lấy cả `message` của phong bì (toast câu máy chủ nói);
//  mock bọc lại thành phong bì cho hai hàm giả `apiPost` / `apiPatch` giữ nguyên chữ ký cũ.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiPatch: (...args: unknown[]) => apiPatch(...args),
  apiDelete: vi.fn(),
  httpClient: {
    post: async (...args: unknown[]) => ({ data: { success: true, data: await apiPost(...args) } }),
    patch: async (...args: unknown[]) => ({ data: { success: true, data: await apiPatch(...args) } }),
  },
}))

vi.mock('@/core/authorization/use-permission', () => ({
  usePermission: () => ({ can: () => true, canAny: () => true }),
}))

//  Dấu vết là màn con tự gọi API riêng — không phải thứ bài này chịu trách nhiệm.
vi.mock('@/shared/audit', () => ({
  AuditTimeline: () => <div>dấu vết</div>,
}))

interface LeaveType extends CrudRecord {
  id: number
  code: string
  name: string
}

const CONFIG: CrudConfig<LeaveType> = {
  entity: 'company',
  title: 'Loại nghỉ',
  unitLabel: 'loại nghỉ',
  apiPath: '/api/leave-types',
  storageKey: 'test.leave-types',
  columns: [],
  listRoute: '/hr/leave-types',
  detailRoute: (id) => `/hr/leave-types/${id}`,
  createRoute: '/hr/leave-types/new',
  formFields: [
    //  Ô mã: khóa khi SỬA, mở khi TẠO — đúng chỗ dễ làm hỏng nhất.
    { name: 'code', label: 'Mã loại nghỉ', readonlyOnEdit: true },
    { name: 'name', label: 'Tên loại nghỉ' },
  ],
}

function build(path: string, config: CrudConfig<LeaveType> = CONFIG) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/hr/leave-types/new" element={<CrudDetailPage config={config} />} />
          <Route path="/hr/leave-types/:id" element={<CrudDetailPage config={config} />} />
          <Route path="/hr/leave-types" element={<div>trang danh sách</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Điền hai ô bắt buộc rồi bấm tạo. */
async function fillAndSubmit() {
  await userEvent.type(await screen.findByLabelText(/Mã loại nghỉ/), 'moi')
  await userEvent.type(screen.getByLabelText(/Tên loại nghỉ/), 'Loại mới')
  await userEvent.click(screen.getByRole('button', { name: 'Tạo loại nghỉ' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  apiGet.mockResolvedValue({ id: 5, code: 'annual', name: 'Phép năm' })
  apiPost.mockResolvedValue({ id: 9, code: 'moi', name: 'Loại mới' })
})

/**
 * Chế độ THÊM MỚI của trang chi tiết CRUD — route tĩnh không có `:id`.
 * Xem docstring của `CrudDetailPage` và `CrudConfig.createRoute`.
 */
describe('CrudDetailPage — thêm mới', () => {
  it('KHÔNG gọi API chi tiết khi chưa có bản ghi', async () => {
    //  Gọi thì đó là `GET /api/leave-types/undefined` — 404 rồi màn hình rơi
    //  vào nhánh "không tìm thấy", đúng lúc người dùng vừa bấm Thêm.
    build('/hr/leave-types/new')
    expect(await screen.findByRole('heading', { name: 'Thêm loại nghỉ' })).toBeInTheDocument()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('mở ô `readonlyOnEdit` ra cho nhập — mã chỉ nhập được đúng lần này', async () => {
    build('/hr/leave-types/new')
    expect(await screen.findByLabelText(/Mã loại nghỉ/)).toBeInTheDocument()
  })

  it('khóa ô đó lại khi SỬA', async () => {
    build('/hr/leave-types/5')
    await screen.findByRole('heading', { name: /Phép năm|annual/ })
    expect(screen.queryByLabelText(/Mã loại nghỉ/)).toBeNull()
  })

  it('không có nút Xóa và không có dấu vết khi chưa tạo', async () => {
    build('/hr/leave-types/new')
    await screen.findByRole('heading', { name: 'Thêm loại nghỉ' })
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull()
    expect(screen.queryByText('dấu vết')).toBeNull()
  })

  it('lưu bằng POST rồi ĐI TIẾP sang bản ghi vừa tạo', async () => {
    //  Đứng lại ở form rỗng thì bấm Lưu lần nữa là tạo thêm một bản trùng.
    build('/hr/leave-types/new')
    await userEvent.type(await screen.findByLabelText(/Mã loại nghỉ/), 'moi')
    await userEvent.type(screen.getByLabelText(/Tên loại nghỉ/), 'Loại mới')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo loại nghỉ' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    expect(apiPost.mock.calls[0][0]).toBe('/api/leave-types')
    expect(apiPatch).not.toHaveBeenCalled()
    //  Đã sang trang chi tiết của id 9 — tiêu đề "Thêm" biến mất.
    await waitFor(() => expect(screen.queryByText('Thêm loại nghỉ')).toBeNull())
  })

  it('bấm Tạo BA LẦN liên tiếp chỉ gửi MỘT lệnh', async () => {
    //  LỖI ĐÃ XẢY RA (04/09/2026): ba cú bấm ra ba POST — bản ghi chỉ tạo một
    //  (ràng buộc duy nhất ở DB đỡ hộ) nhưng người dùng nhận một toast xanh rồi
    //  hai toast đỏ «Hệ thống gặp lỗi không lường trước». Danh mục không có cột
    //  duy nhất thì đó là ba bản ghi trùng.
    build('/hr/leave-types/new')
    await userEvent.type(await screen.findByLabelText(/Mã loại nghỉ/), 'moi')
    await userEvent.type(screen.getByLabelText(/Tên loại nghỉ/), 'Loại mới')

    const nut = screen.getByRole('button', { name: 'Tạo loại nghỉ' })
    nut.click()
    nut.click()
    nut.click()

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    expect(apiPost).toHaveBeenCalledTimes(1)
  })

  it('backend trả về THIẾU id thì rơi về danh sách, không đi tới `/undefined`', async () => {
    //  Đường dẫn ghép từ id trả về; id rỗng mà vẫn điều hướng là người dùng tạo
    //  xong bị ném vào một trang 404 và tưởng mình vừa làm hỏng.
    apiPost.mockResolvedValue({ code: 'moi', name: 'Loại mới' })
    build('/hr/leave-types/new')
    await fillAndSubmit()
    expect(await screen.findByText('trang danh sách')).toBeInTheDocument()
  })

  it('config KHÔNG khai `detailRoute` thì cũng rơi về danh sách', async () => {
    const { detailRoute: _bo, ...khongCoTrangChiTiet } = CONFIG
    build('/hr/leave-types/new', khongCoTrangChiTiet)
    await fillAndSubmit()
    expect(await screen.findByText('trang danh sách')).toBeInTheDocument()
  })

  it('sửa bản ghi cũ thì vẫn PATCH, không POST', async () => {
    build('/hr/leave-types/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
    expect(apiPost).not.toHaveBeenCalled()
  })
})

/**
 * ─── D5: id NGOÀI PHẠM VI dữ liệu ───
 *
 * Backend không phân biệt "không tồn tại" với "ngoài phạm vi": `get_scoped(...)`
 * lọc trước rồi trả **404** cho cả hai — cố ý, vì trả 403 là xác nhận bản ghi đó
 * có thật (rò rỉ thông tin qua mã lỗi). Nghĩa là gõ thẳng một id vào URL để dò
 * dữ liệu ngoài phạm vi thì màn hình phải nói được điều gì đó, chứ không được
 * treo ở khung trắng hay ở skeleton vĩnh viễn.
 */
describe('CrudDetailPage — id ngoài phạm vi (D5)', () => {
  it('404 -> hiện "Không tìm thấy", KHÔNG phải trang trắng', async () => {
    apiGet.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404 } }))
    build('/hr/leave-types/999999')

    expect(await screen.findByText('Không tìm thấy loại nghỉ')).toBeInTheDocument()
    //  Câu mô tả phải nêu CẢ HAI khả năng: người dùng không có cách nào tự phân
    //  biệt, nói thiếu một vế là họ đi báo lỗi nhầm chỗ.
    expect(screen.getByText(/đã bị xóa hoặc bạn không có quyền xem/)).toBeInTheDocument()
  })

  it('có lối quay về danh sách, không bắt bấm nút Back của trình duyệt', async () => {
    apiGet.mockRejectedValue(new Error('404'))
    build('/hr/leave-types/999999')

    await userEvent.click(await screen.findByRole('button', { name: /Về danh sách/ }))
    expect(await screen.findByText('trang danh sách')).toBeInTheDocument()
  })

  it('API trả `null` (bản ghi bị lọc mất) cũng vào nhánh không tìm thấy', async () => {
    //  Không phải mọi đường đọc đều ném lỗi: có endpoint trả `data: null` trong
    //  phong bì thành công. Thiếu nhánh `!item` thì trang render với dữ liệu
    //  rỗng — form trắng trơn trông y như một bản ghi mới.
    apiGet.mockResolvedValue(null)
    build('/hr/leave-types/999999')

    expect(await screen.findByText('Không tìm thấy loại nghỉ')).toBeInTheDocument()
  })
})
