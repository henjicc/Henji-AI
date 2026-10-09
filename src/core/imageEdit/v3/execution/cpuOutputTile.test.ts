import { describe, expect, it } from 'vitest'
import { encodeSrgbUnorm8V3 } from './cpuOutputTile'
import { decodeSrgbExtended, encodeSrgbExtended } from './tileColor'

describe('CPU sRGB8 精确量化', () => {
  it('全 16-bit 输入网格、所有半码临界点与 HDR 值均等于原公式', () => {
    const reference = (value: number) => Math.round(Math.max(0, Math.min(1, encodeSrgbExtended(value))) * 255)
    for (let sample = 0; sample < 65_536; sample++) expect(encodeSrgbUnorm8V3(sample / 65_535)).toBe(reference(sample / 65_535))
    for (let code = 0; code < 255; code++) {
      const boundary = decodeSrgbExtended((code + .5) / 255)
      for (const delta of [-1e-10, -1e-14, 0, 1e-14, 1e-10]) expect(encodeSrgbUnorm8V3(boundary + delta)).toBe(reference(boundary + delta))
    }
    for (const value of [-10, -.001, -0, 0, 1, 1.01, 10]) expect(encodeSrgbUnorm8V3(value)).toBe(reference(value))
    expect(() => encodeSrgbUnorm8V3(Infinity)).toThrow('有限数')
  })
})
