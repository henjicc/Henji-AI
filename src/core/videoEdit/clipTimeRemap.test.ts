import { describe, expect, it } from 'vitest'
import { advanceVideoEditClipSource, setVideoEditClipReverse, setVideoEditClipTimeRemap, stretchVideoEditClip, videoEditClipAudioMode, videoEditClipFrameAtSource, videoEditClipFrameBoundaryAtSource, videoEditClipHeadRoom, videoEditClipSourceAnchor, videoEditClipSourceRange, videoEditClipSourceSecondsAt, videoEditClipSourceSecondsAtTime, videoEditClipSourceSpanSeconds, videoEditClipSourceTimeAt, videoEditClipTailRoom, type VideoEditClipTiming } from './clipSpeed'
import { videoEditSourceSeconds, type VideoEditRatio } from './time'
import type { VideoEditTimeRemap } from './timeRemap'

const RATE: VideoEditRatio = { numerator: 60, denominator: 1 }
const FPS = 60
/** 慢放坡道：素材 0–2 秒 100%→25% 缓入，2–3 秒保持 25%，3–5 秒 25%→300% 线性。 */
const ramp: VideoEditTimeRemap = { points: [
  { offsetUs: 0, speed: 1, interpolation: 'ease' },
  { offsetUs: 2_000_000, speed: .25, interpolation: 'hold' },
  { offsetUs: 3_000_000, speed: .25, interpolation: 'linear' },
  { offsetUs: 5_000_000, speed: 3, interpolation: 'linear' },
] }
function clip(extra: Partial<VideoEditClipTiming> = {}): VideoEditClipTiming {
  const base: VideoEditClipTiming = { start: 120, duration: 300, sourceInUs: 10_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, ...extra }
  return setVideoEditClipTimeRemap(base, extra.timeRemap ?? ramp, FPS)
}

describe('片段速度曲线换算（clipSpeed.ts 唯一入口）', () => {
  it('设置曲线：用到的素材不变，时长按曲线积分', () => {
    const base: VideoEditClipTiming = { start: 0, duration: 300, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
    const curved = setVideoEditClipTimeRemap(base, ramp, FPS)
    expect(videoEditClipSourceSpanSeconds(curved, FPS)).toBeLessThanOrEqual(5); expect(videoEditClipSourceSpanSeconds(curved, FPS)).toBeGreaterThan(5 - 3 / FPS)
    // 0–2 秒缓动的平均倒数速度约 1.8；保持段 4 秒；线性段 2·ln(12)/2.75。
    expect(curved.duration).toBeGreaterThan(Math.round((4 + 2 * Math.log(12) / 2.75) * FPS))
    expect(curved.speed).toBeUndefined()
    // 移除曲线回到 100%：时长等于用到的素材长度（设曲线时结尾按整帧向下取，最多少一帧素材）。
    const plain = setVideoEditClipTimeRemap(curved, null, FPS).duration
    expect(plain).toBeLessThanOrEqual(300); expect(plain).toBeGreaterThanOrEqual(297)
  })
  it('画面、声音、匹配帧、边界换算单调且互为反函数', () => {
    const value = clip()
    let previous = -Infinity
    for (let frame = value.start; frame < value.start + value.duration; frame++) {
      const seconds = videoEditClipSourceSecondsAt(value, frame, FPS)
      expect(seconds).toBeGreaterThan(previous); previous = seconds
      expect(videoEditSourceSeconds(videoEditClipSourceTimeAt(value, frame - value.start, RATE))).toBeCloseTo(seconds, 6)
      expect(videoEditClipFrameAtSource(value, seconds + 1e-7, FPS)).toBe(frame)
      expect(videoEditClipFrameBoundaryAtSource(value, seconds, FPS)).toBeCloseTo(frame, 4)
      expect(videoEditClipSourceSecondsAtTime(value, frame / FPS, FPS)).toBeCloseTo(seconds, 9)
    }
    const range = videoEditClipSourceRange(value, FPS)
    expect(range.from).toBeCloseTo(10, 9)
    expect(videoEditClipSourceAnchor(value, FPS)).toBeCloseTo(value.start - 10 * FPS, 4)
  })
  it('拆分与修剪入点：右段开头的画面与原片段同一帧完全一致，曲线跟着素材走', () => {
    const value = clip()
    for (const at of [17, 151, 333]) {
      const head = advanceVideoEditClipSource(value, at, RATE)
      const right = { ...value, ...head, start: value.start + at, duration: value.duration - at }
      for (const offset of [0, 1, 40, right.duration - 1]) {
        expect(Math.abs(videoEditClipSourceSecondsAt(right, right.start + offset, FPS) - videoEditClipSourceSecondsAt(value, value.start + at + offset, FPS))).toBeLessThan(1e-4)
      }
    }
  })
  it('倒放：源范围不变，同一源位置的速度不变，时长不变', () => {
    const value = clip()
    const reversed = setVideoEditClipReverse(value, true, RATE)
    expect(reversed.duration).toBe(value.duration)
    const a = videoEditClipSourceRange(value, FPS); const b = videoEditClipSourceRange(reversed, FPS)
    expect(b.from).toBeCloseTo(a.from, 4); expect(b.to).toBeCloseTo(a.to, 4)
    // 倒放第 k 帧（区间较早端）= 正放第 duration-1-k 帧。
    for (const k of [0, 30, 200]) expect(Math.abs(videoEditClipSourceSecondsAt(reversed, reversed.start + k, FPS) - videoEditClipSourceSecondsAt(value, value.start + value.duration - 1 - k, FPS))).toBeLessThan(3e-4)
    const back = setVideoEditClipReverse(reversed, false, RATE)
    expect(Math.abs(videoEditSourceSeconds(back) - videoEditSourceSeconds(value))).toBeLessThan(1e-5)
  })
  it('比率拉伸：曲线整体缩放，源内容不变', () => {
    const value = clip()
    const stretched = stretchVideoEditClip(value, Math.round(value.duration / 2))
    expect(videoEditClipSourceSpanSeconds(stretched, FPS)).toBeCloseTo(videoEditClipSourceSpanSeconds(value, FPS), 2)
  })
  it('开头、结尾之外的余量按端点速度外延', () => {
    const value = clip()
    // 开头前 10 秒素材按 100% 速度：600 帧。
    expect(videoEditClipHeadRoom(value, FPS)).toBe(600)
    // 结尾之后剩下的素材按最后的 300%：素材 20 秒时还剩 5 秒 → 100 帧。
    expect(videoEditClipTailRoom(value, FPS, 20)).toBe(100)
  })
  it('声音：保持音调时曲线落在 25%–400% 内用拉伸器，否则降级为重采样', () => {
    expect(videoEditClipAudioMode({ ...clip(), preservePitch: true })).toBe('stretch')
    expect(videoEditClipAudioMode({ ...clip({ timeRemap: { points: [{ offsetUs: 0, speed: .1, interpolation: 'linear' }, { offsetUs: 1_000_000, speed: 1, interpolation: 'linear' }] } }), preservePitch: true })).toBe('resample')
    expect(videoEditClipAudioMode({ ...clip(), pitchSemitones: 3 })).toBe('stretch')
  })
})
