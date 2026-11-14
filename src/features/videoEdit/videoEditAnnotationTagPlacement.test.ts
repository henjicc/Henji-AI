import { expect, it } from 'vitest'
import { placeVideoEditAnnotationTag, videoEditAnnotationTagAnchor } from './videoEditAnnotationTagPlacement'

const frame = { width: 760, height: 428 }
const tag = { width: 180, height: 40 }
const inside = (at: { x: number; y: number }): boolean => at.x >= 8 && at.y >= 8 && at.x + tag.width <= frame.width - 8 && at.y + tag.height <= frame.height - 8

it('框贴着画面顶边：上方放不下就换到框的下边，再推回画面内', () => {
  const box = { kind: 'region' as const, x: .82, y: .02, width: .165, height: .13 }
  const at = placeVideoEditAnnotationTag(videoEditAnnotationTagAnchor(box, frame)!, tag, frame)
  expect(inside(at)).toBe(true)
  expect(at.y).toBeGreaterThanOrEqual((box.y + box.height) * frame.height)
})

it('箭头的标签放在尾端外侧，不压住箭头指向的地方', () => {
  const arrow = { kind: 'arrow' as const, from: { x: .4, y: .66 }, to: { x: .22, y: .43 } }
  const at = placeVideoEditAnnotationTag(videoEditAnnotationTagAnchor(arrow, frame)!, tag, frame)
  expect(at.x).toBeGreaterThan(arrow.from.x * frame.width)
  expect(at.y).toBeGreaterThan(arrow.from.y * frame.height)
})

it('点在左下角：标签换边后仍完整留在画面内；画面上的文字批注不挂标签', () => {
  const at = placeVideoEditAnnotationTag(videoEditAnnotationTagAnchor({ kind: 'point', x: .01, y: .99 }, frame)!, tag, frame)
  expect(inside(at)).toBe(true)
  expect(videoEditAnnotationTagAnchor({ kind: 'text', x: .5, y: .5 }, frame)).toBeNull()
})
