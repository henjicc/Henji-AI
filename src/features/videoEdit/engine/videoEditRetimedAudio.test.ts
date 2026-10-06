import { beforeAll, expect, it, vi } from 'vitest'
import { createVideoEditDocument, videoEditComposition, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditRenderer } from './videoEditRenderer'
import type { VideoEditFrameBackend } from './videoEditFrameSource'
import { createVideoEditNativeClipAudio, type VideoEditPcmSession } from './videoEditNativeAudio'
import { videoEditResampleAt, videoEditResampleKernel } from './videoEditRetimedAudio'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
beforeAll(() => { (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope ??= class {} })

const RATE = 48000
/** 源：左声道 220 Hz 正弦、右声道伪随机噪声（任何一个样本错位都会改变结果）。 */
const signal = (channel: number, sample: number): number => channel === 0 ? Math.fround(.5 * Math.sin(2 * Math.PI * 220 * sample / RATE)) : Math.fround(((sample * 7919) % 1000) / 1000 * .2 - .1)
function backend(): VideoEditFrameBackend {
  const session = (): VideoEditPcmSession => ({ sampleRate: RATE, channels: 2, close: () => {}, async read(first: number, frames: number) { return [0, 1].map(channel => Float32Array.from({ length: frames }, (_, index) => signal(channel, first + index))) } })
  return {
    open(media) { return { key: media.path, ready: Promise.resolve({ clipFrames: () => undefined, clipAudio: () => createVideoEditNativeClipAudio(async () => session()), async *schedule() {} }) } },
    release() {},
    seeker() { throw new Error('声音测试不定位画面。') },
  }
}
/** 30fps 序列上第 15 帧起、源入点 2 秒、长 60 帧的声音片段（源素材 10 秒）。 */
function sound(clip: Partial<VideoEditClip> = {}): VideoEditComposition {
  const document = createVideoEditDocument('变速声音')
  document.media = [{ id: 'm', name: '对白', path: 'D:/dialog.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 10, hasAudio: true }]
  document.items = [{ id: 'i', name: '对白', kind: 'audio', mediaId: 'm' }]
  const track = document.sequences[0].tracks.find(value => value.kind === 'audio')!.index
  document.sequences[0].clips = [{ id: 'c', itemId: 'i', name: '对白', kind: 'audio', track, start: 15, duration: 60, sourceInUs: 2_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '', ...clip }]
  return videoEditComposition(document, document.sequences[0].id)
}
async function mix(composition: VideoEditComposition, blocks: number[], start = 0): Promise<Float32Array[]> {
  const renderer = new VideoEditRenderer(composition, undefined, { width: 1, height: 1 } as unknown as OffscreenCanvas, 8 * 1024 ** 3, backend())
  try {
    const parts: Float32Array[][] = []; let at = start
    for (const duration of blocks) { parts.push(await renderer.mixAudio(at, duration)); at += duration }
    return [0, 1].map(channel => { const joined = new Float32Array(parts.reduce((sum, part) => sum + part[channel].length, 0)); let offset = 0; for (const part of parts) { joined.set(part[channel], offset); offset += part[channel].length } return joined })
  } finally { await renderer.dispose() }
}
/** 第一个不相同的样本（-1 为全部相同）；不用 toEqual，免得失败时打印几十万个样本。 */
function firstDifference(left: Float32Array, right: Float32Array): number {
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return index
  return -1
}
/** 一段样本里过零点（上升沿）个数，估算基频。 */
function risingZeros(values: Float32Array, from: number, to: number): number {
  let count = 0
  for (let index = from + 1; index < to; index++) if (values[index - 1] < 0 && values[index] >= 0) count++
  return count
}

it('插值核：速度 100% 落在整数样本上就是原样本；加速时降低截止', () => {
  const plane = Float32Array.from({ length: 64 }, (_, index) => Math.sin(index))
  const { cutoff, halfWidth } = videoEditResampleKernel(1)
  expect(cutoff).toBe(1)
  for (const index of [10, 20, 33]) expect(videoEditResampleAt(plane, index, 0, cutoff, halfWidth)).toBeCloseTo(plane[index], 6)
  expect(videoEditResampleAt(plane, 10, .5, cutoff, halfWidth)).toBeCloseTo(Math.sin(10.5), 2)
  expect(videoEditResampleKernel(2).cutoff).toBe(.5)
  expect(videoEditResampleKernel(100).halfWidth).toBe(32)
})

it('倒放 100%：每个输出样本正好是源里倒着数的那一个样本（片段 0.5–2.5 秒，开头即源 4 秒）', async () => {
  const [left, right] = await mix(sound({ sourceInUs: 4_000_000, reverse: true }), [1, 1, 1])
  for (const sample of [RATE * .5 + 1, RATE, RATE * 2 + 17]) {
    const source = 4 * RATE - (sample - RATE * .5)
    expect(left[sample]).toBeCloseTo(signal(0, source), 5); expect(right[sample]).toBeCloseTo(signal(1, source), 5)
  }
  expect(left[RATE * .25]).toBe(0)
})

it('200% 不保持音调：音调升高一倍；保持音调：音调不变、时长减半', async () => {
  const fast = await mix(sound({ speed: { numerator: 2, denominator: 1 } }), [1, 1])
  // 片段 0.5–1.5 秒（60 帧 × 2 倍速 = 2 秒源）。正弦按位置取：n 处是源 2 + 2·(n/RATE - .5) 秒。
  for (const sample of [RATE * .75, RATE + 101]) expect(fast[0][sample]).toBeCloseTo(signal(0, (2 + 2 * (sample / RATE - .5)) * RATE), 3)
  expect(risingZeros(fast[0], RATE * .6, RATE * 1.4)).toBeGreaterThanOrEqual(350)
  const kept = await mix(sound({ speed: { numerator: 2, denominator: 1 }, preservePitch: true }), [1, 1])
  const zeros = risingZeros(kept[0], RATE * .7, RATE * 1.3)
  expect(zeros).toBeGreaterThan(120); expect(zeros).toBeLessThan(145) // 0.6 秒 × 220 Hz ≈ 132
})

it('预览（0.5 秒块）与导出（按帧的块）逐样本一致：变速、倒放、保持音调都与分块方式无关', async () => {
  for (const clip of [{ speed: { numerator: 3, denominator: 2 } }, { speed: { numerator: 1, denominator: 2 }, sourceInUs: 5_000_000, reverse: true as const }, { speed: { numerator: 2, denominator: 1 }, preservePitch: true as const }]) {
    const composition = sound(clip)
    const preview = await mix(composition, [.5, .5, .5, .5, .5, .5])
    const exported = await mix(composition, Array.from({ length: 90 }, () => 1 / 30))
    expect(exported[0].length).toBe(preview[0].length)
    for (const channel of [0, 1]) expect(firstDifference(exported[channel], preview[channel]), JSON.stringify(clip)).toBe(-1)
  }
})
