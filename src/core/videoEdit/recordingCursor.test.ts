import { describe, expect, it } from 'vitest'
import { sampleRecordingCursor, recordingCursorSourceSchema, assertRecordingCursorPage } from './recordingCursor'
import { recordingCursorFixture } from '../../tests/recordingCursorFixture'
import type { CaptureEvent } from '../captureLog/events'
import { splitVideoEditClipSource, videoEditClipSourceTimeAt } from './clipSpeed'
import { videoEditSourceSeconds } from './time'

const options = { smoothing: 0, hideAfterSeconds: 0, cursorBakedIn: false }
describe('录制光标源时钟与轨迹', () => {
  it('120Hz 插值、平滑随机访问和点击下沿时序精确；烤入路径只留点击', async () => {
    const { pages } = await recordingCursorFixture(); const events = pages.flatMap(p => p.entries)
    const sample = (time: number, smoothing = 0) => sampleRecordingCursor(events, time, { ...options, smoothing })
    expect(sample(1_004_000).cursor!.point[0]).toBeCloseTo(200.4, 5)
    expect(sample(1_000_000, 100).cursor!.point).toEqual([200, 300])
    expect(sample(999_999).clicks).toHaveLength(0)
    expect(sample(1_000_000).clicks[0].progress).toBe(0)
    expect(sample(1_250_000).clicks).toEqual([{ point: [200, 300], button: 'left', progress: 0.5 }])
    expect(sample(1_500_000).clicks).toHaveLength(0)
    const before = sample(2_323_123, 70)
    sample(3_200_000, 70); sample(0, 70)
    expect(sample(2_323_123, 70)).toEqual(before)
    const baked = sampleRecordingCursor(events, 1_250_000, { ...options, cursorBakedIn: true })
    expect(baked.cursor).toBeUndefined(); expect(baked.clicks).toHaveLength(1)
  })
  it('隐藏、采样中断和暂停边界不桥接；静止后隐藏，移动后恢复', async () => {
    const { pages } = await recordingCursorFixture(); const events = pages.flatMap(p => p.entries)
    const still = events.map((e): CaptureEvent => e.kind === 'cursor' ? { ...e, point: [100, 100] } : e).filter(e => e.kind !== 'click')
    expect(sampleRecordingCursor(still, 2_000_000, { ...options, hideAfterSeconds: 1 }).cursor).toBeUndefined()
    const cursor = events.find(e => e.kind === 'cursor')!
    const boundary: CaptureEvent[] = [{ ...cursor, recordingUs: 0, kind: 'cursor', point: [0, 0], shape: 'arrow' }, { ...cursor, recordingUs: 50_000, kind: 'cursor', point: null, shape: 'hidden' }, { ...cursor, recordingUs: 100_000, kind: 'cursor', point: [500, 0], shape: 'hand' }]
    expect(sampleRecordingCursor(boundary, 25_000, { ...options, smoothing: 100 }).cursor!.point[0]).toBe(0)
    expect(sampleRecordingCursor(boundary, 75_000, options).cursor).toBeUndefined()
    expect(sampleRecordingCursor(boundary, 100_000, { ...options, smoothing: 100 }).cursor!.point[0]).toBe(500)
    expect(sampleRecordingCursor(boundary, 210_000, options).cursor).toBeUndefined()
    const resumed: CaptureEvent[] = [boundary[0], { ...cursor, kind: 'control', action: 'resume', recordingUs: 10_000, clockSegmentRef: 'resume' }, { ...boundary[2], recordingUs: 20_000, clockSegmentRef: 'resume' }]
    expect(sampleRecordingCursor(resumed, 15_000, options).cursor).toBeUndefined()
    expect(sampleRecordingCursor(resumed, 20_000, { ...options, smoothing: 100 }).cursor!.point).toEqual([500, 0])
  })
  it('剪切、移动、2倍速、倒放使用同一源时间，不修改事件', async () => {
    const events = (await recordingCursorFixture()).pages.flatMap(p => p.entries)
    const rate = { numerator: 60, denominator: 1 }
    const clip = { start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, speed: { numerator: 2, denominator: 1 } }
    const read = (value: typeof clip & { reverse?: boolean }, at: number) => sampleRecordingCursor(events, videoEditSourceSeconds(videoEditClipSourceTimeAt(value, at - value.start, rate)) * 1e6, options)
    const split = splitVideoEditClipSource(clip, 30, rate)
    expect(read({ ...clip, ...split, start: 200, duration: 90 }, 200)).toEqual(read(clip, 30))
    expect(read({ ...clip, start: 100 }, 130).clicks).toHaveLength(1)
    expect(read({ ...clip, sourceInUs: 2_000_000, reverse: true }, 29)).toEqual(read(clip, 30))
  })
  it('拒绝交叉页、替换归属和不合法哈希', async () => {
    const { source, pages } = await recordingCursorFixture()
    expect(recordingCursorSourceSchema.parse(source)).toEqual(source)
    expect(() => assertRecordingCursorPage({ ...pages[0], ownerRef: { kind: 'recording_session', id: 'other' } }, source.pages[0], source)).toThrow('归属')
    expect(recordingCursorSourceSchema.safeParse({ ...source, pages: [source.pages[1], source.pages[0]] }).success).toBe(false)
  })
})
