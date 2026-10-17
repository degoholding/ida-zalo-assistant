import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BOT_ACCOUNT_KIND, type BotAccount } from '../types/account'
import { AccountKindBadge } from './account-kind-badge'

const account = (kind: number): BotAccount => ({ kind }) as BotAccount

describe('AccountKindBadge', () => {
  it('labels a normal account as collect-only', () => {
    render(<AccountKindBadge account={account(BOT_ACCOUNT_KIND.normal)} />)
    expect(screen.getByText('Chỉ thu thập dữ liệu')).toBeInTheDocument()
  })

  it('labels an assistant account as «Trợ lý»', () => {
    render(<AccountKindBadge account={account(BOT_ACCOUNT_KIND.assistant)} />)
    expect(screen.getByText('Trợ lý')).toBeInTheDocument()
  })
})
