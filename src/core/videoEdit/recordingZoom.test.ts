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
  it('缩放块就是动的范围：块开始时开始放大、块结束时缩小完成，中间保持；视野始终在画面内', () => {
    const regions = [region(2_000_000, 4_000_000, { depth: 4, focus: { x: 0.95, y: 0.05 } })]
    const at = (us: number) => evaluateRecordingZoom(regions, us, smooth, none)
    expect(at(0)).toEqual({ scale: 1, centerX: 0.5, centerY: 0.5 })
    expect(at(1_999_000)).toEqual({ scale: 1, centerX: 0.5, centerY: 0.5 })
    const held = at(3_000_000)
    expect(held.scale).toBe(RECORDING_ZOOM_SCALES[3])
    // 固定焦点在角落：夹到视野不出画面
    expect(held.centerX).toBeCloseTo(1 - 0.5 / 2.2); expect(held.centerY).toBeCloseTo(0.5 / 2.2)
    const ramp = at(2_400_000)
    expect(ramp.scale).toBeGreaterThan(1); expect(ramp.scale).toBeLessThan(2.2)
    for (let us = 700_000; us <= 5_000_000; us += 50_000) {
      const view = at(us); const half = 0.5 / view.scale
      expect(view.centerX - half).toBeGreaterThanOrEqual(-1e-9); expect(view.centerX + half).toBeLessThanOrEqual(1 + 1e-9)
      expect(view.centerY - half).toBeGreaterThanOrEqual(-1e-9); expect(view.centerY + half).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(at(3_200_000)).toEqual(held)
    expect(at(4_000_000)).toEqual({ scale: 1, centerX: 0.5, centerY: 0.5 })
    expect(at(4_900_000)).toEqual({ scale: 1, centerX: 0.5, centerY: 0.5 })
    // 快速过渡更短：同一时刻已经放大到位
    expect(evaluateRecordingZoom(regions, 2_600_000, { connect: true, transition: 'quick' }, none).scale).toBe(2.2)
  })
  it('相邻区间开启衔接时直接平移不回到原画面，关闭时在间隔里先回原画面', () => {
    const regions = [region(1_000_000, 2_000_000, { focus: { x: 0.2, y: 0.5 } }), region(3_000_000, 4_000_000, { id: 'b', focus: { x: 0.8, y: 0.5 } })]
    const connected = Array.from({ length: 21 }, (_, i) => evaluateRecordingZoom(regions, 2_000_000 + i * 50_000, smooth, none))
    expect(connected.every(view => view.scale === 1.8)).toBe(true)
    expect(connected[0].centerX).toBeLessThan(connected[20].centerX)
    // 不衔接：前一块结束时已回到原画面，间隔里保持原画面
    expect(evaluateRecordingZoom(regions, 2_000_000 + 900_000_000 / 2_100, { connect: false, transition: 'smooth' }, none).scale).toBeCloseTo(1, 6)
    // 平移连续：相邻采样没有跳变
    for (let i = 1; i < connected.length; i++) expect(Math.abs(connected[i].centerX - connected[i - 1].centerX)).toBeLessThan(0.1)
  })
  it('跟随指针：小范围活动不动，移出后半秒内跟上；靠近画面边缘时视野贴边；任意定位顺序结果相同；没有指针数据时停在中央', () => {
    const regions = [region(1_000_000, 6_000_000, { focus: 'cursor', depth: 3 })]
    const half = 0.5 / 1.8
    const pointer = (us: number) => us < 3_000_000 ? { x: 0.5, y: 0.5 } : { x: 0.97, y: 0.5 }
    expect(evaluateRecordingZoom(regions, 2_800_000, smooth, pointer).centerX).toBeCloseTo(0.5, 6)
    // 指针跳到右边缘：0.5 秒后视野已基本贴右边，不再差一截
    expect(evaluateRecordingZoom(regions, 3_500_000, smooth, pointer).centerX).toBeGreaterThan(1 - half - 0.03)
    const later = evaluateRecordingZoom(regions, 4_500_000, smooth, pointer)
    expect(later.centerX).toBeCloseTo(1 - half, 4)
    // 指针在框内小幅移动：镜头不动
    const small = (us: number) => ({ x: 0.5 + 0.1 * Math.sin(us / 300_000), y: 0.5 })
    const still = [2_500_000, 3_500_000, 4_500_000].map(us => evaluateRecordingZoom(regions, us, smooth, small).centerX)
    expect(Math.max(...still) - Math.min(...still)).toBeLessThan(1e-9)
    // 指针在左下角附近走动：视野始终贴左下角
    const corner = (us: number) => ({ x: 0.04 + 0.05 * Math.sin(us / 200_000), y: 0.95 })
    for (const us of [2_000_000, 3_000_000, 4_000_000]) {
      const view = evaluateRecordingZoom(regions, us, smooth, corner)
      expect(view.centerX).toBeCloseTo(half, 6); expect(view.centerY).toBeCloseTo(1 - half, 6)
    }
    // 高倍数：指针在一组里来回移动也一直在视野内
    const deep = [region(1_000_000, 6_000_000, { focus: 'cursor', depth: 6 })]
    const sweep = (us: number) => ({ x: 0.3 + 0.05 * Math.sin(us / 150_000), y: 0.3 + 0.07 * Math.cos(us / 170_000) })
    for (let us = 2_500_000; us <= 5_000_000; us += 50_000) {
      const view = evaluateRecordingZoom(deep, us, smooth, sweep); const p = sweep(us); const h = 0.5 / view.scale
      expect(Math.abs(p.x - view.centerX)).toBeLessThan(h); expect(Math.abs(p.y - view.centerY)).toBeLessThan(h)
    }
    evaluateRecordingZoom(regions, 1_000_000, smooth, pointer)
    expect(evaluateRecordingZoom(regions, 4_500_000, smooth, pointer)).toEqual(later)
    expect(evaluateRecordingZoom(regions, 3_000_000, smooth, none)).toEqual({ scale: 1.8, centerX: 0.5, centerY: 0.5 })
    expect(recordingZoomPointerSpans(regions, 3_000_000, smooth)).toEqual([{ fromUs: 2_000_000, toUs: 5_200_000 }])
    // 推近过渡只朝保持段起点的视野去：保持段之前指针怎么动都不影响过渡，缩放与位移是同一次运动
    const wander = (us: number) => us < 2_000_000 ? { x: 0.1 + 0.8 * (us - 1_000_000) / 1_000_000, y: 0.2 } : pointer(us)
    for (const us of [1_100_000, 1_500_000, 1_900_000]) expect(evaluateRecordingZoom(regions, us, smooth, wander)).toEqual(evaluateRecordingZoom(regions, us, smooth, pointer))
    expect(recordingZoomPointerSpans([region(1_000_000, 2_000_000)], 2_500_000, smooth)).toEqual([])
  })
  it('事件日志折算指针：静止很久仍给出位置，按源画面归一化', async () => {
    const { pages, source } = await recordingCursorFixture(); const events = pages.flatMap(page => page.entries)
    expect(recordingZoomPointerFromEvents(events, 1_000_000, source)).toEqual({ x: 200 / 1920, y: 300 / 1080 })
    expect(recordingZoomPointerFromEvents(events, 60_000_000, source)!.x).toBeCloseTo(499.991 / 1920, 3)
    expect(recordingZoomPointerFromEvents([], 0, source)).toBeNull()
  })
  it('按关注的地方自动生成：一段操作一个固定取景，人还在那里就不缩回去；离开、滚动或去点别处才结束', async () => {
    const { pages } = await recordingCursorFixture(); const entries = pages.flatMap(page => page.entries)
    const baseClick = entries.find(event => event.kind === 'click')!; const baseCursor = entries.find(event => event.kind === 'cursor')!
    const click = (seconds: number, x: number, y: number): CaptureEvent => ({ ...baseClick, phase: 'down', point: [x, y], recordingUs: seconds * 1e6 + 10_000_000 }) as CaptureEvent
    const move = (seconds: number, x: number, y: number): CaptureEvent => ({ ...baseCursor, point: [x, y], recordingUs: seconds * 1e6 + 10_000_000 }) as CaptureEvent
    const key = (seconds: number, category = 'typing'): CaptureEvent => ({ ...baseClick, kind: 'key', category, recordingUs: seconds * 1e6 + 10_000_000 }) as unknown as CaptureEvent
    const scroll = (seconds: number): CaptureEvent => ({ ...baseClick, kind: 'scroll', axis: 'vertical', amount: 4, recordingUs: seconds * 1e6 + 10_000_000 }) as unknown as CaptureEvent
    const options = { recordingStartUs: 10_000_000, durationUs: 30_000_000, size: { width: 1000, height: 1000 }, createId: () => 'auto' }
    const suggest = (events: CaptureEvent[]) => suggestRecordingZoomRegions(events, options).map(value => [value.startUs, value.endUs, value.depth, value.focus, value.origin])
    const half = Math.round(0.5 / 1.8 * 1e4) / 1e4
    // 点进底部输入框后指针一直停在那里，只偶尔按键：整段保持同一个贴底的取景，直到指针离开；路过别处不生成区间。
    expect(suggest([move(0, 500, 900), click(1, 500, 900), key(6, 'shortcut'), key(12, 'shortcut'), move(15, 100, 100), move(16, 800, 300), move(17, 100, 100), click(20, 100, 100)])).toEqual([
      [0, 15_600_000, 3, { x: 0.5, y: 1 - half }, 'auto'], [19_000_000, 30_000_000, 3, { x: half, y: half }, 'auto'],
    ])
    const busy = [
      // 点一下就把鼠标挪开打字：打字期间保持（第 4 档）；不久后回到同一处再点并入同一段；开始滚动页面时结束。
      move(0, 500, 500), click(1, 500, 500), move(1.1, 900, 900), key(1.5), key(3), key(5), key(7), move(8.9, 510, 500), click(9, 500, 500), scroll(9.4),
      // 来不及平移的接连两次点击相距很远：用小一档的倍数一起框住，不甩镜头。
      move(19.9, 100, 500), click(20, 100, 500), move(20.5, 600, 500), click(20.6, 600, 500), move(22, 900, 100),
    ]
    expect(suggest(busy)).toEqual([[0, 10_300_000, 4, { x: 0.5, y: 0.5 }, 'auto'], [19_000_000, 22_600_000, 1, { x: 0.44, y: 0.5 }, 'auto']])
    // 滚动之后按的翻页键、再点同一处，都不延续前一段。
    expect(suggest([move(0, 500, 500), click(1, 500, 500), scroll(1.4), key(2, 'shortcut'), click(3, 500, 500), move(4, 900, 100)]).map(value => value[0])).toEqual([0, 2_000_000])
    // 紧接着去点放不进同一取景的地方：两段相接（求值时是一次平移），下一次点击前到位。
    expect(suggest([move(0, 100, 500), click(1, 100, 500), move(3, 900, 500), click(4, 900, 500), move(5, 500, 100)])).toEqual([
      [0, 3_000_000, 3, { x: half, y: 0.5 }, 'auto'], [3_000_000, 5_600_000, 3, { x: 1 - half, y: 0.5 }, 'auto'],
    ])
    // 手动调过的区间保留，与它重叠的自动段跳过。
    const kept = suggestRecordingZoomRegions(busy, { ...options, existing: [region(9_000_000, 12_000_000, { id: 'mine' })], createId: undefined })
    expect(kept.map(value => value.id)).toContain('mine')
    expect(kept.filter(value => value.origin === 'auto').map(value => value.startUs)).toEqual([19_000_000])
    expect(recordingZoomRegionsSchema.safeParse(kept).success).toBe(true)
  })
  it('跟随指针只去目的地：路过的位置不取景，停下的地方仍在视野里就不动；衔接平移用一次过渡的时长走完', () => {
    const regions = [region(1_000_000, 9_000_000, { focus: 'cursor', depth: 3 })]
    // 指针从左边出发，途中在上方晃了 0.2 秒，最后停在右边：镜头直接去右边，纵向全程不动。
    const detour = (us: number) => us < 3_000_000 ? { x: 0.1, y: 0.5 } : us < 3_200_000 ? { x: 0.5, y: 0.05 } : { x: 0.9, y: 0.5 }
    for (let us = 2_000_000; us <= 8_000_000; us += 50_000) expect(evaluateRecordingZoom(regions, us, smooth, detour).centerY).toBeCloseTo(0.5, 9)
    expect(evaluateRecordingZoom(regions, 3_100_000, smooth, detour).centerX).toBeGreaterThan(0.5 / 1.8)
    expect(evaluateRecordingZoom(regions, 4_000_000, smooth, detour).centerX).toBeCloseTo(1 - 0.5 / 1.8, 3)
    // 换到视野里的另一处停下：镜头不动。
    const nearby = (us: number) => us < 4_000_000 ? { x: 0.4, y: 0.5 } : { x: 0.6, y: 0.4 }
    expect(evaluateRecordingZoom(regions, 7_000_000, smooth, nearby)).toEqual(evaluateRecordingZoom(regions, 3_000_000, smooth, nearby))
    // 两段隔着 1.4 秒衔接：前一段保持结束后用一次推近的时长（1 秒）平移到位，之后在下一段的取景等着。
    const linked = [region(1_000_000, 4_000_000, { focus: { x: 0.2, y: 0.5 } }), region(5_400_000, 9_000_000, { id: 'b', focus: { x: 0.8, y: 0.5 } })]
    expect(evaluateRecordingZoom(linked, 3_200_000, smooth, none).centerX).toBeCloseTo(0.5 / 1.8, 9)
    expect(evaluateRecordingZoom(linked, 4_200_000, smooth, none)).toEqual({ scale: 1.8, centerX: 1 - 0.5 / 1.8, centerY: 0.5 })
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
