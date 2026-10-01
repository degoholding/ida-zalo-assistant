import { fireEvent, render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import type { CrudRecord } from '@/shared/crud/types'
import { ContactTagsField } from './contact-tags-field'

function Harness({ initial, onValues }: { initial: string[]; onValues: (values: CrudRecord) => void }) {
  const { control, handleSubmit } = useForm<CrudRecord>({ defaultValues: { tags: initial } })
  return (
    <form onSubmit={handleSubmit(onValues)}>
      <ContactTagsField control={control} name="tags" disabled={false} />
      <button type="submit">Lưu</button>
    </form>
  )
}

describe('ContactTagsField', () => {
  it('keeps the comma the user just typed while pushing a clean array into the form', async () => {
    let submitted: CrudRecord | null = null
    render(<Harness initial={['vip']} onValues={(values) => { submitted = values }} />)
    const input = screen.getByLabelText('Thẻ') as HTMLInputElement
    expect(input.value).toBe('vip')
    fireEvent.change(input, { target: { value: 'vip, đại lý,' } })
    // Dấu phẩy cuối còn nguyên trong ô — tách ngay thì người dùng không gõ tiếp được thẻ thứ ba
    expect(input.value).toBe('vip, đại lý,')
    fireEvent.click(screen.getByText('Lưu'))
    await screen.findByText('Lưu')
    expect(submitted).toEqual({ tags: ['vip', 'đại lý'] })
  })

  it('clearing the box submits an empty array so the server removes old tags', async () => {
    let submitted: CrudRecord | null = null
    render(<Harness initial={['vip', 'x']} onValues={(values) => { submitted = values }} />)
    fireEvent.change(screen.getByLabelText('Thẻ'), { target: { value: '  ' } })
    fireEvent.click(screen.getByText('Lưu'))
    await screen.findByText('Lưu')
    expect(submitted).toEqual({ tags: [] })
  })
})
