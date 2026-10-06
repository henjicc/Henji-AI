import { expect, it } from 'vitest'
import type { VideoEditClip } from './document'
import { invertVideoEditSilence, replaceVideoEditDuckingKeyframes, videoEditActivityThreshold, videoEditDuckingSettingsSchema } from './audioDucking'
import { claimVideoEditManualKeyframes, evaluateVideoEditKeyframes, isVideoEditDuckingKeyframe, rescaleVideoEditClipKeyframes, sliceVideoEditClipKeyframes } from './keyframes'

function music(patch: Partial<VideoEditClip> = {}): VideoEditClip {
  return { id: 'm', itemId: 'i', name: '音乐', kind: 'audio', track: 0, start: 30, duration: 300, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0.8, brightness: 1, text: '', audioRole: 'music', ...patch }
}
const settings = videoEditDuckingSettingsSchema.parse({ reductionDb: 20, fadeSeconds: 0.5 })
it('静音反向区间覆盖开头/末尾/全静音/全有声与重叠；敏感度越高门限越低', () => {
  expect(invertVideoEditSilence([{ startSeconds: 0, endSeconds: 1 }, { startSeconds: 3, endSeconds: 6 }], 5)).toEqual([{ startSeconds: 1, endSeconds: 3 }])
  expect(invertVideoEditSilence([], 5)).toEqual([{ startSeconds: 0, endSeconds: 5 }])
  expect(invertVideoEditSilence([{ startSeconds: 0, endSeconds: 5 }], 5)).toEqual([])
  expect(invertVideoEditSilence([{ startSeconds: 1, endSeconds: 3 }, { startSeconds: 2, endSeconds: 4 }], 5)).toEqual([{ startSeconds: 0, endSeconds: 1 }, { startSeconds: 4, endSeconds: 5 }])
  expect(videoEditActivityThreshold(100)).toBeLessThan(videoEditActivityThreshold(0))
})
it('序列秒数换算片内帧/dB/提前压低及恢复；裁剪、重叠与短气口合并', () => {
  const clip = music(); const points = replaceVideoEditDuckingKeyframes(clip, [{ startSeconds: 3, endSeconds: 4 }], 30, settings)
  expect(points.map(point => [point.time, point.value])).toEqual([[45, 0.8], [60, 0.08000000000000002], [90, 0.08000000000000002], [105, 0.8]])
  expect(points.every(point => point.source === 'ducking')).toBe(true)
  expect(replaceVideoEditDuckingKeyframes(clip, [{ startSeconds: 3, endSeconds: 4 }, { startSeconds: 4.1, endSeconds: 5 }], 30, settings).map(point => point.time)).toEqual([45, 60, 120, 135])
  const edge = replaceVideoEditDuckingKeyframes(clip, [{ startSeconds: 0, endSeconds: 30 }], 30, settings)
  expect(edge.map(point => point.time)).toEqual([0, 299])
  expect(replaceVideoEditDuckingKeyframes(music({ duration: 1 }), [{ startSeconds: 1, endSeconds: 2 }], 30, settings).map(point => point.time)).toEqual([0])
  expect(replaceVideoEditDuckingKeyframes(clip, [{ startSeconds: 50, endSeconds: 51 }], 30, settings)).toEqual([])
})
it('重新生成仅替换回避点，手动点原样保留且同帧优先；手动修改来源及修剪保留来源', () => {
  const manual = { time: 60, value: 0.6, interpolation: 'hold' as const }
  const old = { time: 50, value: 0.2, interpolation: 'linear' as const, source: 'ducking' as const }
  const clip = music({ curves: { volume: [old, manual] } })
  const next = replaceVideoEditDuckingKeyframes(clip, [{ startSeconds: 3, endSeconds: 4 }], 30, settings)
  expect(next.find(point => point.time === 60)).toEqual(manual); expect(next.some(point => point.time === 50)).toBe(false)
  expect(replaceVideoEditDuckingKeyframes({ ...clip, curves: { volume: next } }, [], 30, settings)).toEqual([manual])
  expect(claimVideoEditManualKeyframes([{ ...old, value: 0.3 }, manual], clip.curves?.volume)[0].source).toBeUndefined()
  expect(claimVideoEditManualKeyframes([old, manual], clip.curves?.volume)[0].source).toBe('ducking')
  const generated = replaceVideoEditDuckingKeyframes(music(), [{ startSeconds: 3, endSeconds: 4 }], 30, settings)
  const trimmed = sliceVideoEditClipKeyframes(music({ curves: { volume: generated } }), 70, 80)
  expect(trimmed.curves?.volume?.every(isVideoEditDuckingKeyframe)).toBe(true)
  expect(replaceVideoEditDuckingKeyframes(trimmed, [], 30, settings)).toEqual([])
  expect(rescaleVideoEditClipKeyframes(music({ curves: { volume: generated } }), time => time * 2, 600).curves?.volume?.every(isVideoEditDuckingKeyframe)).toBe(true)
})
it('音量按连续采样时刻求值，没有帧或音频块台阶；过密点整体拒绝', () => {
  const points = replaceVideoEditDuckingKeyframes(music(), [{ startSeconds: 3, endSeconds: 4 }], 30, settings)
  const a = evaluateVideoEditKeyframes(points, 52.5, 0); const b = evaluateVideoEditKeyframes(points, 52.5 + 30 / 48000, 0)
  expect(a).toBeCloseTo(0.44); expect(a - b).toBeCloseTo(0.72 / 15 * 30 / 48000, 12)
  const long = music({ start: 0, duration: 30000 })
  expect(() => replaceVideoEditDuckingKeyframes(long, Array.from({ length: 100 }, (_, index) => ({ startSeconds: index * 5 + 1, endSeconds: index * 5 + 2 })), 30, settings)).toThrow('过于密集')
})
