import { expect, it } from 'vitest'
import { defaultVideoEditTextStyle, layoutVideoEditText, resizeVideoEditText, videoEditTextPoint, videoEditTextStyleSchema } from './text'
import { videoEditClipToFrame } from './clipGeometry'

const frame = { width: 1920, height: 1080 }
const measure = (text: string): number => [...text].length * 20
it('显示画框换算点击位置，拒绝未就绪布局，拖动可落在画面外', () => {
  const rect = { left: 100, top: 50, width: 960, height: 540 }
  expect(videoEditTextPoint({ x: 340, y: 185 }, rect)).toEqual({ x: .25, y: .25 })
  expect(videoEditTextPoint({ x: -140, y: 185 }, rect, false)).toEqual({ x: -.25, y: .25 })
  expect(() => videoEditTextPoint({ x: 0, y: 0 }, { ...rect, width: 0 })).toThrow('尚未就绪')
})
it('点文字保留旧首行中心，段落固定宽度换行并保留换行和 Unicode', () => {
  const old = layoutVideoEditText({ text: '旧字\n第二行' }, frame, measure)
  expect(old.top + old.lineHeight / 2).toBe(frame.height / 2)
  const style = { ...defaultVideoEditTextStyle(frame.height), anchor: 'top' as const, align: 'left' as const, boxWidth: 60 / frame.width }
  const paragraph = layoutVideoEditText({ text: '甲乙丙丁\n😀123', textStyle: style }, frame, measure)
  expect(paragraph.lines).toEqual(['甲乙丙', '丁', '😀12', '3'])
  expect(paragraph.width).toBe(60); expect(paragraph.left).toBe(960); expect(paragraph.top).toBe(540)
})
it('旋转与非默认运动锚点下缩放两倍，保持对角位置；负缩放收紧到下限', () => {
  const clip = { x: -.2, y: -.1, scale: 1, rotation: 30, anchorX: .25, anchorY: .75 }
  const layout = layoutVideoEditText({ text: '文字' }, frame, measure)
  const fixed = videoEditClipToFrame(clip, frame, frame, layout.left / frame.width, layout.top / frame.height)
  const moving = videoEditClipToFrame(clip, frame, frame, (layout.left + layout.width) / frame.width, (layout.top + layout.height) / frame.height)
  const next = resizeVideoEditText(clip, frame, layout, 2, { x: fixed.x + 2 * (moving.x - fixed.x), y: fixed.y + 2 * (moving.y - fixed.y) })
  expect(next.scale).toBeCloseTo(2)
  const after = videoEditClipToFrame({ ...clip, ...next }, frame, frame, layout.left / frame.width, layout.top / frame.height)
  expect(after.x).toBeCloseTo(fixed.x); expect(after.y).toBeCloseTo(fixed.y)
  expect(resizeVideoEditText(clip, frame, layout, 2, fixed).scale).toBe(.01)
})
it('样式边界拒绝非法颜色、尺寸与额外属性', () => {
  const style = defaultVideoEditTextStyle(1080)
  expect(videoEditTextStyleSchema.safeParse({ ...style, boxWidth: 2 }).success).toBe(false)
  expect(videoEditTextStyleSchema.safeParse({ ...style, color: 'red' }).success).toBe(false)
  expect(videoEditTextStyleSchema.safeParse({ ...style, fontSize: NaN }).success).toBe(false)
  expect(videoEditTextStyleSchema.safeParse({ ...style, execute: 'x' }).success).toBe(false)
})
