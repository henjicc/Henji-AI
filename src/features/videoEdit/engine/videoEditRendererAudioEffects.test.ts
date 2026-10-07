import { beforeAll, expect, it, vi } from 'vitest'
import { createVideoEditDocument, videoEditComposition, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { normalizeVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { videoEditAudioTransitionGains } from '@/core/videoEdit/transitions'
import { VideoEditRenderer } from './videoEditRenderer'
import { evaluateVideoEditKeyframes } from '@/core/videoEdit/keyframes'
import { replaceVideoEditDuckingKeyframes, videoEditDuckingSettingsSchema } from '@/core/videoEdit/audioDucking'
import type { VideoEditFrameBackend } from './videoEditFrameSource'
import { createVideoEditNativeClipAudio, type VideoEditPcmSession } from './videoEditNativeAudio'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
beforeAll(() => { (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope ??= class {} })

const RATE = 48000
it('生成回避进入真实混音函数，淡化逐样本平滑且预览块与导出帧块完全一致', async () => {
  const composition = sound(); const clip = composition.clips[0]
  clip.curves = { volume: replaceVideoEditDuckingKeyframes(clip, [{ startSeconds: 1.5, endSeconds: 2 }], composition.fps, videoEditDuckingSettingsSchema.parse({ reductionDb: 20, fadeSeconds: .5 })) }
  const preview = await mix(composition, [.5, .5, .5, .5, .5, .5])
  const exported = await mix(composition, Array.from({ length: 90 }, () => 1 / 30))
  expect(exported).toEqual(preview)
  for (const sample of [RATE * 1.25, RATE * 1.25 + 1, RATE * 1.75, RATE * 2.25 + 13]) {
    const gain = evaluateVideoEditKeyframes(clip.curves.volume, sample / RATE * composition.fps - clip.start, clip.volume)
    expect(preview[0][sample]).toBeCloseTo(original(0, sample) * gain, 7)
  }
})
it('音量与内置增益关键帧按输出样本求值；预览块与导出帧块一致，静音基础值不会吞掉动画', async () => {
  const volume = [{ time: 0, value: 0, interpolation: 'linear' as const }, { time: 30, value: 1, interpolation: 'ease' as const }, { time: 60, value: .25, interpolation: 'hold' as const }]
  const composition = sound({ volume: 0, curves: { volume } })
  const preview = await mix(composition, [.5, .5, .5, .5])
  const exported = await mix(composition, Array.from({ length: 60 }, () => 1 / 30))
  expect(exported).toEqual(preview)
  for (const sample of [RATE / 2, RATE / 2 + 1, RATE / 2 + 37, RATE, RATE + 1, RATE * 1.75]) {
    const gain = evaluateVideoEditKeyframes(volume, sample / RATE * composition.fps - 15, 0)
    expect(preview[0][sample]).toBeCloseTo(original(0, sample) * gain, 7)
  }
  const effect = builtin('gain_balance')
  effect.builtin!.curves = { gain: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 30, value: 6, interpolation: 'linear' }] }
  const animated = sound({ effects: [effect] })
  const wetPreview = await mix(animated, [.5, .5, .5])
  const wetExport = await mix(animated, Array.from({ length: 45 }, () => 1 / 30))
  expect(wetExport).toEqual(wetPreview)
  const sample = RATE + 13
  expect(wetPreview[0][sample]).toBeCloseTo(original(0, sample) * 10 ** (6 * (sample / RATE - .5) / 20), 6)
})
/** 立体声源：左右声道是不同的确定信号（正弦加伪随机），任何一个样本错位都会改变结果。 */
const signal = (channel: number, sample: number): number => Math.fround(.3 * Math.sin(2 * Math.PI * (220 + channel * 110) * sample / RATE) + ((sample * 7919 + channel * 104729) % 1000) / 1000 * .05 - .025)
function backend(): VideoEditFrameBackend {
  const session = (): VideoEditPcmSession => ({ sampleRate: RATE, channels: 2, close: () => {}, async read(first: number, frames: number) { return [0, 1].map(channel => Float32Array.from({ length: frames }, (_, index) => signal(channel, first + index))) } })
  return {
    open(media) { return { key: media.path, ready: Promise.resolve({ clipFrames: () => undefined, clipAudio: () => createVideoEditNativeClipAudio(async () => session()), async *schedule() {} }) } },
    release() {},
    seeker() { throw new Error('声音测试不定位画面。') },
  }
}
const builtin = (builtinId: string, params: Record<string, unknown> = {}, amount = 1): VideoEditEffect => ({ id: `fx-${builtinId}`, name: builtinId, enabled: true, amount, builtin: { id: builtinId, params: normalizeVideoEditBuiltinParams(builtinId, params) } })
/** 30fps、48kHz 立体声序列上一段 4 秒的声音片段（第 15 帧起，源入点 0.5 秒）。 */
function sound(clip: Partial<VideoEditClip> = {}): VideoEditComposition {
  const document = createVideoEditDocument('音频效果')
  document.media = [{ id: 'm', name: '对白', path: 'D:/dialog.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 10, hasAudio: true }]
  document.items = [{ id: 'i', name: '对白', kind: 'audio', mediaId: 'm' }]
  const track = document.sequences[0].tracks.find(value => value.kind === 'audio')!.index
  document.sequences[0].clips = [{ id: 'c', itemId: 'i', name: '对白', kind: 'audio', track, start: 15, duration: 120, sourceInUs: 500_000, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', ...clip }]
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
/** 片段内序列样本 n 处的原声（第 15 帧起、源入点 0.5 秒）。 */
const original = (channel: number, sample: number): number => signal(channel, sample - 15 / 30 * RATE + .5 * RATE)

it('音频效果在混音里生效：片段音量在效果之前、淡化在效果之后；增益 +6.02 dB 逐样本为两倍', async () => {
  const [left, right] = await mix(sound({ volume: .5, effects: [builtin('gain_balance', { gain: 20 * Math.log10(2) })] }), [1, 1])
  for (const sample of [RATE * .5, RATE * .75 + 13, RATE * 1.9]) {
    expect(left[sample]).toBeCloseTo(original(0, sample), 5); expect(right[sample]).toBeCloseTo(original(1, sample), 5)
  }
  expect(left[RATE / 4]).toBe(0)
  // 限幅器在片段音量之后：音量推到 200% 峰值仍不超过最大电平；之后的淡出只会更轻。
  const limited = await mix(sound({ volume: 2, fadeOutFrames: 30, effects: [builtin('limiter', { ceiling: -6 })] }), [1, 1, 1, 1, .5])
  expect(Math.max(...limited[0].map(Math.abs))).toBeLessThanOrEqual(10 ** (-6 / 20) + 1e-6)
  expect(Math.max(...limited[0].subarray(Math.round(4.4 * RATE), Math.round(4.5 * RATE)).map(Math.abs))).toBeLessThan(.2)
})

it('连续播放时与分块方式无关：0.5 秒块（预览）与按帧长的块（导出）逐样本一致，效果链延迟已对齐', async () => {
  const effects = [builtin('noise_reduction', { strength: 50 }), builtin('parametric_eq', { preset: 'voice_clarity' }), builtin('pitch_shift', { semitones: -2 }), builtin('reverb'), builtin('limiter', { boost: 3 })]
  const composition = sound({ effects: effects.map((effect, index) => ({ ...effect, id: `fx-${index}` })) })
  const preview = await mix(composition, [.5, .5, .5, .5, .5, .5])
  const exported = await mix(composition, Array.from({ length: 90 }, () => 1 / 30))
  expect(exported[0].length).toBe(preview[0].length)
  expect(exported[0]).toEqual(preview[0]); expect(exported[1]).toEqual(preview[1])
  // 只有延迟的效果（音调 0 半音时为原声延迟 1536）：输出与原声逐样本对齐，没有错位。
  const delayed = await mix(sound({ effects: [builtin('pitch_shift')] }), [1, 1])
  for (const sample of [RATE, RATE + 1, RATE * 1.5]) expect(delayed[0][sample]).toBe(original(0, sample))
})

it('从中间定位开始播放：预读后与从头连续播放的结果几乎相同（滤波器与包络已稳定）', async () => {
  const composition = sound({ effects: [builtin('parametric_eq', { low: 6, high: -3 }), builtin('compressor')] })
  const continuous = await mix(composition, [.5, .5, .5, .5])
  const sought = await mix(composition, [.5], 1.5)
  let worst = 0
  for (let index = 0; index < sought[0].length; index++) worst = Math.max(worst, Math.abs(sought[0][index] - continuous[0][1.5 * RATE + index]))
  expect(worst).toBeLessThan(1e-3)
})

it('指数淡化的单侧过渡：出点前的增益按分贝线性下降，与过渡曲线一致', async () => {
  const composition = sound()
  composition.transitions = [{ id: 't', kind: 'exponential_fade', leftClipId: 'c', durationFrames: 30 }]
  const [left] = await mix(composition, [1, 1, 1, 1, .5])
  // 片段 15..135 帧（0.5–4.5 秒），出点前 30 帧（3.5–4.5 秒）淡出；4.0 秒处进度 1/2。
  const sample = 4 * RATE
  expect(left[sample]).toBeCloseTo(original(0, sample) * videoEditAudioTransitionGains('exponential_fade', .5)[0], 6)
  expect(left[3 * RATE]).toBe(original(0, 3 * RATE))
})
