import { expect, it, vi } from 'vitest'
import { codeOutputInputs, codeOutputSignature, codeOutputObjectSignature } from './videoEditCodeOutputKey'
import type { VideoEditCodePlan } from './videoEditCodeSources'
import { createVideoEditSequence, type VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'

it('网页、序列、缺失与近似输入不生成复用键，视频样本与资产修订改变键', () => {
  const document: VideoEditComposition = { ...createVideoEditSequence(), fps: 30, revision: 0, items: [],
    media: [{ id: 'm', name: '输入', kind: 'video', path: '/movie.mp4', durationSeconds: 3, width: 64, height: 64, sourceRevision: 'first' }] }
  const plan: VideoEditCodePlan = { clip: { id: 'clip', itemId: 'item', name: '代码', kind: 'code', track: 1, start: 0, duration: 90, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' },
    key: 'output', static: false, parameters: {}, author: {}, transitionHandles: false,
    context: { width: 64, height: 64, time: 0, localTime: 0, sequenceTime: 0, frame: 0, fps: 30 },
    imageKeys: new Map([['picture', 'input']]), inputParameters: {} }
  const input = { width: 64, height: 64, premultiplied: true } as VideoEditCodeImageInput
  const inputs = new Map([['input', input]])
  const read = (frame = 0) => codeOutputInputs(document, plan, frame, inputs, () => true)
  for (const reference of [{ kind: 'web', path: '/web/index.html' }, { kind: 'sequence', mediaId: 'below' }]) {
    plan.inputParameters = { picture: reference } as VideoEditCodePlan['inputParameters']
    expect(read()).toBeUndefined()
  }
  plan.inputParameters = { picture: { kind: 'video', mediaId: 'm' } }
  const first = read()
  expect(first?.picture).toBeDefined()
  expect(read(1)).not.toEqual(first)
  document.media[0] = { ...document.media[0], sourceRevision: 'second' }
  expect(read()).not.toEqual(first)
  expect(codeOutputInputs(document, plan, 0, inputs, () => false)).toBeUndefined()
  expect(codeOutputInputs(document, plan, 0, undefined, () => true)).toBeUndefined()
  expect(codeOutputSignature({ a: 1, b: [2, 3] })).toBe(codeOutputSignature({ b: [2, 3], a: 1 }))
})

it('相同不可变子树只推导一次，替换快照才重新遍历', () => {
  const read = vi.fn(() => [1, 2, 3]), audio = { get levels() { return read() } }
  const first = codeOutputObjectSignature({ audio })
  expect(codeOutputObjectSignature({ audio })).toBe(first)
  expect(read).toHaveBeenCalledOnce()
  expect(codeOutputObjectSignature({ audio: { levels: [1, 2, 4] } })).not.toBe(first)
})

it('模拟按历史推进：当前帧参数与声明键都不变时，模拟身份变化也改变输出复用键', async () => {
  const { codeOutputKey } = await import('./videoEditCodeOutputKey')
  const document: VideoEditComposition = { ...createVideoEditSequence(), fps: 30, revision: 0, items: [], media: [] }
  const clip = { id: 'clip', itemId: 'item', name: '模拟', kind: 'code', track: 1, start: 0, duration: 90, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } as unknown as VideoEditCodePlan['clip']
  const plan = (identity: string) => ({
    clip, key: 'output', static: false, parameters: { amount: .5 }, author: {}, transitionHandles: false, inputParameters: {}, imageKeys: new Map(),
    program: { mode: 'dynamic', parameters: [], frames: [] }, outputIdentity: 'source',
    context: { width: 64, height: 64, time: 2, localTime: 2, sequenceTime: 2, frame: 60, fps: 30 },
    outputFrame: { sourceTime: { sourceInUs: 2_000_000 }, overrides: undefined, info: { frameDuration: 1 / 30, clip: { duration: 3 } }, environment: {} },
    simulation: { identity },
  }) as unknown as VideoEditCodePlan
  const declared = { digest: 'same-frame-key' } as Parameters<typeof codeOutputKey>[3]
  expect(codeOutputKey(document, plan('early-a'), {}, declared)).toBe(codeOutputKey(document, plan('early-a'), {}, declared))
  expect(codeOutputKey(document, plan('early-b'), {}, declared)).not.toBe(codeOutputKey(document, plan('early-a'), {}, declared))
})
