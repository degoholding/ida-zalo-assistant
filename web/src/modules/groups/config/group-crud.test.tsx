import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { GroupDetail } from '../types/group'
import { GROUP_COLUMNS, groupCrudConfig } from './group-crud'

function makeGroup(overrides: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: 3, zalo_group_id: 'g-100', name: 'Ban giám đốc', label: '', group_kind: 1, company_id: 0, company_name: null,
    member_count: 5, read_messages: true, capture_files: true, retention_days: 365, is_confidential: false,
    file_retention_days: 180, first_seen_at: '2026-10-01T00:00:00Z', members_synced_at: null, avatar_url: null, bot_count: 1,
    message_count: 10, file_count: 2, last_message_at: null, members: [], bots: [], ...overrides,
  }
}

function renderNameCell(group: GroupDetail) {
  const column = GROUP_COLUMNS.find((item) => item.key === 'name')
  if (!column?.cell) throw new Error('thiếu cột Nhóm')
  render(<>{column.cell(group)}</>)
}

describe('group list and form config', () => {
  it('marks a confidential group with a «Mật» pill next to its name', () => {
    renderNameCell(makeGroup({ is_confidential: true }))
    expect(screen.getByText('Ban giám đốc')).toBeInTheDocument()
    expect(screen.getByText('Mật')).toBeInTheDocument()
  })

  it('shows no «Mật» pill for a normal group', () => {
    renderNameCell(makeGroup())
    expect(screen.queryByText('Mật')).toBeNull()
  })

  it('lets admins edit «Nhóm Mật» as a switch and «Số ngày giữ tệp gốc» as a required number', () => {
    // Tên ô PHẢI trùng khóa PATCH /api/groups/:id nhận — sai tên thì máy chủ bỏ qua im lặng
    const { formFields } = groupCrudConfig
    const fields = Array.isArray(formFields) ? formFields : formFields(makeGroup())
    const confidential = fields.find((field) => field.name === 'is_confidential')
    const fileRetention = fields.find((field) => field.name === 'file_retention_days')
    expect(confidential).toMatchObject({ label: 'Nhóm Mật', type: 'switch' })
    expect(confidential?.hint).toContain('không đưa nội dung nhóm cho AI')
    expect(fileRetention).toMatchObject({ label: 'Số ngày giữ tệp gốc', type: 'number', required: true })
    expect(fileRetention?.hint).toContain('Mặc định 180')
  })

  it('offers advanced filters for both new fields', () => {
    const names = groupCrudConfig.filterConfig?.fields.map((field) => field.name) ?? []
    expect(names).toEqual(expect.arrayContaining(['is_confidential', 'file_retention_days']))
  })
})
