import { expect, it } from 'vitest'
import { annotationContains, assertAnnotationsCurrent, type IntentAnnotation } from './annotationConstraints'
import { assertCandidateCurrent, motionCandidateIdentity, optimizeMotionDraft } from './candidates'
import { createMotionFixture } from './fixtures/motionFixtures'
import { evaluateVideoEditKeyframes } from '../videoEdit/keyframes'

function fixture(): ReturnType<typeof createMotionFixture>['input'] {
  const { input } = createMotionFixture('S01'); input.intent = undefined; input.draft.pins = []
  input.samples = [input.samples[0], input.samples.at(-1)!]
  return input
}
function mark(input: ReturnType<typeof fixture>): IntentAnnotation {
  return { sourceRef: { kind: 'video_edit.annotation', id: 'p:a' }, sourceIdentity: 'a1', geometryIdentity: 'g1', targetRefs: [input.draft.targets[0].ref], span: [0, 120], text: '沿箭头', geometry: { kind: 'path', points: [[.2, .2], [.8, .7]] } }
}
it('箭头方向进入正式曲线，原始采样不变，候选身份含标注版本', () => {
  const input = fixture(); input.annotations = [mark(input)]; const before = JSON.stringify(input)
  const result = optimizeMotionDraft(input); const candidate = result.candidates.find(c => c.id === 'constrained')!
  expect(candidate, JSON.stringify(result.unavailable)).toBeDefined()
  for (let frame = 0; frame <= 120; frame += .25) {
    expect(evaluateVideoEditKeyframes(candidate.motions[0].curves.x, frame, 0)).toBeCloseTo(.2 + .6 * frame / 120, 4)
    expect(evaluateVideoEditKeyframes(candidate.motions[0].curves.y, frame, 0)).toBeCloseTo(.2 + .5 * frame / 120, 4)
  }
  expect(JSON.stringify(input)).toBe(before)
  input.annotations = [{ ...input.annotations[0], sourceIdentity: 'a2' }]
  expect(() => assertCandidateCurrent(candidate, motionCandidateIdentity(input.draft, input))).toThrow('已变化')
})
it('圈的停留仅在指定跨帧区间生效，进出路径保留且钉点冲突拒绝', () => {
  const input = fixture(); input.annotations = [{ ...mark(input), span: [40, 80], geometry: { kind: 'region', role: 'dwell', outline: [[.4, .3], [.6, .3], [.6, .5], [.4, .5]] } }]
  const result = optimizeMotionDraft(input); const motion = result.candidates.find(c => c.id === 'constrained')!.motions[0]
  for (let f = 40; f <= 80; f += .25) expect(evaluateVideoEditKeyframes(motion.curves.y, f, 0)).toBeCloseTo(.4, 6)
  expect(evaluateVideoEditKeyframes(motion.curves.x, 0, 0)).toBe(.15)
  input.draft.pins = [{ id: 'pin', sampleId: input.samples[0].sampleId, targetRef: input.draft.targets[0].ref, properties: ['position'], timeLocked: true, valueLocked: true }]
  input.annotations = [mark(input)]
  expect(optimizeMotionDraft(input).unavailable.some(u => u.family === 'constrained' && u.code === 'intent-pin-conflict')).toBe(true)
})
it('单帧箭头、相互冲突标注、删除及几何变化均不静默执行；文本不当动作', () => {
  const input = fixture(); const a = mark(input)
  input.annotations = [{ ...a, span: [20, 20] }]
  expect(optimizeMotionDraft(input).unavailable.some(u => u.code === 'annotation-time')).toBe(true)
  input.annotations = [a, { ...a, sourceRef: { ...a.sourceRef, id: 'b' }, geometry: { kind: 'path', points: [[.9, .1], [.1, .9]] } }]
  expect(optimizeMotionDraft(input).unavailable.some(u => u.code === 'annotation-conflict')).toBe(true)
  expect(() => assertAnnotationsCurrent([a], [])).toThrow('已删除')
  expect(() => assertAnnotationsCurrent([a], [{ ...a, geometryIdentity: 'g2' }])).toThrow('画幅')
  input.annotations = [{ ...a, geometry: { kind: 'text', at: [.2, .2] } }]
  expect(optimizeMotionDraft(input).candidates.some(c => c.id === 'constrained')).toBe(false)
})
it('圈内多个目标全部保留，边缘算命中，圈外不误选', () => {
  const outline: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  expect([[.2, .2], [.8, .8], [0, .5], [1.2, .5]].map(p => annotationContains(outline, [p[0], p[1]]))).toEqual([true, true, true, false])
})
