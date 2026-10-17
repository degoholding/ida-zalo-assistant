import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrudRecord } from '@/shared/crud/types'
import { ContactRoleField } from './contact-role-field'

let canWriteUsers = false
vi.mock('@/core/authorization/use-permission', () => ({
  usePermission: () => ({ can: (entity: string, action: string) => entity === 'user' && action === 'write' && canWriteUsers }),
}))

function Harness() {
  const { control } = useForm<CrudRecord>({ defaultValues: { role: 2 } })
  return <ContactRoleField control={control} name="role" disabled={false} />
}

beforeEach(() => { canWriteUsers = false })

describe('ContactRoleField', () => {
  it('shows plain text, no selector, for someone who cannot write users (manager / staff)', () => {
    render(<Harness />)
    expect(screen.getByText('Quản lý')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('offers the selector to an admin', () => {
    canWriteUsers = true
    render(<Harness />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
