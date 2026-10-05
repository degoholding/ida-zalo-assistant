import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { appConfig } from '@/core/config/app-config'
import { THEME_STYLE_ELEMENT_ID } from './apply-theme'

// `public/theme-preload.js` là JS thuần chạy trước gói app nên không import được hằng — chép tay. Đổi khóa / id
// ở một bên mà quên bên kia thì bảng màu lóe lại mỗi lần mở trang, không ai báo lỗi.
const root = resolve(__dirname, '../../..')
const preload = readFileSync(resolve(root, 'public/theme-preload.js'), 'utf8')
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8')

describe('theme preload script', () => {
  it('reads the same localStorage key the app writes the theme to', () => {
    expect(preload).toContain(`'${appConfig.storageKeys.themeCss}'`)
  })

  it('creates the style element under the id apply-theme reuses', () => {
    expect(preload).toContain(`'${THEME_STYLE_ELEMENT_ID}'`)
  })

  // Lỗi thấy 03/10/2026: script nhúng trong index.html bị CSP `script-src 'self'` chặn, bảng màu lóe mỗi lần mở
  it('keeps index.html free of inline scripts so the server CSP does not block them', () => {
    const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
    expect(inlineScripts).toEqual([])
    expect(indexHtml).toContain('theme-preload.js')
  })
})
