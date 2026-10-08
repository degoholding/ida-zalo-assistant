import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FILE_STATUS } from '../types/file'
import { FileStatusBadge } from './file-status-badge'

describe('FileStatusBadge', () => {
  it('labels an expired file as original deleted with text kept', () => {
    render(<FileStatusBadge status={FILE_STATUS.expired} />)
    expect(screen.getByText('Đã xóa tệp gốc (còn chữ)')).toBeInTheDocument()
  })

  it('adds a «Giữ» marker only for kept files', () => {
    const { rerender } = render(<FileStatusBadge status={FILE_STATUS.stored} keepFile />)
    expect(screen.getByText('Giữ')).toBeInTheDocument()
    rerender(<FileStatusBadge status={FILE_STATUS.stored} keepFile={false} />)
    expect(screen.queryByText('Giữ')).toBeNull()
  })

  it('shows an empty pill instead of crashing for a status code the UI does not know', () => {
    render(<FileStatusBadge status={99} lastError="mã lạ" />)
    expect(screen.getByText('mã lạ')).toBeInTheDocument()
  })
})
