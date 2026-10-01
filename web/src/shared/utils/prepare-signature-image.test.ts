import { describe, expect, it } from 'vitest'

import { computeScaledSize } from './prepare-signature-image'

describe('computeScaledSize', () => {
  it('không phóng to ảnh vốn đã nhỏ hơn giới hạn', () => {
    expect(computeScaledSize(400, 200, 800, 400)).toEqual({
      width: 400,
      height: 200,
      scale: 1,
    })
  })

  it('thu nhỏ theo cạnh vượt giới hạn NHIỀU nhất, giữ nguyên tỉ lệ', () => {
    // 4000x1000: chiều ngang vượt 5 lần, chiều dọc mới vượt 2,5 lần → lấy 1/5.
    expect(computeScaledSize(4000, 1000, 800, 400)).toMatchObject({
      width: 800,
      height: 200,
    })
  })

  it('ảnh cao hơn rộng thì cạnh dọc quyết định tỉ lệ', () => {
    expect(computeScaledSize(1000, 4000, 800, 400)).toMatchObject({
      width: 100,
      height: 400,
    })
  })

  it('ảnh rất dẹt vẫn còn ít nhất 1 điểm ảnh, không ra 0', () => {
    expect(computeScaledSize(10_000, 3, 800, 400).height).toBe(1)
  })
})
