import { VIDEO_EDIT_DOCUMENT_VERSION } from '../persistence/schemaVersions'
import { expect, it } from 'vitest'
import { createVideoEditTestDocument } from './testFixtures'
import { defaultVideoEditTextStyle } from './text'
import { videoEditClipSchema, videoEditComposition } from './document'
import { mergeMotionClipCurves, motionClipBase, motionClipGeometry } from './motionDraft'
import { videoEditClipValue } from './keyframes'

const clip = () => videoEditClipSchema.parse({ id: 'clip', itemId: 'item', name: '标题', kind: 'text', text: '标题', textStyle: defaultVideoEditTextStyle(1080), start: 10, duration: 100, track: 1, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, curves: { x: [{ time: 0, value: 0, interpolation: 'bezier', bezier: [.2, 1.5, .7, -.3] }, { time: 99, value: 1, interpolation: 'linear' }] } })
it('只替换候选涉及的范围和属性，外部普通贝塞尔与原片段保持不变', () => {
  const before = clip(); const copy = structuredClone(before)
  const next = mergeMotionClipCurves(before, [{ takeId: 'take', range: [30, 60], keyCount: 2, maxErrors: {}, curves: { x: [{ time: 30, value: .5, interpolation: 'ease' }, { time: 60, value: .7, interpolation: 'linear' }] } }])
  for (let frame = 0; frame <= 99; frame += .25) if (frame <= 29 || frame >= 61) expect(videoEditClipValue(next, 'x', frame + before.start)).toBeCloseTo(videoEditClipValue(before, 'x', frame + before.start), 8)
  expect(next.curves?.y).toBeUndefined(); expect(next.scale).toBe(before.scale); expect(before).toEqual(copy)
  const document = createVideoEditTestDocument('超级关键帧'); expect(document.version).toBe(VIDEO_EDIT_DOCUMENT_VERSION)
})
it('源画幅改变使示范几何失效，文件重定位保持相同几何', () => {
  const document = createVideoEditTestDocument('几何')
  document.media = [{ id: 'source', name: '画面', kind: 'image', path: 'D:/source.jpg', durationSeconds: 0, width: 1280, height: 720 }]
  document.items = [{ id: 'item', name: '画面', kind: 'image', mediaId: 'source' }]
  const target = { ...clip(), kind: 'image' as const }
  const geometry = () => motionClipGeometry(videoEditComposition(document, document.sequences[0].id), target)
  const before = geometry(); document.media[0].path = 'D:/moved/source.jpg'; expect(geometry()).toEqual(before)
  document.media[0].width = 720; document.media[0].height = 1280; expect(geometry()).not.toEqual(before)
})
it('越界和重叠拒绝整次应用；素材路径重定位不改变运动基底', () => {
  const before = clip(); const motion = { takeId: 'take', range: [30, 60] as [number, number], keyCount: 2, maxErrors: {}, curves: { x: [{ time: 30, value: .5, interpolation: 'linear' as const }, { time: 60, value: .7, interpolation: 'linear' as const }] } }
  expect(() => mergeMotionClipCurves(before, [motion, motion])).toThrow('同一时间')
  expect(() => mergeMotionClipCurves(before, [{ ...motion, range: [30, 100] }])).toThrow('片段范围')
  expect(motionClipBase({ ...before, name: '旧名称' })).toEqual(motionClipBase({ ...before, name: '新名称' }))
})
