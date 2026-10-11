import { expect, it } from 'vitest'
import { nearestBeatFrame, snapMotionToBeats } from './beatSnap'
import type { CompiledMotion } from './motionCompiler'
import type { PreparedTake } from './sampling'
import { createMotionFixture } from './fixtures/motionFixtures'
import { assertCandidateCurrent, motionCandidateIdentity, optimizeMotionDraft } from './candidates'
const motion = (): CompiledMotion => ({ takeId: 'take', range: [0, 60], keyCount: 10, maxErrors: {}, curves: { x: [0, 17, 33, 46, 60].map(time => ({ time, value: time / 100, interpolation: 'linear' })), y: [0, 17, 33, 46, 60].map(time => ({ time, value: .3, interpolation: 'hold' })) } })
const take = (pins: number[] = []): PreparedTake => ({ takeId: 'take', target: {} as PreparedTake['target'], points: [], pins: pins.map(frame => ({ pin: {} as PreparedTake['pins'][number]['pin'], point: { frame, pose: {} as PreparedTake['points'][number]['pose'], sampleIds: [], hard: true } })) })
it('最近节拍二分选择，等距取较早帧', () => { expect(nearestBeatFrame(20, [10, 30])).toBe(10); expect(nearestBeatFrame(21, [10, 30])).toBe(30); expect(nearestBeatFrame(50, [10, 30])).toBe(30); expect(nearestBeatFrame(0, [])).toBeUndefined() })
it('时间轴节拍换成片段局部帧，钉点/端点优先，X/Y 同步且原稿不变', () => {
  const before = motion(), source = structuredClone(before)
  const result = snapMotionToBeats(before, take([133]), 100, [160, 145, 130, 115, 115])
  expect(result.curves.x!.map(p => p.time)).toEqual([0, 15, 33, 45, 60])
  expect(result.curves.y!.map(p => p.time)).toEqual([0, 15, 33, 45, 60])
  expect(result.curves.x!.map(p => p.value)).toEqual(before.curves.x!.map(p => p.value)); expect(before).toEqual(source)
})
it('节拍碰撞不丢姿态、不跨钉点，不越动作区间；空标记不改变候选', () => {
  const before = motion(), result = snapMotionToBeats(before, take([133]), 100, [50, 140, 200])
  expect(result.curves.x!.map(p => p.time)).toEqual([0, 17, 33, 40, 60])
  expect(snapMotionToBeats(before, take(), 100, [])).toBe(before)
})
it('正式整理吸附候选，节拍变化使候选过期，开关关闭还原原时间且原稿采样不变', () => {
  const fixture = createMotionFixture('S02', { fps: { numerator: 30, denominator: 1 } }), input = fixture.input, raw = structuredClone(input.samples)
  const plain = optimizeMotionDraft(input).candidates[0], snappedInput = { ...input, beatFrames: [0, 15, 30, 45, 60, 75, 90] }
  const snapped = optimizeMotionDraft(snappedInput).candidates[0]
  expect(snapped).toBeDefined(); expect(snapped.identity).toEqual(motionCandidateIdentity(input.draft, snappedInput))
  expect(() => assertCandidateCurrent(snapped, motionCandidateIdentity(input.draft, { ...snappedInput, beatFrames: [0, 16, 30] }))).toThrow('变化')
  expect(optimizeMotionDraft(input).candidates[0]).toEqual(plain); expect(input.samples).toEqual(raw)
})
