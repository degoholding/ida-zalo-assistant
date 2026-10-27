import { describe, expect, it } from 'vitest'

import { accountTag, parseAccountFilter } from './account-tag'

describe('accountTag', () => {
  it('shows the first account and "+n" for the rest, full names with kind in the title', () => {
    expect(accountTag(undefined)).toBeNull()
    expect(accountTag([])).toBeNull()
    expect(accountTag([{ id: 1, name: 'Lạc Lạc', kind: 0, kind_label: 'Trợ lý' }])).toEqual({ text: 'Lạc Lạc', title: 'Lạc Lạc (Trợ lý)' })
    expect(
      accountTag([
        { id: 1, name: 'Lạc Lạc', kind: 0, kind_label: 'Trợ lý' },
        { id: 2, name: 'Bot kho', kind: 1, kind_label: 'Chỉ thu thập' },
        { id: 3, name: 'Bot 3', kind: 1, kind_label: 'Chỉ thu thập' },
      ]),
    ).toEqual({ text: 'Lạc Lạc +2', title: 'Lạc Lạc (Trợ lý), Bot kho (Chỉ thu thập), Bot 3 (Chỉ thu thập)' })
  })
})

describe('parseAccountFilter', () => {
  it('reads ?acc=3,5 and drops junk / duplicates', () => {
    expect(parseAccountFilter(null)).toEqual([])
    expect(parseAccountFilter('3,5,3,x,-1,0')).toEqual([3, 5])
  })
})
