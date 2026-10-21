import { describe, expect, it } from 'vitest'
import type { CaptureEvent } from '../captureLog/events'
import { recordingCursorPointAt, recordingForegroundWindowAt, recordingTrackBox, recordingWindowBoundsAt } from './recordingTracks'

const base = { monoUs: 0, clockSegmentRef: 'seg', seq: 0 }
let id = 0
const cursor = (recordingUs: number, point: [number, number] | null, shape: 'arrow' | 'hidden' = 'arrow'): CaptureEvent => ({ ...base, eventId: `e${id++}`, recordingUs, kind: 'cursor', point, shape } as CaptureEvent)
const window = (recordingUs: number, windowId: string | null, bounds: { x: number; y: number; width: number; height: number } | null, available = true): CaptureEvent => ({ ...base, eventId: `e${id++}`, recordingUs, kind: 'window', windowId, bounds, available } as CaptureEvent)
const frame = { width: 1920, height: 1080 }

describe('录屏事件跟踪', () => {
  it('光标：相邻采样之间线性插值，隐藏或超过前瞻时为空', () => {
    const events = [cursor(0, [100, 100]), cursor(8000, [180, 140]), cursor(16000, null, 'hidden')]
    expect(recordingCursorPointAt(events, 4000)).toEqual([140, 120])
    expect(recordingCursorPointAt(events, 20000)).toBeNull()
    expect(recordingCursorPointAt([cursor(0, [10, 10])], 500_000)).toBeNull()
  })

  it('光标框：以光标为中心、边长为特征框（占画面高度）', () => {
    const box = recordingTrackBox({ kind: 'cursor' }, { window: { feature: 0.1, search: 0.2 } }, frame, { cursor: [960, 540] })!
    expect(box[3]).toBeCloseTo(0.1, 9); expect(box[2]).toBeCloseTo(0.1 * 1080 / 1920, 9)
    expect(box[0] + box[2] / 2).toBeCloseTo(0.5, 9); expect(box[1] + box[3] / 2).toBeCloseTo(0.5, 9)
    expect(recordingTrackBox({ kind: 'cursor' }, {}, frame, { cursor: null })).toBeNull()
  })

  it('窗口：指定窗口不在前台时沿用最近边界；前台跟踪取当时的前台窗口', () => {
    const events = [window(0, 'a', { x: 100, y: 100, width: 800, height: 600 }), window(1000, 'b', { x: 0, y: 0, width: 400, height: 300 }), window(2000, 'a', { x: 300, y: 200, width: 1600, height: 600 })]
    expect(recordingWindowBoundsAt(events, 1500, 'a')).toEqual({ x: 100, y: 100, width: 800, height: 600 })
    expect(recordingWindowBoundsAt(events, 1500, null)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(recordingForegroundWindowAt(events, 2500)).toEqual({ windowId: 'a', bounds: { x: 300, y: 200, width: 1600, height: 600 } })
    expect(recordingForegroundWindowAt([window(0, null, null, false)], 10)).toBeNull()
  })

  it('窗口区域：随窗口移动与缩放', () => {
    const reference = { x: 100, y: 100, width: 800, height: 600 }
    const moved = { x: 300, y: 200, width: 1600, height: 600 }
    // 提示时窗口里左上 200×100 像素的区域。
    const region: [number, number, number, number] = [100 / 1920, 100 / 1080, 200 / 1920, 100 / 1080]
    const box = recordingTrackBox({ kind: 'window', windowId: 'a' }, { box: region }, frame, { window: moved, reference })!
    expect(box[0] * 1920).toBeCloseTo(300, 6); expect(box[1] * 1080).toBeCloseTo(200, 6)
    expect(box[2] * 1920).toBeCloseTo(400, 6); expect(box[3] * 1080).toBeCloseTo(100, 6)
    // 不给区域时就是整个窗口。
    expect(recordingTrackBox({ kind: 'window', windowId: 'a' }, {}, frame, { window: moved, reference })!.slice(0, 4).map((v, i) => v * (i % 2 ? 1080 : 1920))).toEqual([300, 200, 1600, 600])
  })
})
