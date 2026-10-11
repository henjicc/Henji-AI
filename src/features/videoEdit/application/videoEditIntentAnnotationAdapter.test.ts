import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditAnnotationSchema } from '@/core/videoEdit/annotations'
import { referenceTransformEvaluator } from '@/core/creativeIntent/referenceTransforms'
import { captureVideoMotionReference, readVideoIntentAnnotation, sampleVideoMotionReference } from './videoEditIntentAnnotationAdapter'

function setup(): ReturnType<typeof videoEditComposition> {
  const project = createVideoEditDocument('test'); const sequence = createVideoEditSequence(); project.sequences.push(sequence)
  project.items.push({ id: 'item', name: '标题', kind: 'text' })
  sequence.clips.push(makeVideoEditItemClip(project, 'item', sequence.id, { frame: 30, duration: 120, track: 1 }))
  return videoEditComposition(project, sequence.id)
}
it('参照取正式序列时间，不重复叠加素材速度或倒放；不同片段起点及锚点', () => {
  const sequence = setup(); const clip = sequence.clips[0]
  clip.x = .1; clip.anchorX = .2; clip.curves = { x: [{ time: 0, value: .1, interpolation: 'linear' }, { time: 60, value: .3, interpolation: 'linear' }] }
  clip.reverse = true; clip.speed = { numerator: 2, denominator: 1 }
  const reference = captureVideoMotionReference(sequence, clip, 'local')
  const result = sampleVideoMotionReference('p', reference, [[30, 90]])
  const evaluate = referenceTransformEvaluator(result)
  expect(evaluate(30)[4]).toBeCloseTo(.4)
  expect(evaluate(90)[4]).toBeCloseTo(.6)
  expect(result.samples).toBeUndefined()
  expect(() => sampleVideoMotionReference('p', reference, [[29, 90]])).toThrow('未覆盖')
})
it('跨帧标注的文字和来源身份保留，错误目标与开放圈拒绝，读取不改状态', () => {
  const sequence = setup(); const clip = sequence.clips[0]
  const mark = videoEditAnnotationSchema.parse({ id: 'mark', clipId: clip.id, frame: 30, endFrame: 90, space: 'composition-normalized', target: { kind: 'stroke', strokes: [[{ x: .1, y: .2 }, { x: .7, y: .6 }]] }, text: '走到这里', status: 'open', author: { kind: 'user', name: '作者' }, createdAt: '2026-10-11T00:00:00.000Z', thread: [] })
  const before = JSON.stringify(mark); const evidence = readVideoIntentAnnotation('p', sequence, mark, clip.id, 'path')
  expect(evidence.span).toEqual([30, 90]); expect(evidence.text).toBe('走到这里'); expect(evidence.geometry).toEqual({ kind: 'path', points: [[.1, .2], [.7, .6]] })
  expect(JSON.stringify(mark)).toBe(before)
  expect(() => readVideoIntentAnnotation('p', sequence, mark, 'wrong', 'path')).toThrow('另一个')
  expect(() => readVideoIntentAnnotation('p', sequence, mark, clip.id, 'dwell')).toThrow('圈定')
})
