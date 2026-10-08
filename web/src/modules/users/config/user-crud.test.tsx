import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { USER_ROLE } from '@/core/auth/user-role'
import { CrudFormFields } from '@/shared/crud/crud-form-fields'
import { buildFormDefaults } from '@/shared/crud/field-values'
import type { CrudFormField, CrudRecord } from '@/shared/crud/types'
import { userCrudConfig } from './user-crud'

const apiGet = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — ô chọn nhóm / người gọi lookup thật qua đây.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}))

const FIELDS = userCrudConfig.formFields as CrudFormField[]

function Harness({ item }: { item?: CrudRecord }) {
  const { register, control, watch, formState } = useForm<CrudRecord>({ defaultValues: buildFormDefaults(FIELDS, item) })
  return (
    <CrudFormFields
      fields={FIELDS}
      register={register}
      control={control}
      errors={formState.errors}
      watch={watch}
      isReadonly={() => false}
    />
  )
}

function renderForm(item?: CrudRecord) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness item={item} />
    </QueryClientProvider>,
  )
}

const makeUser = (overrides: CrudRecord = {}): CrudRecord => ({
  id: 7, email: 'lan@ida.vn', full_name: 'Chị Lan', role: USER_ROLE.staff, contact_id: 0, all_groups: false,
  is_active: true, group_ids: [3], ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  apiGet.mockImplementation((url: string) =>
    Promise.resolve(url === '/api/lookups/groups' ? [{ id: 3, name: 'Kinh tế 52' }] : { total: 0, items: [] }),
  )
})

describe('user form', () => {
  it('shows the group scope picker for a staff member who does not see every group', () => {
    renderForm(makeUser())
    expect(screen.getByText('Nhóm được xem')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Thấy mọi nhóm' })).toBeInTheDocument()
  })

  it('hides the whole group scope for an admin — admins always see every group', () => {
    renderForm(makeUser({ role: USER_ROLE.admin }))
    expect(screen.queryByText('Nhóm được xem')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Thấy mọi nhóm' })).toBeNull()
    expect(screen.queryByText('Phạm vi nhóm')).toBeNull()
  })

  it('hides it too when the role comes back from the select as the string «1»', () => {
    //  Ô chọn của khung CRUD trả CHUỖI; so `=== 1` thô thì quản trị vẫn thấy ô chọn nhóm vô nghĩa.
    renderForm(makeUser({ role: '1' }))
    expect(screen.queryByText('Nhóm được xem')).toBeNull()
  })

  it('hides the group picker when «all groups» is on, and brings it back when switched off', async () => {
    renderForm(makeUser({ all_groups: true }))
    expect(screen.queryByText('Nhóm được xem')).toBeNull()

    await userEvent.click(screen.getByRole('switch', { name: 'Thấy mọi nhóm' }))
    expect(screen.getByText('Nhóm được xem')).toBeInTheDocument()
  })

  it('starts a new user as staff, active, scoped to no group', () => {
    const defaults = buildFormDefaults(FIELDS, undefined)
    expect(defaults).toMatchObject({ role: USER_ROLE.staff, is_active: true, all_groups: false, contact_id: 0, group_ids: [] })
  })

  it('tells the admin the email is what Google login matches on', () => {
    renderForm()
    expect(screen.getByText('Người này đăng nhập bằng nút Google với đúng email này')).toBeInTheDocument()
  })

  it('uses the exact field names the users API accepts', () => {
    //  Tên ô sai là máy chủ bỏ qua im lặng — bấm Lưu báo thành công mà không đổi gì.
    expect(FIELDS.map((field) => field.name).sort()).toEqual(
      ['all_groups', 'contact_id', 'email', 'full_name', 'group_ids', 'is_active', 'role'].sort(),
    )
  })
})
