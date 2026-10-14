import { describe, expect, it } from 'vitest'
import type { CaptureEvent } from '../captureLog/events'
import { recordingCursorFixture } from '../../tests/recordingCursorFixture'
import { evaluateRecordingZoom, recordingZoomPointerFromEvents, recordingZoomPointerSpans, recordingZoomRegionFrames, recordingZoomRegionsSchema, recordingZoomSourceUsAtFrame, suggestRecordingZoomRegions, RECORDING_ZOOM_SCALES, type RecordingZoomRegion } from './recordingZoom'
import { splitVideoEditClipSource } from './clipSpeed'
import { videoEditBuiltinEffectInstanceSchema, videoEditEffectSchema } from './compositing'

const smooth = { connect: true, transition: 'smooth' as const }
const region = (startUs: number, endUs: number, extra: Partial<RecordingZoomRegion> = {}): RecordingZoomRegion => ({ id: `r${startUs}`, startUs, endUs, depth: 3, focus: { x: 0.5, y: 0.5 }, origin: 'manual', ...extra })
const none = (): null => null

describe('录屏自动缩放区间', () => {
  it('校验：结束晚于开始、不重叠、ID 不重复，只能挂在自动缩放效果上', () => {
    expect(recordingZoomRegionsSchema.safeParse([region(0, 1_000_000), region(1_000_000, 2_000_000)]).success).toBe(true)
    expect(recordingZoomRegionsSchema.safeParse([region(2_000_000, 1_000_000)]).success).toBe(false)
    expect(recordingZoomRegionsSchema.safeParse([region(1_500_000, 3_000_000), region(0, 2_000_000)]).success).toBe(false)
    expect(recordingZoomRegionsSchema.safeParse([region(0, 1), { ...region(5, 6), id: 'r0' }]).success).toBe(false)
    expect(recordingZoomRegionsSchema.safeParse([region(0, 1, { depth: 7 })]).success).toBe(false)
    expect(videoEditBuiltinEffectInstanceSchema.safeParse({ id: 'recording_zoom', params: {}, regions: [region(0, 1)] }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse({ id: 'e', name: '模糊', enabled: true, amount: 1, builtin: { id: 'mosaic', params: {}, regions: [region(0, 1)] } }).success).toBe(false)
  })
  it('区间内保持放大，区间外过渡在区间之外完成，视野始终在画面内', () => {
    const regions = [region(2_000_000, 4_000_000, { depth: 4, focus: { x: 0.95, y: 0.05 } })]
    const at = (us: number) => evaluateRecordingZoom(regions, us, smooth, none)
    expect(at(0)).toEqual({ scale: 1, centerX: 0.5, centerY: 0.5 })
    expect(at(800_000)).toEqual({ scale: 1, centerX: 0.5, centerY: 0.5 })
    const held = at(3_000_000)
    expect(held.scale).toBe(RECORDING_ZOOM_SCALES[3])
    // 固定焦点在角落：夹到视野不出画面
    expect(held.centerX).toBeCloseTo(1 - 0.5 / 2.2); expect(held.centerY).toBeCloseTo(0.5 / 2.2)
    const ramp = at(1_400_000)
    expect(ramp.scale).toBeGreaterThan(1); expect(ramp.scale).toBeLessThan(2.2)
    for (let us = 700_000; us <= 5_000_000; us += 50_000) {
      const view = at(us); const half = 0.5 / view.scale
      expect(view.centerX - half).toBeGreaterThanOrEqual(-1e-9); expect(view.centerX + half).toBeLessThanOrEqual(1 + 1e-9)
      expect(view.centerY - half).toBeGreaterThanOrEqual(-1e-9); expect(view.centerY + half).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(at(4_000_000)).toEqual(held)
    expect(at(4_900_000)).toEqual({ scale: 1, centerX: 0.5, centerY: 0.5 })
    // 快速过渡更短
    expect(evaluateRecordingZoom(regions, 1_400_000, { connect: true, transition: 'quick' }, none).scale).toBe(1)
  })
  it('相邻区间开启衔接时直接平移不回到原画面，关闭时在间隔里先回原画面', () => {
    const regions = [region(1_000_000, 2_000_000, { focus: { x: 0.2, y: 0.5 } }), region(3_000_000, 4_000_000, { id: 'b', focus: { x: 0.8, y: 0.5 } })]
    const connected = Array.from({ length: 21 }, (_, i) => evaluateRecordingZoom(regions, 2_000_000 + i * 50_000, smooth, none))
    expect(connected.every(view => view.scale === 1.8)).toBe(true)
    expect(connected[0].centerX).toBeLessThan(connected[20].centerX)
    // 间隔放不下完整过渡：缩小与放大按比例压缩，在中途相接时正好回到原画面
    expect(evaluateRecordingZoom(regions, 2_000_000 + 900_000_000 / 2_100, { connect: false, transition: 'smooth' }, none).scale).toBeCloseTo(1, 6)
    // 平移连续：相邻采样没有跳变
    for (let i = 1; i < connected.length; i++) expect(Math.abs(connected[i].centerX - connected[i - 1].centerX)).toBeLessThan(0.1)
  })
  it('跟随指针：死区内不动，靠近边缘才平移；任意定位顺序结果相同；没有指针数据时停在中央', () => {
    const regions = [region(1_000_000, 6_000_000, { focus: 'cursor', depth: 3 })]
    const pointer = (us: number) => us < 3_000_000 ? { x: 0.5, y: 0.5 } : { x: 0.9, y: 0.5 }
    const steady = evaluateRecordingZoom(regions, 2_800_000, smooth, pointer)
    expect(steady.centerX).toBeCloseTo(0.5, 6)
    const later = evaluateRecordingZoom(regions, 5_500_000, smooth, pointer)
    expect(later.centerX).toBeGreaterThan(0.6)
    const small = (us: number) => us < 3_000_000 ? { x: 0.5, y: 0.5 } : { x: 0.55, y: 0.5 }
    expect(evaluateRecordingZoom(regions, 5_500_000, smooth, small).centerX).toBeCloseTo(0.5, 6)
    evaluateRecordingZoom(regions, 1_000_000, smooth, pointer)
    expect(evaluateRecordingZoom(regions, 5_500_000, smooth, pointer)).toEqual(later)
    expect(evaluateRecordingZoom(regions, 3_000_000, smooth, none)).toEqual({ scale: 1.8, centerX: 0.5, centerY: 0.5 })
    expect(recordingZoomPointerSpans(regions, 3_000_000, smooth)).toEqual([{ fromUs: -200_000, toUs: 3_000_000 }])
    expect(recordingZoomPointerSpans([region(1_000_000, 2_000_000)], 1_500_000, smooth)).toEqual([])
  })
  it('事件日志折算指针：静止很久仍给出位置，按源画面归一化', async () => {
    const { pages, source } = await recordingCursorFixture(); const events = pages.flatMap(page => page.entries)
    expect(recordingZoomPointerFromEvents(events, 1_000_000, source)).toEqual({ x: 200 / 1920, y: 300 / 1080 })
    expect(recordingZoomPointerFromEvents(events, 60_000_000, source)!.x).toBeCloseTo(499.991 / 1920, 3)
    expect(recordingZoomPointerFromEvents([], 0, source)).toBeNull()
  })
  it('按点击自动生成：2.5 秒内的点击成组，前后各留 0.5 秒，跳过与已有区间重叠的组，双击或打字用第 4 档', async () => {
    const { pages } = await recordingCursorFixture(); const base = pages[0].entries.find(event => event.kind === 'click')!
    const click = (us: number): CaptureEvent => ({ ...base, recordingUs: us + 10_000_000 }) as CaptureEvent
    const key = (us: number): CaptureEvent => ({ ...base, kind: 'key', category: 'typing', recordingUs: us + 10_000_000 }) as unknown as CaptureEvent
    const events = [click(1_000_000), click(3_000_000), click(9_000_000), click(9_300_000), click(20_000_000), key(20_500_000), click(29_900_000)]
    let id = 0
    const regions = suggestRecordingZoomRegions(events, { recordingStartUs: 10_000_000, durationUs: 30_000_000, createId: () => `s${++id}` })
    expect(regions.map(value => [value.startUs, value.endUs, value.depth, value.focus, value.origin])).toEqual([
      [500_000, 3_500_000, 3, 'cursor', 'auto'], [8_500_000, 9_800_000, 4, 'cursor', 'auto'], [19_500_000, 20_500_000, 4, 'cursor', 'auto'], [29_400_000, 30_000_000, 3, 'cursor', 'auto'],
    ])
    const kept = suggestRecordingZoomRegions(events, { recordingStartUs: 10_000_000, durationUs: 30_000_000, existing: [region(9_000_000, 12_000_000, { id: 'mine' })] })
    expect(kept.map(value => value.id)).toContain('mine')
    expect(kept.some(value => value.origin === 'auto' && value.startUs === 8_500_000)).toBe(false)
    expect(recordingZoomRegionsSchema.safeParse(kept).success).toBe(true)
  })
  it('时间线换算跟随修剪、拆分、变速与倒放', () => {
    const document = { sequences: [{ id: 'seq', frameRate: { numerator: 30, denominator: 1 } }] }
    const clip = { start: 100, duration: 90, sourceInUs: 2_000_000, sourceRemainder: { numerator: 0, denominator: 1 } }
    expect(recordingZoomRegionFrames(document, 'seq', clip, { startUs: 3_000_000, endUs: 4_000_000 })).toEqual({ startFrame: 130, endFrame: 160 })
    expect(recordingZoomRegionFrames(document, 'seq', clip, { startUs: 0, endUs: 1_000_000 })).toBeNull()
    expect(recordingZoomRegionFrames(document, 'seq', clip, { startUs: 4_500_000, endUs: 9_000_000 })).toEqual({ startFrame: 175, endFrame: 190 })
    expect(recordingZoomSourceUsAtFrame(document, 'seq', clip, 130)).toBe(3_000_000)
    const fast = { ...clip, speed: { numerator: 2, denominator: 1 } }
    expect(recordingZoomRegionFrames(document, 'seq', fast, { startUs: 3_000_000, endUs: 4_000_000 })).toEqual({ startFrame: 115, endFrame: 130 })
    const reversed = { ...clip, reverse: true, sourceInUs: 5_000_000 }
    expect(recordingZoomRegionFrames(document, 'seq', reversed, { startUs: 3_000_000, endUs: 4_000_000 })).toEqual({ startFrame: 130, endFrame: 160 })
    expect(recordingZoomSourceUsAtFrame(document, 'seq', reversed, 130)).toBe(4_000_000)
    const right = { ...clip, start: 145, duration: 45, ...splitVideoEditClipSource(clip, 45, { numerator: 30, denominator: 1 }) }
    expect(recordingZoomRegionFrames(document, 'seq', right, { startUs: 3_000_000, endUs: 4_000_000 })).toEqual({ startFrame: 145, endFrame: 160 })
  })
})
