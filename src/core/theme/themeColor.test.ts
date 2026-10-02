import { describe, expect, it } from 'vitest'

import {
  WHITE,
  compositeOver,
  contrastRatio,
  deltaEOK,
  hexToOklch,
  mixOklab,
  normalizeHex,
  oklchToHex,
  parseColor,
  toRgbTriple,
  withAlpha,
} from './themeColor'

describe('themeColor', () => {
  it('sRGB → OKLCH 与 Ottosson / CSS Color 4 公布值一致', () => {
    // 参考值：红 oklch(0.62796 0.25768 29.23)、绿 (0.86644 0.29483 142.50)、蓝 (0.45201 0.31321 264.05)
    const red = hexToOklch('rgb(255,0,0)')
    expect(red.L).toBeCloseTo(0.62796, 4)
    expect(red.C).toBeCloseTo(0.25768, 4)
    expect(red.H).toBeCloseTo(29.234, 2)
    const green = hexToOklch('rgb(0,255,0)')
    expect(green.L).toBeCloseTo(0.86644, 4)
    expect(green.C).toBeCloseTo(0.29483, 4)
    expect(green.H).toBeCloseTo(142.495, 2)
    const blue = hexToOklch('rgb(0,0,255)')
    expect(blue.L).toBeCloseTo(0.45201, 4)
    expect(blue.C).toBeCloseTo(0.31321, 4)
    expect(blue.H).toBeCloseTo(264.052, 2)
    expect(hexToOklch(WHITE).L).toBeCloseTo(1, 6)
  })

  it('OKLCH → hex 往返在 8 位量化内稳定', () => {
    for (const color of ['rgb(58,111,223)', 'rgb(23,23,23)', 'rgb(217,130,43)', 'rgb(250,250,250)']) {
      const hex = normalizeHex(oklchToHex(hexToOklch(color).L, hexToOklch(color).C, hexToOklch(color).H))
      const { r, g, b } = parseColor(color)!
      const back = parseColor(hex!)!
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1)
    }
  })

  it('出色域时降彩度收敛，输出始终是合法 hex', () => {
    const hex = oklchToHex(0.6, 0.4, 25)
    expect(hex).toMatch(/^#[0-9A-F]{6}$/)
    expect(hexToOklch(hex).C).toBeLessThan(0.4)
  })

  it('WCAG 对比度：黑白 21:1，同色 1:1，参数顺序无关', () => {
    expect(contrastRatio(WHITE, 'rgb(0,0,0)')).toBeCloseTo(21, 6)
    expect(contrastRatio('rgb(80,90,100)', 'rgb(80,90,100)')).toBe(1)
    expect(contrastRatio('rgb(10,10,10)', WHITE)).toBe(contrastRatio(WHITE, 'rgb(10,10,10)'))
  })

  it('解析 hex、rgb()、rgba()（逗号与空格斜杠写法），拒绝非法值', () => {
    expect(parseColor('rgba(10, 11, 13, 0.56)')).toEqual({ r: 10, g: 11, b: 13, a: 0.56 })
    expect(parseColor('rgb(0 0 0 / 0.42)')).toEqual({ r: 0, g: 0, b: 0, a: 0.42 })
    expect(parseColor('rgb(256,0,0)')).toBeNull()
    expect(parseColor('rgba(0,0,0,1.5)')).toBeNull()
    expect(parseColor('blue')).toBeNull()
    expect(normalizeHex('abcdef')).toBe(normalizeHex('ABCDEF'))
    expect(normalizeHex('abc')).toBeNull()
  })

  it('透明度、三元组与合成', () => {
    expect(withAlpha(WHITE, 0.16)).toBe('rgba(255,255,255,0.16)')
    expect(toRgbTriple('rgba(10,11,13,0.5)')).toBe('10 11 13')
    expect(toRgbTriple(WHITE)).toBe('255 255 255')
    expect(compositeOver('rgba(0,0,0,0.5)', WHITE)).toBe(normalizeHex('808080'))
    expect(compositeOver('rgba(0,0,0,0)', 'rgb(1,2,3)')).toBe(normalizeHex('010203'))
  })

  it('OKLab 中点：端点不变、黑白中点亮度为 0.5', () => {
    expect(mixOklab(WHITE, WHITE)).toBe(WHITE)
    expect(mixOklab('rgb(0,0,0)', WHITE, 1)).toBe(WHITE)
    expect(hexToOklch(mixOklab('rgb(0,0,0)', WHITE)).L).toBeCloseTo(0.5, 2)
  })

  it('ΔE_OK：同色为 0，黑白约为 1', () => {
    expect(deltaEOK(WHITE, WHITE)).toBe(0)
    expect(deltaEOK(WHITE, 'rgb(0,0,0)')).toBeCloseTo(1, 3)
  })
})
