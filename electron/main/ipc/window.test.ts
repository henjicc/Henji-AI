import { describe, expect, it } from 'vitest'

import { parseZoomFactor } from './window'

describe('window IPC zoom factor parser', () => {
  it.each([0.9, 1, 1.1] as const)('接受登记的缩放比例 %s', (factor) => {
    expect(parseZoomFactor({ factor })).toBe(factor)
  })

  it.each([0.85, 0, 1.2, '0.9', undefined])('拒绝未登记的缩放比例 %s', (factor) => {
    expect(() => parseZoomFactor({ factor })).toThrow('Expected zoom factor')
  })
})
