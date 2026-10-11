import { expect, it } from 'vitest'
import { relativeMotionEvaluator, type ReferenceTransformTrack } from './referenceTransforms'
import { createMotionFixture } from './fixtures/motionFixtures'
import { prepareMotionTakes } from './sampling'
import { compileMotionTake } from './motionCompiler'
import { evaluateVideoEditKeyframes } from '../videoEdit/keyframes'

it('S12 参照移动旋转后保持局部偏移，正式曲线四分之一帧误差小于短边0.1%', () => {
  const { input } = createMotionFixture('S01'); input.draft.pins = []; input.samples = [input.samples[0], input.samples.at(-1)!]
  input.samples.forEach(s => { s.pose.position = [.55, .52] })
  const take = prepareMotionTakes(input.draft, input.samples)[0]
  const ref = { kind: 'video_edit.clip', id: 'other' }
  const recorded: ReferenceTransformTrack = { ref, identity: 'old', samples: [0, 120].map(frame => ({ frame, matrix: [1, 0, 0, 1, .5, .5] })) }
  const current: ReferenceTransformTrack = { ref, identity: 'new', samples: Array.from({ length: 481 }, (_, i) => {
    const frame = i / 4; const theta = frame / 120 * Math.PI / 6
    return { frame, matrix: [Math.cos(theta), Math.sin(theta), -Math.sin(theta), Math.cos(theta), .5 + .1 * frame / 120, .5] }
  }) }
  const evaluatePose = relativeMotionEvaluator(take, { targetRef: take.target.ref, recorded, current, mode: 'local' })
  const result = compileMotionTake(take, input.mappings[take.takeId], { fidelity: .5, evaluatePose })
  for (let f = 0; f <= 120; f += .25) {
    const theta = f / 120 * Math.PI / 6
    const expected = [.5 + .1 * f / 120 + .05 * Math.cos(theta) - .02 * Math.sin(theta), .5 + .05 * Math.sin(theta) + .02 * Math.cos(theta)]
    const error = Math.hypot(evaluateVideoEditKeyframes(result.curves.x, f, 0) - expected[0], evaluateVideoEditKeyframes(result.curves.y, f, 0) - expected[1])
    expect(error).toBeLessThan(.0005)
  }
  expect(result.keyCount).toBeLessThanOrEqual(12)
  const world = relativeMotionEvaluator(take, { targetRef: take.target.ref, recorded, current, mode: 'composition' })
  expect(world(120).position).toEqual([.65, .52])
})
it('参照奇异、缺帧、自身/引用环和换参照均拒绝', () => {
  const { input } = createMotionFixture('S01'); const take = prepareMotionTakes(input.draft, input.samples)[0]
  const track: ReferenceTransformTrack = { ref: { kind: 'video_edit.clip', id: 'other' }, identity: 'g', samples: [{ frame: 0, matrix: [1, 0, 0, 1, 0, 0] }] }
  const request = { targetRef: take.target.ref, recorded: track, current: track, mode: 'local' as const }
  expect(() => relativeMotionEvaluator(take, request)).toThrow('缺少')
  expect(() => relativeMotionEvaluator(take, { ...request, targetRef: track.ref })).toThrow('自身')
  expect(() => relativeMotionEvaluator(take, { ...request, current: { ...track, samples: [{ frame: 0, matrix: [0, 0, 0, 0, 0, 0] }] } })).toThrow('不可逆')
})
