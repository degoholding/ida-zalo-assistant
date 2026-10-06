import { describe, expect, it } from 'vitest'

import { clearGoogleOauthRedirectParams, parseGoogleOauthRedirectParams } from './google-oauth-redirect-params'

describe('parseGoogleOauthRedirectParams', () => {
  it('reads a successful connect redirect', () => {
    const params = new URLSearchParams('tab=google&google_oauth=connected')
    expect(parseGoogleOauthRedirectParams(params)).toEqual({ status: 'connected', message: null })
  })

  it('reads an error redirect and url-decodes the Vietnamese message', () => {
    const params = new URLSearchParams('tab=google&google_oauth=error&message=Thi%E1%BA%BFu%20quy%E1%BB%81n')
    expect(parseGoogleOauthRedirectParams(params)).toEqual({ status: 'error', message: 'Thiếu quyền' })
  })

  it('returns null when there is no google_oauth param at all', () => {
    expect(parseGoogleOauthRedirectParams(new URLSearchParams('tab=google'))).toBeNull()
  })

  it('returns null for an empty query string', () => {
    expect(parseGoogleOauthRedirectParams(new URLSearchParams(''))).toBeNull()
  })

  // Giá trị lạ (gõ tay, link cũ hỏng) không được coi là thành công hay lỗi — bỏ qua, không toast.
  it('returns null for an unknown google_oauth value instead of guessing', () => {
    expect(parseGoogleOauthRedirectParams(new URLSearchParams('google_oauth=weird'))).toBeNull()
  })
})

describe('clearGoogleOauthRedirectParams', () => {
  it('removes google_oauth and message but keeps other params like tab', () => {
    const params = new URLSearchParams('tab=google&google_oauth=error&message=L%E1%BB%97i')
    const cleaned = clearGoogleOauthRedirectParams(params)
    expect(cleaned.toString()).toBe('tab=google')
  })

  it('does not mutate the original URLSearchParams instance', () => {
    const params = new URLSearchParams('tab=google&google_oauth=connected')
    clearGoogleOauthRedirectParams(params)
    expect(params.get('google_oauth')).toBe('connected')
  })

  it('is a no-op when there is nothing to clear', () => {
    const params = new URLSearchParams('tab=google')
    expect(clearGoogleOauthRedirectParams(params).toString()).toBe('tab=google')
  })
})
