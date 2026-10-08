import { afterEach, expect, it, vi } from 'vitest'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { paintVideoEditText, rasterizeVideoEditText, videoEditTextResolution } from './videoEditTextSurface'

function context() {
  const operations: Array<{ op: string; args: unknown[]; composite: string; width: number; alpha: number; filter: string; font: string }> = []
  const target = {
    operations, font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 0, lineJoin: '', globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', fontKerning: '',
    measureText: (text: string) => ({ width: [...text].length * 20 }),
    save: vi.fn(), restore: vi.fn(), scale: vi.fn(), translate: vi.fn(), transform: vi.fn(), beginPath: vi.fn(),
    clearRect: vi.fn(), roundRect: vi.fn(), fill: vi.fn(),
    fillRect: vi.fn(), strokeText: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(),
  }
  for (const op of ['fillText', 'strokeText', 'drawImage', 'fillRect'] as const) target[op].mockImplementation((...args: unknown[]) => { operations.push({ op, args, composite: target.globalCompositeOperation, width: target.lineWidth, alpha: target.globalAlpha, filter: target.filter, font: target.font }) })
  return target
}
let contexts: ReturnType<typeof context>[] = []
function install() {
  contexts = []
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { const value = context(); contexts.push(value); return value } })
  return context()
}
afterEach(() => { vi.unstubAllGlobals() })
it('外侧描边减去字形，内侧描边与字形相交，居中宽度正确；多层从外到内绘制', () => {
  const target = install(); const style = defaultVideoEditTextStyle(1080)
  style.strokes = [{ enabled: true, color: BLACK_HEX, width: 4, position: 'inside' }, { enabled: true, color: BLACK_HEX, width: 6, position: 'outside' }, { enabled: true, color: WHITE_HEX, width: 2, position: 'center' }]
  paintVideoEditText(target as unknown as OffscreenCanvasRenderingContext2D, { text: 'O', textStyle: style }, 1920, 1080)
  const layer = contexts[1]
  expect(layer.operations.filter(op => op.op === 'strokeText').map(op => op.width)).toEqual([12, 2, 8])
  expect(layer.operations.filter(op => op.op === 'drawImage').map(op => op.composite)).toEqual(['source-over', 'destination-out', 'destination-in'])
  expect(target.drawImage).toHaveBeenCalledTimes(4)
})
it('多层阴影各自应用角度、距离、大小、模糊与不透明度，关闭层不绘制', () => {
  const target = install(); const style = defaultVideoEditTextStyle(1080); style.fill.enabled = false
  style.shadows = [{ enabled: true, color: BLACK_HEX, opacity: .3, angle: 0, distance: 10, size: 2, blur: 3 }, { enabled: true, color: BLACK_HEX, opacity: .8, angle: 90, distance: 20, size: 0, blur: 7 }, { enabled: false, color: BLACK_HEX, opacity: 1, angle: 0, distance: 0, size: 0, blur: 0 }]
  paintVideoEditText(target as unknown as OffscreenCanvasRenderingContext2D, { text: '影', textStyle: style }, 3840, 2160)
  const images = target.operations.filter(op => op.op === 'drawImage')
  expect(images.map(op => [op.alpha, op.filter])).toEqual([[.3, 'blur(3px)'], [.8, 'blur(7px)']])
  expect(images[0].args.slice(1)).toEqual([10, 0, 3840, 2160]); expect(images[1].args[2]).toBe(20)
  expect(contexts[1].strokeText).toHaveBeenCalledWith('影', expect.any(Number), expect.any(Number))
})
it('局部纹理保留固定段落换行、基线、描边与阴影外延，放大按分档且不改变逻辑尺寸', () => {
  install(); const style = defaultVideoEditTextStyle(2160)
  Object.assign(style, { boxWidth: .1, boxHeight: .2, baselineShift: 500, fauxItalic: true })
  style.strokes = [{ enabled: true, color: BLACK_HEX, width: 20, position: 'outside' }]
  style.shadows = [{ enabled: true, color: BLACK_HEX, opacity: .7, angle: 180, distance: 40, size: 10, blur: 15 }]
  const clip = { text: 'abcdefghijk\nabcdefghijk', textStyle: style }
  const first = rasterizeVideoEditText(clip, { width: 3840, height: 2160 })
  const second = rasterizeVideoEditText(clip, { width: 3840, height: 2160 }, 2)
  expect(first.canvas.width).toBeLessThan(3840); expect(first.canvas.height).toBeLessThan(2160)
  expect(first.y).toBeLessThan(-500); expect(second.width).toBe(first.width); expect(second.height).toBe(first.height)
  expect(second.canvas.width).toBe(first.canvas.width * 2); expect(second.canvas.height).toBe(first.canvas.height * 2)
  expect(contexts.some(target => target.scale.mock.calls.some(call => call[0] === 2))).toBe(true)
  expect([.5, 1, 1.1, 1.9, 2, 2.1].map(videoEditTextResolution)).toEqual([1, 1, 2, 2, 2, 4])
})
it('字距、手动字偶间距、行距、基线、大小写和下划线应用在同一布局', () => {
  const target = install(); const style = { ...defaultVideoEditTextStyle(1080), fontSize: 100, tracking: 100, kerning: 50, leading: 140, baselineShift: 12, allCaps: true, underline: true, verticalAlign: 'top' as const, align: 'left' as const }
  paintVideoEditText(target as unknown as OffscreenCanvasRenderingContext2D, { text: 'ab\ncd', textStyle: style }, 1920, 1080)
  expect(contexts[0].fillText.mock.calls).toEqual([['A', 960, 598], ['B', 995, 598], ['C', 960, 738], ['D', 995, 738]])
  expect(contexts[0].fillRect).toHaveBeenCalledTimes(2)
})
it('小型大写/上标改变字形字号与基线，背景框有独立圆角/边距和透明度', () => {
  const target = install(); const style = defaultVideoEditTextStyle(1080)
  Object.assign(style, { smallCaps: true, superscript: true }); style.background = { enabled: true, color: BLACK_HEX, opacity: .4, padding: 10, radius: 8 }
  paintVideoEditText(target as unknown as OffscreenCanvasRenderingContext2D, { text: 'aB', textStyle: style }, 1920, 1080)
  expect(contexts[0].operations.filter(op => op.op === 'fillText').map(op => op.font)).toEqual(['normal 400 35.1px sans-serif', 'normal 400 46.800000000000004px sans-serif'])
  expect(target.roundRect).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), 8)
  expect(target.fill).toHaveBeenCalledOnce()
})
