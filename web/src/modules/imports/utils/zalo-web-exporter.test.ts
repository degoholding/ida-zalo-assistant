import { describe, expect, it } from 'vitest'

import { buildZaloWebExporter, EXPORT_ALL_CONVERSATIONS, toBookmarklet } from './zalo-web-exporter'

// Mã nằm trong template string của TypeScript: quên nhân đôi một dấu \ (regex \d, chuỗi \n) là mã chạy trên
// Zalo vỡ cú pháp mà typecheck không thấy — đã gặp với heredoc ngày 02/10/2026. Biên dịch thử để bắt sớm.
const compiles = (source: string) => () => new Function(source)

describe('buildZaloWebExporter', () => {
  it('compiles in every mode without running', () => {
    expect(compiles(buildZaloWebExporter(EXPORT_ALL_CONVERSATIONS))).not.toThrow()
    expect(compiles(buildZaloWebExporter(null))).not.toThrow()
    expect(compiles(buildZaloWebExporter([{ id: '123', name: 'KINH TẾ K52' }]))).not.toThrow()
  })

  it('keeps the message-id regex intact after escaping', () => {
    expect(buildZaloWebExporter(null)).toContain('/^(\\d+)@(\\d+)_(\\d+)_(g?\\d+)$/')
  })

  it('emits pure ASCII even when group names carry Vietnamese marks or quotes', () => {
    const source = buildZaloWebExporter([{ id: '1', name: 'Phòng "Kế toán" — Đà Nẵng' }, { id: '2', name: "Kho 'A'</script>" }])
    expect(/^[\x20-\x7e\n]*$/.test(source)).toBe(true)
    expect(compiles(source)).not.toThrow()
  })

  it('passes the target list through unchanged', () => {
    const targets = [{ id: '42', name: 'Nhóm Đặc biệt' }, { id: '7', name: '' }]
    const source = buildZaloWebExporter(targets)
    const json = source.slice(source.lastIndexOf(')(') + 2, source.lastIndexOf(');'))
    expect(JSON.parse(json)).toEqual(targets)
  })

  it('passes null for the open-conversation mode, ALL as a string and an empty list as an empty array', () => {
    expect(buildZaloWebExporter(EXPORT_ALL_CONVERSATIONS).endsWith(")('ALL');")).toBe(true)
    expect(buildZaloWebExporter(null).endsWith(')(null);')).toBe(true)
    expect(buildZaloWebExporter([]).endsWith(')([]);')).toBe(true)
  })
})

describe('toBookmarklet', () => {
  it('round-trips through URL decoding as a javascript: URL', () => {
    const source = buildZaloWebExporter([{ id: '1', name: 'Nhóm 100%' }])
    const url = toBookmarklet(source)
    expect(url.startsWith('javascript:')).toBe(true)
    expect(decodeURIComponent(url.slice('javascript:'.length))).toBe(source)
  })
})
