import { describe, expect, it } from 'vitest'
import { advanceVideoEditClipSource, changeVideoEditClipSpeed, setVideoEditClipReverse, stretchVideoEditClip, videoEditClipContentShift, videoEditClipFrameAtSource, videoEditClipHeadRoom, videoEditClipSourceRange, videoEditClipSourceSecondsAt, videoEditClipSourceSecondsAtTime, videoEditClipSourceTimeAt, videoEditClipSpeedPercent, videoEditClipTailRoom, videoEditSpeedRatio, videoEditStretchDurationLimits, type VideoEditClipTiming } from './clipSpeed'
import { videoEditSourceSeconds } from './time'

const rate = { numerator: 30, denominator: 1 }
const clip = (fields: Partial<VideoEditClipTiming> = {}): VideoEditClipTiming => ({ start: 30, duration: 60, sourceInUs: 2_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, ...fields })
const double = videoEditSpeedRatio(2)

describe('片段速度换算（4.13）', () => {
  it('速度存为有理数，精度 0.01%，超出 1%–10000% 拒绝', () => {
    expect(videoEditSpeedRatio(2)).toEqual({ numerator: 2, denominator: 1 })
    expect(videoEditSpeedRatio(0.3333)).toEqual({ numerator: 3333, denominator: 10000 })
    expect(videoEditClipSpeedPercent(clip({ speed: videoEditSpeedRatio(1.255) }))).toBe(125.5)
    expect(() => videoEditSpeedRatio(0.005)).toThrow('1% 到 10000%')
    expect(() => videoEditSpeedRatio(101)).toThrow()
  })

  it('正放：第 k 帧显示源入点 + k·速度/fps，精确有理数与浮点一致', () => {
    const fast = clip({ speed: double })
    expect(videoEditSourceSeconds(videoEditClipSourceTimeAt(fast, 3, rate))).toBeCloseTo(2 + 6 / 30, 12)
    expect(videoEditClipSourceSecondsAt(fast, 33, 30)).toBeCloseTo(2.2, 12)
    expect(videoEditClipSourceRange(fast, 30)).toEqual({ from: 2, to: 6 })
    // 1/3 倍速经过 NTSC 帧率也不累计误差：三帧正好一帧源时长。
    const slow = clip({ speed: { numerator: 1, denominator: 3 } })
    expect(videoEditClipSourceTimeAt(slow, 3, { numerator: 30000, denominator: 1001 })).toEqual(advanceVideoEditClipSource(clip(), 1, { numerator: 30000, denominator: 1001 }))
  })

  it('倒放：源入点是开头那一刻，第 k 帧取覆盖区间的较早一端；声音随序列时间倒退', () => {
    const reversed = clip({ reverse: true, sourceInUs: 4_000_000 })
    expect(videoEditClipSourceRange(reversed, 30)).toEqual({ from: 2, to: 4 })
    expect(videoEditClipSourceSecondsAt(reversed, 30, 30)).toBeCloseTo(4 - 1 / 30, 12)
    expect(videoEditClipSourceSecondsAt(reversed, 89, 30)).toBeCloseTo(2, 12)
    expect(videoEditSourceSeconds(videoEditClipSourceTimeAt(reversed, 59, rate))).toBeCloseTo(2, 12)
    expect(videoEditClipSourceSecondsAtTime(reversed, 1, 30)).toBeCloseTo(4, 12)
    expect(videoEditClipSourceSecondsAtTime(reversed, 2.5, 30)).toBeCloseTo(2.5, 12)
    // 反向查找与取帧互逆。
    for (const frame of [30, 47, 89]) expect(videoEditClipFrameAtSource(reversed, videoEditClipSourceSecondsAt(reversed, frame, 30) + 1e-4, 30)).toBe(frame)
    expect(videoEditClipFrameAtSource(reversed, 4, 30)).toBeUndefined()
    expect(videoEditClipFrameAtSource(reversed, 1.9, 30)).toBeUndefined()
  })

  it('余量按速度换算：正放开头之前是更早的素材，倒放开头之前是更晚的素材', () => {
    const fast = clip({ speed: double })
    expect(videoEditClipHeadRoom(fast, 30, 10)).toBe(30) // 2 秒源 ÷ 2 倍速
    expect(videoEditClipTailRoom(fast, 30, 10)).toBe(60) // (10 - 6) 秒 ÷ 2
    const reversed = clip({ reverse: true, sourceInUs: 4_000_000, speed: double })
    expect(videoEditClipHeadRoom(reversed, 30, 10)).toBe(90) // (10 - 4) ÷ 2
    expect(videoEditClipTailRoom(reversed, 30, 10)).toBe(0) // 用到 0–4 秒，前面没有了
  })

  it('修剪入点与拆分沿播放方向前进；倒放修剪出点不改源入点', () => {
    const reversed = clip({ reverse: true, sourceInUs: 4_000_000 })
    expect(videoEditSourceSeconds(advanceVideoEditClipSource(reversed, 15, rate))).toBeCloseTo(3.5, 12)
    expect(videoEditSourceSeconds(advanceVideoEditClipSource(clip({ speed: double }), 15, rate))).toBeCloseTo(3, 12)
  })

  it('内容位移：改起点或源入点后标注跟着内容走', () => {
    const before = clip({ speed: double })
    const trimmed = { ...before, start: before.start + 10, duration: 50, ...advanceVideoEditClipSource(before, 10, rate) }
    expect(videoEditClipContentShift(before, trimmed, 30)).toBe(0)
    const moved = { ...before, start: 45 }
    expect(videoEditClipContentShift(before, moved, 30)).toBe(15)
    const reversed = clip({ reverse: true, sourceInUs: 4_000_000 })
    expect(videoEditClipContentShift(reversed, { ...reversed, start: 40, duration: 50, ...advanceVideoEditClipSource(reversed, 10, rate) }, 30)).toBe(0)
  })

  it('改速度：开头内容不动，时长按速度换算，受素材余量与后面空间限制', () => {
    const base = clip()
    expect(changeVideoEditClipSpeed(base, double, 30, { sourceDurationSeconds: 10 }).duration).toBe(30)
    expect(changeVideoEditClipSpeed(base, videoEditSpeedRatio(0.5), 30, { sourceDurationSeconds: 10 }).duration).toBe(120)
    // 素材只剩 8 秒：半速最多 480 帧以内，这里受 3 秒素材限制。
    expect(changeVideoEditClipSpeed(base, videoEditSpeedRatio(0.5), 30, { sourceDurationSeconds: 3.5 }).duration).toBe(90)
    expect(changeVideoEditClipSpeed(base, videoEditSpeedRatio(0.5), 30, { sourceDurationSeconds: 10, maxDuration: 70 }).duration).toBe(70)
    const normal = changeVideoEditClipSpeed(clip({ speed: double }), videoEditSpeedRatio(1), 30)
    expect(normal.speed).toBeUndefined(); expect(normal.duration).toBe(120)
  })

  it('比率拉伸：源范围不变，速度随时长变化，超出范围收紧', () => {
    const stretched = stretchVideoEditClip(clip(), 90)
    expect(stretched.speed).toEqual({ numerator: 2, denominator: 3 })
    expect(videoEditClipSourceRange(stretched, 30)).toEqual(videoEditClipSourceRange(clip(), 30))
    expect(videoEditStretchDurationLimits(clip())).toEqual({ min: 1, max: 6000 })
    expect(stretchVideoEditClip(clip(), 10_000).duration).toBe(6000)
    expect(stretchVideoEditClip(clip({ speed: { numerator: 3, denominator: 2 } }), 90).speed).toBeUndefined()
  })

  it('切换倒放：源范围不变，源入点换到另一端', () => {
    const reversed = setVideoEditClipReverse(clip({ speed: double }), true, rate)
    expect(reversed.reverse).toBe(true)
    expect(videoEditClipSourceRange(reversed, 30)).toEqual({ from: 2, to: 6 })
    const back = setVideoEditClipReverse(reversed, false, rate)
    expect(back.reverse).toBeUndefined(); expect(videoEditSourceSeconds(back)).toBeCloseTo(2, 12)
  })
})
