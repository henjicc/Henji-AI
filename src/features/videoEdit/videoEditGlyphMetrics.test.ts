import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { invalidateCodeTextMetrics, measureCodeText, measureVideoEditGlyph } from './videoEditGlyphMetrics'

let width: number | undefined
let left = 0
let right: number | undefined
let calls = 0
beforeEach(() => {
  width = right = undefined; left = calls = 0
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() {
      return { font: '', measureText(text: string) {
        calls++
        const measured = width ?? text.length * Number(this.font.match(/([\d.]+)px/)?.[1])
        return { width: measured, actualBoundingBoxLeft: left, actualBoundingBoxRight: right ?? measured }
      } }
    }
  })
})
afterEach(() => { vi.unstubAllGlobals() })

it('实际宽度和ink bounds共同决定尺寸、边距，复用不可变数值结果', () => {
  width = 20.2; left = 3; right = 25.1
  const metrics = measureVideoEditGlyph('字', 20, 'sans-serif')
  expect(metrics).toEqual({ width: 33, height: 34, offsetX: 5, font: '20px sans-serif' })
  expect(Object.isFrozen(metrics)).toBe(true)
  expect(measureVideoEditGlyph('字', 20, 'sans-serif')).toBe(metrics)
  expect(calls).toBe(1)
  measureVideoEditGlyph('字', 21, 'sans-serif'); measureVideoEditGlyph('字', 20, 'serif')
  expect(calls).toBe(3)
})
it('8192宽及四百万像素使用真实包含padding的排他预算边界', () => {
  width = 8188
  expect(measureVideoEditGlyph('宽边界', 1, 'sans-serif').width).toBe(8192)
  width = 8188.01
  expect(() => measureVideoEditGlyph('超宽', 1, 'sans-serif')).toThrow('8192')
  width = 4092
  expect(measureVideoEditGlyph('像素边界', 680, 'sans-serif')).toMatchObject({ width: 4096, height: 1024 })
  expect(() => measureVideoEditGlyph('超像素', 681, 'sans-serif')).toThrow('四百万')
})
it('缓存仅保留64项并按最近使用淘汰，不保留像素或GPU资源', () => {
  measureVideoEditGlyph('保留', 1, 'sans-serif')
  for (let index = 0; index < 63; index++) measureVideoEditGlyph(`标题${index}`, 1, 'sans-serif')
  measureVideoEditGlyph('保留', 1, 'sans-serif')
  measureVideoEditGlyph('新的', 1, 'sans-serif')
  expect(calls).toBe(65)
  measureVideoEditGlyph('保留', 1, 'sans-serif'); expect(calls).toBe(65)
  measureVideoEditGlyph('标题0', 1, 'sans-serif'); expect(calls).toBe(66)
})
it('缺失2D环境、非有限测量和非法作者输入全部失败关闭', () => {
  width = Number.NaN
  expect(() => measureVideoEditGlyph('坏测量', 20, 'sans-serif')).toThrow('测量结果无效')
  expect(() => measureVideoEditGlyph('字', Number.POSITIVE_INFINITY, 'sans-serif')).toThrow('有效范围')
  expect(() => measureVideoEditGlyph('字'.repeat(4097), 20, 'sans-serif')).toThrow('有效范围')
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null } })
  expect(() => measureVideoEditGlyph('缺上下文', 20, 'sans-serif')).toThrow('无法测量')
  vi.stubGlobal('OffscreenCanvas', undefined)
  expect(() => measureVideoEditGlyph('缺环境', 20, 'sans-serif')).toThrow('无法测量')
})
it('v3共享布局缓存、任意字体名称与字体加载后的失效', () => {
  const request = { text: '中文标题', fontFamily: 'Imported Font', fontWeight: 700, fontStyle: 'italic', fontSize: 20, letterSpacing: 2, lineHeight: 1.2, maxWidth: 55, wrap: true, maxLines: 2 }
  const layout = measureCodeText(request); const before = calls
  expect(layout.lines).toEqual(['中文', '标题']); expect(layout.font).toContain('"Imported Font"'); expect(layout.width).toBe(42)
  expect(measureCodeText(request)).toBe(layout); expect(calls).toBe(before)
  invalidateCodeTextMetrics(); const refreshed = measureCodeText(request); expect(refreshed).not.toBe(layout); expect(refreshed.fontGeneration).not.toBe(layout.fontGeneration); expect(calls).toBeGreaterThan(before)
  expect(measureVideoEditGlyph('字', 20, 'Imported Font').font).toContain('Imported Font')
})
it('v3缺失字体显式标记并改用sans-serif，坏测量拒绝', () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * (this.font.endsWith('serif') && !this.font.endsWith('sans-serif') ? 20 : 10) } } } } })
  const request = { text: 'AB', fontFamily: 'Missing Face', fontWeight: 400, fontStyle: 'normal', fontSize: 20, letterSpacing: 0, lineHeight: 1.2, maxWidth: 0, wrap: false, maxLines: 0 }
  expect(measureCodeText(request)).toMatchObject({ missingFont: 'Missing Face', font: 'normal 400 20px sans-serif', width: 20 })
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText() { return { width: Number.NaN } } } } })
  expect(() => measureCodeText(request)).toThrow('度量无效')
})
