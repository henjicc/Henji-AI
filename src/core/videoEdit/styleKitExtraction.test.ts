import { describe, expect, it } from 'vitest'
import { extractStylePalettePixels, stylePaletteFromClusters, styleContrast, extractStyleFromWork } from './styleKitExtraction'
import { BUILTIN_STYLE_KITS } from './styleKitPresets'
describe('风格提取算法', () => {
  it('均匀色保真、透明忽略、半透明按覆盖面积加权，确定重放', () => {
    expect(extractStylePalettePixels(new Uint8ClampedArray([40, 80, 120, 255]))).toEqual([{ color: [40 / 255, 80 / 255, 120 / 255, 1], weight: 1 }])
    const pixels = new Uint8ClampedArray([...Array.from({ length: 40 }, () => [30, 40, 50, 255]).flat(), ...Array.from({ length: 20 }, () => [210, 100, 40, 128]).flat(), 0, 0, 0, 0])
    const clusters = extractStylePalettePixels(pixels)
    expect(clusters).toEqual(extractStylePalettePixels(pixels))
    expect(clusters[0].weight).toBeCloseTo(40 / (40 + 20 * 128 / 255))
    const palette = stylePaletteFromClusters(clusters)
    expect(palette.bg).toEqual(clusters[0].color)
    expect(styleContrast(palette.bg, palette.fg)).toBeGreaterThan(4.5)
    expect(styleContrast(palette.surface, palette.muted)).toBeGreaterThanOrEqual(4.5)
  })
  it('空白、透明和越过采样技术预算的输入明确失败', () => {
    for (const pixels of [new Uint8ClampedArray(), new Uint8ClampedArray([1, 2, 3]), new Uint8ClampedArray(4), new Uint8ClampedArray(128 * 128 * 4 + 4)]) expect(() => extractStylePalettePixels(pixels)).toThrow()
  })
  it('作品聚合字体、相对字号、代码参数与中位时长，保持候选不改原包', () => {
    const base = BUILTIN_STYLE_KITS[0]; const before = structuredClone(base)
    const observations = [1, 2, 3].map(value => ({ height: 1080, fonts: [{ family: 'sans-serif', weight: 400, size: 36 }], colors: [[.1, .1, .1, 1] as [number, number, number, number]], enterSeconds: value, parameters: { exitDuration: .4, enterEase: 'backOut' }, radius: 12 }))
    const extracted = extractStyleFromWork(observations, base, '自己的风格')
    expect(extracted.tokens.motion).toMatchObject({ enterDuration: 2, exitDuration: .4, enterEase: 'backOut', allowOvershoot: true })
    expect(extracted.tokens.shape.radius).toBeCloseTo(12 / 1080)
    expect(extracted.tokens.fonts.body.family).toBe('sans-serif')
    expect(base).toEqual(before)
    expect(extractStyleFromWork([], base, '空作品').tokens).toEqual(base.tokens)
    const foreground: [number, number, number, number] = [1, 1, 1, 1]
    const textOnly = extractStyleFromWork([{ height: 1080, fonts: [], colors: [foreground], colorRoles: { fg: foreground } }], base, '文字作品')
    expect(textOnly.tokens.palette.fg).toEqual(foreground); expect(styleContrast(textOnly.tokens.palette.bg, foreground)).toBeGreaterThanOrEqual(4.5)
  })
})
