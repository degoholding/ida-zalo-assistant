import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GroupBackfillButton } from './group-backfill-button'

let canWriteGroup = false
vi.mock('@/core/authorization/use-permission', () => ({
  usePermission: () => ({ can: (entity: string, action: string) => entity === 'group' && action === 'write' && canWriteGroup }),
}))
vi.mock('../hooks/use-groups', () => ({
  useBackfillGroup: () => ({ job: undefined, start: vi.fn(), isStarting: false }),
}))

beforeEach(() => { canWriteGroup = false })

describe('GroupBackfillButton', () => {
  it('is hidden for staff (no group.write)', () => {
    render(<GroupBackfillButton groupId={3} />)
    expect(screen.queryByRole('button', { name: /Lấy tin cũ/ })).toBeNull()
  })

  it('shows for managers / admins (group.write)', () => {
    canWriteGroup = true
    render(<GroupBackfillButton groupId={3} />)
    expect(screen.getByRole('button', { name: /Lấy tin cũ/ })).toBeInTheDocument()
  })
})
