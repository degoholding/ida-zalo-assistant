import { describe, expect, it } from 'vitest'

import type { TicketAttachment } from '../types/ticket'
import { splitTicketAttachments } from './split-ticket-attachments'

const makeAttachment = (overrides: Partial<TicketAttachment>): TicketAttachment => ({
  id: 1, file_name: 'anh.jpg', is_image: true, status: 1, bytes: 2048, download_url: '/api/tickets/5/files/1', ...overrides,
})

describe('splitTicketAttachments', () => {
  it('puts stored images in the grid with the inline view url', () => {
    const { images, files } = splitTicketAttachments([makeAttachment({})])
    expect(images).toEqual([{ id: 1, url: '/api/tickets/5/files/1?inline=1', name: 'anh.jpg' }])
    expect(files).toEqual([])
  })

  it('sends an image that is not in storage yet to the file list instead of a broken thumbnail', () => {
    const pending = makeAttachment({ id: 2, status: 0, download_url: null })
    const { images, files } = splitTicketAttachments([pending])
    expect(images).toEqual([])
    expect(files).toEqual([pending])
  })

  it('keeps non-image files as downloads, in the original order', () => {
    const pdf = makeAttachment({ id: 3, file_name: 'bao-cao.pdf', is_image: false, download_url: '/api/tickets/5/files/3' })
    const xlsx = makeAttachment({ id: 4, file_name: 'so.xlsx', is_image: false, download_url: null, status: 2 })
    const { images, files } = splitTicketAttachments([pdf, makeAttachment({ id: 9 }), xlsx])
    expect(images.map((image) => image.id)).toEqual([9])
    expect(files.map((file) => file.id)).toEqual([3, 4])
  })

  it('returns two empty lists for a ticket without attachments', () => {
    expect(splitTicketAttachments([])).toEqual({ images: [], files: [] })
  })
})
