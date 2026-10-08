import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CrudFormFields } from '@/shared/crud/crud-form-fields'
import { buildFormDefaults, toApiPayload } from '@/shared/crud/field-values'
import type { CrudFormField, CrudRecord } from '@/shared/crud/types'
import type { RecipientDetail } from '../types/recipient'
import { recipientCrudConfig } from './recipient-crud'

const apiGet = vi.fn()
let permissions: Record<string, Record<string, boolean>> = {}

// Mock ở tầng `@/core/api` theo luật test (`testing.md`).
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  httpClient: { post: vi.fn() },
}))

//  Store thật kéo theo cả http-client; ở đây chỉ cần đúng hợp đồng selector (giống `use-permission.test.ts`).
vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { permissions: typeof permissions } }) => unknown) =>
    selector({ user: { permissions } }),
}))

const FIELDS = recipientCrudConfig.formFields as CrudFormField[]

const makeRecipient = (overrides: Partial<RecipientDetail> = {}): RecipientDetail => ({
  id: 7, name: 'Anh Hùng', title: 'CEO', rank_order: 1, contact_id: 12, contact_name: 'Hùng IDA', user_id: 0, user_email: null,
  all_groups: false, morning_brief_at: '07:30', evening_brief_at: '', notify_urgent: true, is_active: true,
  created_at: '2026-10-08T00:00:00Z', group_count: 1, vip_count: 1, group_ids: [3], vip_contact_ids: [40],
  vips: [{ contact_id: 40, name: 'Chị Mai' }], ...overrides,
})

function withQueryClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function Harness({ item, onSubmit }: { item?: CrudRecord; onSubmit?: (values: CrudRecord) => void }) {
  const { register, control, watch, handleSubmit, formState } = useForm<CrudRecord>({
    defaultValues: buildFormDefaults(FIELDS, item),
  })
  return (
    <form onSubmit={handleSubmit((values) => onSubmit?.(values))}>
      <CrudFormFields
        fields={FIELDS}
        register={register}
        control={control}
        errors={formState.errors}
        watch={watch}
        isReadonly={() => false}
      />
      <button type="submit">Lưu</button>
    </form>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  permissions = {}
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/lookups/groups') return Promise.resolve([{ id: 3, name: 'Kinh tế 52' }])
    if (url.startsWith('/api/contacts/')) return Promise.resolve({ id: 12, display_name: 'Hùng IDA', zalo_name: '', zalo_uid: 'u12' })
    if (url === '/api/users') return Promise.resolve({ total: 0, items: [] })
    return Promise.resolve({ total: 0, items: [] })
  })
})

describe('recipient detail actions', () => {
  it('offers «Gửi thử» to someone who may edit recipients', () => {
    permissions = { recipient: { read: true, write: true } }
    render(withQueryClient(recipientCrudConfig.detailActions?.(makeRecipient())))
    expect(screen.getByRole('button', { name: 'Gửi thử' })).toBeInTheDocument()
  })

  it('hides «Gửi thử» from a read-only viewer — the server would answer 403', () => {
    permissions = { recipient: { read: true, write: false } }
    render(withQueryClient(recipientCrudConfig.detailActions?.(makeRecipient())))
    expect(screen.queryByRole('button', { name: 'Gửi thử' })).toBeNull()
  })
})

describe('recipient form', () => {
  it('refuses to save a new recipient without a Zalo contact — the bot would have nowhere to send', async () => {
    const onSubmit = vi.fn()
    render(withQueryClient(<Harness onSubmit={onSubmit} />))

    await userEvent.type(screen.getByLabelText(/^Tên/), 'Anh Hùng')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(await screen.findByText('Người trên Zalo là bắt buộc')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('starts a new recipient with the server defaults: rank 1, briefs 07:30 / 17:30, urgent alerts on', () => {
    expect(buildFormDefaults(FIELDS, undefined)).toMatchObject({
      rank_order: 1, contact_id: 0, user_id: 0, all_groups: false, group_ids: [], vips: [],
      morning_brief_at: '07:30', evening_brief_at: '17:30', notify_urgent: true, is_active: true,
    })
  })

  it('hides the watched-group picker when «watch every group» is on', async () => {
    render(withQueryClient(<Harness item={makeRecipient({ all_groups: true })} />))
    expect(screen.queryByText('Nhóm theo dõi')).toBeNull()

    await userEvent.click(screen.getByRole('switch', { name: 'Theo dõi mọi nhóm' }))
    expect(screen.getByText('Nhóm theo dõi')).toBeInTheDocument()
  })

  it('shows the stored VIPs as removable chips and saves their ids, not the chip objects', async () => {
    const onSubmit = vi.fn()
    render(withQueryClient(<Harness item={makeRecipient()} onSubmit={onSubmit} />))

    expect(screen.getByText('Chị Mai')).toBeInTheDocument()
    expect(screen.getByText('Người VIP (1/50)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ Chị Mai' }))
    expect(screen.queryByText('Chị Mai')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const values = onSubmit.mock.calls[0][0] as CrudRecord
    const payload = recipientCrudConfig.buildPayload?.(toApiPayload(FIELDS, values)) ?? {}
    expect(payload.vip_contact_ids).toEqual([])
    expect(payload).not.toHaveProperty('vips')
    expect(payload.contact_id).toBe(12)
  })
})
