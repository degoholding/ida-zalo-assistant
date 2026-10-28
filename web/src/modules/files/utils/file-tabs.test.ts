import { describe, expect, it } from 'vitest'

import { FILE_TABS, resolveFileTab } from './file-tabs'

describe('resolveFileTab', () => {
  it('maps ?tab=links to the shared links tab and anything else to files', () => {
    expect(FILE_TABS.map((tab) => tab.key)).toEqual(['files', 'links'])
    expect(resolveFileTab('links')).toBe('links')
    expect(resolveFileTab(null)).toBe('files')
    expect(resolveFileTab('lạ')).toBe('files')
  })
})
