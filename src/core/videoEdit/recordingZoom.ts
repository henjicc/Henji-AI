import { z } from 'zod'
import type { CaptureEvent } from '../captureLog/events'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceSecondsAtTime, type VideoEditClipTiming } from './clipSpeed'
import type { VideoEditRatio } from './time'

/**
 * 录屏自动缩放（参照 Recordly 的缩放区间模型）：缩放区间是效果实例上的独立数据，时间是片段素材的源时间（微秒），
 * 与 `videoEditClipSourceTimeAt` 同一基准，修剪、拆分、移动、变速、倒放后区间自动跟着画面内容走。
 * - 区间内是“保持放大”；放大过渡在区间开始之前完成，缩小过渡在区间结束之后进行，相邻区间可直接平移衔接。
 * - 焦点 `cursor` 跟随重度平滑的指针，指针接近放大视野边缘才平移（死区跟随）；焦点坐标是相对源画面的固定点。
 * - 求值是纯函数：给定区间、源时间和指针采样回调，结果与之前播过哪些帧无关（拖动定位、倒放、导出逐帧一致）。
 * 与 `screenAttention.ts` 烘焙的位置/缩放关键帧是两套独立模型，互不改写。
 */
export const RECORDING_ZOOM_EFFECT = 'recording_zoom'
/** 缩放档位 1–6 对应的放大倍数；默认第 3 档（1.8 倍）。 */
export const RECORDING_ZOOM_SCALES = [1.25, 1.5, 1.8, 2.2, 3.5, 5] as const
export const RECORDING_ZOOM_DEFAULT_DEPTH = 3
/** 开启“衔接”时，间隔不超过这个源时长的相邻区间直接平移，不先缩小再放大。 */
export const RECORDING_ZOOM_CONNECT_GAP_US = 1_500_000
/** 跟随镜头按固定源时间网格推进（全局网格，跨区间、跨帧复用同一组指针采样）。 */
export const RECORDING_ZOOM_FOLLOW_STEP_US = 50_000
const TRANSITIONS = { smooth: { inUs: 1_200_000, outUs: 900_000 }, quick: { inUs: 500_000, outUs: 400_000 } } as const
/** 指针离开视野中央这部分（相对半视野）才推动镜头。 */
const DEAD_ZONE = 0.6
/** 镜头追赶目标的时间常数：越大越稳。 */
const FOLLOW_TAU_US = 450_000

const unit = z.number().finite().min(0).max(1)
const time = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const recordingZoomFocusSchema = z.union([z.literal('cursor'), z.object({ x: unit, y: unit }).strict()])
export const recordingZoomRegionSchema = z.object({
  id: z.string().min(1).max(100), startUs: time, endUs: time,
  depth: z.number().int().min(1).max(RECORDING_ZOOM_SCALES.length), focus: recordingZoomFocusSchema, origin: z.enum(['auto', 'manual']),
}).strict().refine(region => region.endUs > region.startUs, { message: '缩放区间的结束必须晚于开始。', path: ['endUs'] })
export type RecordingZoomRegion = z.infer<typeof recordingZoomRegionSchema>
export type RecordingZoomFocus = z.infer<typeof recordingZoomFocusSchema>
/** 区间数量不设上限；按开始时间排序后不得重叠、ID 不得重复。 */
export const recordingZoomRegionsSchema = z.array(recordingZoomRegionSchema).superRefine((regions, ctx) => {
  const issue = recordingZoomRegionsIssue(regions)
  if (issue) ctx.addIssue({ code: 'custom', message: issue })
})
export function recordingZoomRegionsIssue(regions: readonly RecordingZoomRegion[]): string | undefined {
  if (new Set(regions.map(region => region.id)).size !== regions.length) return '缩放区间的 ID 不能重复。'
  const sorted = sortRecordingZoomRegions(regions)
  for (let i = 1; i < sorted.length; i++) if (sorted[i].startUs < sorted[i - 1].endUs) return '缩放区间不能重叠，请调整开始或结束时间。'
  return undefined
}
export function sortRecordingZoomRegions<T extends Pick<RecordingZoomRegion, 'startUs' | 'endUs'>>(regions: readonly T[]): T[] { return [...regions].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs) }
export function recordingZoomScale(depth: number): number { return RECORDING_ZOOM_SCALES[Math.min(RECORDING_ZOOM_SCALES.length, Math.max(1, Math.round(depth))) - 1] }

export interface RecordingZoomParams { connect: boolean; transition: 'smooth' | 'quick' }
/** 从效果参数（缺省按默认值）取出缩放参数。 */
export function recordingZoomParams(params: Readonly<Record<string, unknown>>): RecordingZoomParams { return { connect: params.connect !== false, transition: params.transition === 'quick' ? 'quick' : 'smooth' } }
export interface RecordingZoomTransform { scale: number; centerX: number; centerY: number }
export interface RecordingZoomPoint { x: number; y: number }
/** 指针位置（相对源画面归一化）；没有数据时返回 null。 */
export type RecordingZoomPointer = (sourceUs: number) => RecordingZoomPoint | null
const IDENTITY: RecordingZoomTransform = { scale: 1, centerX: 0.5, centerY: 0.5 }

const easeInOut = (t: number): number => { const x = Math.min(1, Math.max(0, t)); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2 }
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
function clampView(view: RecordingZoomTransform): RecordingZoomTransform {
  const half = 0.5 / view.scale
  return { scale: view.scale, centerX: clamp(view.centerX, half, 1 - half), centerY: clamp(view.centerY, half, 1 - half) }
}
/**
 * 两个视野之间的过渡：视野矩形按一次位似变换（缩放倍数按对数插值）连续变化，角点沿直线移动，
 * 所以只要两端都在画面内，中间每一帧也都在画面内；放大时焦点区域在屏幕上保持稳定，不先漂向中心。
 */
function between(from: RecordingZoomTransform, to: RecordingZoomTransform, t: number): RecordingZoomTransform {
  if (t <= 0) return from
  if (t >= 1) return to
  const ratio = from.scale / to.scale
  const scale = from.scale / ratio ** t
  if (Math.abs(ratio - 1) < 1e-9) return { scale, centerX: from.centerX + (to.centerX - from.centerX) * t, centerY: from.centerY + (to.centerY - from.centerY) * t }
  // 视野中心 c 随比例 r 的位似：c(r) = a + r·(c_from − a)，a 是不动点。
  const ax = (to.centerX - ratio * from.centerX) / (1 - ratio); const ay = (to.centerY - ratio * from.centerY) / (1 - ratio)
  const r = ratio ** t
  return clampView({ scale, centerX: ax + r * (from.centerX - ax), centerY: ay + r * (from.centerY - ay) })
}

interface Span { region: RecordingZoomRegion; scale: number; activeStart: number; activeEnd: number; inStart: number; outEnd: number; linkedPrev: boolean; linkedNext: boolean }
/** 区间的时间布局：每个区间的活动范围（含过渡）、与前后区间是平移衔接还是先缩小再放大。 */
function layout(regions: readonly RecordingZoomRegion[], params: RecordingZoomParams): { spans: Span[]; pans: Array<{ from: number; to: number }> } {
  const sorted = sortRecordingZoomRegions(regions); const { inUs, outUs } = TRANSITIONS[params.transition]
  const spans: Span[] = sorted.map(region => ({ region, scale: recordingZoomScale(region.depth), activeStart: region.startUs - inUs, activeEnd: region.endUs + outUs, inStart: region.startUs - inUs, outEnd: region.endUs + outUs, linkedPrev: false, linkedNext: false }))
  const pans: Array<{ from: number; to: number }> = []
  for (let i = 0; i + 1 < spans.length; i++) {
    const a = spans[i]; const b = spans[i + 1]; const gap = b.region.startUs - a.region.endUs
    // 紧挨着的区间没有时间先缩小再放大，总是直接平移。
    if (gap <= 0 || params.connect && gap <= RECORDING_ZOOM_CONNECT_GAP_US) {
      const middle = (a.region.endUs + b.region.startUs) / 2; const half = Math.max(gap, outUs) / 2
      const pan = { from: Math.max((a.region.startUs + a.region.endUs) / 2, middle - half), to: Math.min((b.region.startUs + b.region.endUs) / 2, middle + half) }
      pans.push(pan); a.linkedNext = true; b.linkedPrev = true; a.activeEnd = pan.to; b.activeStart = pan.from
      continue
    }
    pans.push({ from: NaN, to: NaN })
    // 过渡放不下时按比例压缩：缩小与放大在间隔中点相接，那一刻正好回到原画面。
    if (gap < outUs + inUs) { a.outEnd = a.region.endUs + gap * outUs / (outUs + inUs); b.inStart = a.outEnd }
    a.activeEnd = a.outEnd; b.activeStart = b.inStart
  }
  return { spans, pans }
}

/** 死区跟随镜头：从 `fromUs` 起按全局网格推进到 `toUs`，状态只来自这段指针采样，任何定位都得到同一结果。 */
function followCenter(scale: number, fromUs: number, toUs: number, pointerAt: RecordingZoomPointer): RecordingZoomPoint {
  const half = 0.5 / scale; const zone = half * DEAD_ZONE
  const start = pointerAt(fromUs) ?? { x: 0.5, y: 0.5 }
  const goal = { x: clamp(start.x, half, 1 - half), y: clamp(start.y, half, 1 - half) }; const camera = { ...goal }
  const step = (time: number, dt: number): void => {
    const pointer = pointerAt(time)
    if (pointer) for (const axis of ['x', 'y'] as const) {
      const delta = pointer[axis] - goal[axis]
      if (Math.abs(delta) > zone) goal[axis] = clamp(pointer[axis] - Math.sign(delta) * zone, half, 1 - half)
    }
    const k = 1 - Math.exp(-dt / FOLLOW_TAU_US)
    camera.x += (goal.x - camera.x) * k; camera.y += (goal.y - camera.y) * k
  }
  let last = fromUs
  for (let grid = (Math.floor(fromUs / RECORDING_ZOOM_FOLLOW_STEP_US) + 1) * RECORDING_ZOOM_FOLLOW_STEP_US; grid <= toUs; grid += RECORDING_ZOOM_FOLLOW_STEP_US) { step(grid, grid - last); last = grid }
  if (toUs > last) step(toUs, toUs - last)
  return camera
}
function held(span: Span, sourceUs: number, pointerAt: RecordingZoomPointer): RecordingZoomTransform {
  const focus = span.region.focus
  const center = focus === 'cursor' ? followCenter(span.scale, span.activeStart, Math.max(span.activeStart, sourceUs), pointerAt) : focus
  return clampView({ scale: span.scale, centerX: center.x, centerY: center.y })
}

/**
 * 源时间 `sourceUs` 处的缩放视野：`scale` 放大倍数，`centerX/centerY` 视野中心（相对源画面归一化），已夹紧到视野不出画面。
 * `pointerAt` 只在焦点为 `cursor` 的区间被调用，查询时刻落在 `recordingZoomPointerSpans` 给出的范围内。
 */
export function evaluateRecordingZoom(regions: readonly RecordingZoomRegion[], sourceUs: number, params: RecordingZoomParams, pointerAt: RecordingZoomPointer): RecordingZoomTransform {
  if (!regions.length || !Number.isFinite(sourceUs)) return IDENTITY
  const { spans, pans } = layout(regions, params)
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    if (sourceUs < span.activeStart || sourceUs > span.activeEnd) continue
    const pan = pans[i]
    if (span.linkedNext && sourceUs > pan.from) return between(held(span, sourceUs, pointerAt), held(spans[i + 1], sourceUs, pointerAt), easeInOut((sourceUs - pan.from) / Math.max(1, pan.to - pan.from)))
    const view = held(span, sourceUs, pointerAt)
    if (!span.linkedPrev && sourceUs < span.region.startUs) return between(IDENTITY, view, easeInOut((sourceUs - span.inStart) / Math.max(1, span.region.startUs - span.inStart)))
    if (!span.linkedNext && sourceUs > span.region.endUs) return between(view, IDENTITY, easeInOut((sourceUs - span.region.endUs) / Math.max(1, span.outEnd - span.region.endUs)))
    return view
  }
  return IDENTITY
}
/** 求值 `sourceUs` 时跟随镜头需要的指针时间范围（源时间微秒）；渲染端据此预先读取指针数据。 */
export function recordingZoomPointerSpans(regions: readonly RecordingZoomRegion[], sourceUs: number, params: RecordingZoomParams): Array<{ fromUs: number; toUs: number }> {
  const { spans } = layout(regions, params)
  return spans.filter(span => span.region.focus === 'cursor' && sourceUs >= span.activeStart && sourceUs <= span.activeEnd).map(span => ({ fromUs: span.activeStart, toUs: Math.max(span.activeStart, sourceUs) }))
}

type CursorEvent = Extract<CaptureEvent, { kind: 'cursor' }>
/**
 * 事件日志里录制时刻 `recordingUs` 的指针位置（相对 `size` 归一化）：取此前最后一个有位置的光标事件，
 * 100 毫秒内有下一个位置时线性插值。与光标重绘不同，原片含光标、光标静止或隐藏都照样给出位置（镜头仍要跟随）。
 */
export function recordingZoomPointerFromEvents(events: readonly CaptureEvent[], recordingUs: number, size: { width: number; height: number }): RecordingZoomPoint | null {
  let lo = 0; let hi = events.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid].recordingUs <= recordingUs) lo = mid + 1; else hi = mid }
  let index = lo - 1
  while (index >= 0 && !(events[index].kind === 'cursor' && (events[index] as CursorEvent).point)) index--
  if (index < 0) return null
  const cursor = events[index] as CursorEvent; const point = [...cursor.point!]
  let next = index + 1
  while (next < events.length && !(events[next].kind === 'cursor' && (events[next] as CursorEvent).point)) next++
  const after = events[next] as CursorEvent | undefined
  if (after && after.recordingUs - cursor.recordingUs <= 100_000 && after.recordingUs > cursor.recordingUs) {
    const t = clamp((recordingUs - cursor.recordingUs) / (after.recordingUs - cursor.recordingUs), 0, 1)
    point[0] += (after.point![0] - point[0]) * t; point[1] += (after.point![1] - point[1]) * t
  }
  return { x: clamp(point[0] / Math.max(1, size.width), 0, 1), y: clamp(point[1] / Math.max(1, size.height), 0, 1) }
}

/** 自动生成用到的聚类参数（与 Recordly 一致）。 */
export const RECORDING_ZOOM_SUGGEST = { clusterGapUs: 2_500_000, paddingUs: 500_000 } as const
/**
 * 按点击自动生成缩放区间（纯函数）：只用明确的按下事件；相邻点击间隔不超过 2.5 秒归为一组，每组前后各留 0.5 秒，
 * 夹到素材范围内；焦点跟随指针、第 3 档（1.8 倍）。组内出现双击（0.5 秒内两次按下）或点击后 2 秒内打字时用第 4 档（2.2 倍），
 * 方便看清被编辑的细节。`existing` 里已有的区间（通常是用户手动调过的）保留，与之重叠的新区间跳过。
 * 时间换算：素材源时间 = 事件 recordingUs − recordingStartUs。
 */
export function suggestRecordingZoomRegions(events: readonly CaptureEvent[], options: { recordingStartUs: number; durationUs: number; existing?: readonly RecordingZoomRegion[]; createId?: () => string }): RecordingZoomRegion[] {
  const media = (event: CaptureEvent): number => event.recordingUs - options.recordingStartUs
  const presses = events.filter(event => event.kind === 'click' && event.phase === 'down').map(media).filter(us => us >= 0 && us <= options.durationUs).sort((a, b) => a - b)
  const typing = events.filter(event => event.kind === 'key' && event.category === 'typing').map(media).sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const us of presses) { const last = clusters.at(-1); if (last && us - last.at(-1)! <= RECORDING_ZOOM_SUGGEST.clusterGapUs) last.push(us); else clusters.push([us]) }
  const existing = sortRecordingZoomRegions(options.existing ?? [])
  const created: RecordingZoomRegion[] = []
  for (const cluster of clusters) {
    const startUs = Math.max(0, Math.round(cluster[0] - RECORDING_ZOOM_SUGGEST.paddingUs))
    const endUs = Math.min(Math.round(options.durationUs), Math.round(cluster.at(-1)! + RECORDING_ZOOM_SUGGEST.paddingUs))
    if (endUs <= startUs) continue
    const occupied = [...existing, ...created]
    if (occupied.some(region => region.startUs < endUs && region.endUs > startUs)) continue
    const doubleClick = cluster.some((us, i) => i > 0 && us - cluster[i - 1] <= 500_000)
    const typed = cluster.some(us => typing.some(key => key >= us && key - us <= 2_000_000))
    created.push({ id: options.createId?.() ?? crypto.randomUUID(), startUs, endUs, depth: doubleClick || typed ? 4 : RECORDING_ZOOM_DEFAULT_DEPTH, focus: 'cursor', origin: 'auto' })
  }
  return sortRecordingZoomRegions([...existing, ...created])
}

interface ZoomDocument { sequences: ReadonlyArray<{ id: string; frameRate: VideoEditRatio }> }
function sequenceFps(document: ZoomDocument, sequenceId: string): number {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('所属序列已移除。')
  return sequence.frameRate.numerator / sequence.frameRate.denominator
}
/**
 * 区间在时间线上可见的帧范围 [startFrame, endFrame)（序列帧号，已按片段起点、修剪、速度、倒放换算并截到片段内）；
 * 区间不在片段使用的源范围内时为 null。时间线缩放轨道据此画区间块。
 */
export function recordingZoomRegionFrames(document: ZoomDocument, sequenceId: string, clip: VideoEditClipTiming, region: Pick<RecordingZoomRegion, 'startUs' | 'endUs'>): { startFrame: number; endFrame: number } | null {
  const fps = sequenceFps(document, sequenceId)
  const a = videoEditClipFrameBoundaryAtSource(clip, region.startUs / 1e6, fps); const b = videoEditClipFrameBoundaryAtSource(clip, region.endUs / 1e6, fps)
  const startFrame = Math.max(clip.start, Math.round(Math.min(a, b))); const endFrame = Math.min(clip.start + clip.duration, Math.round(Math.max(a, b)))
  return endFrame > startFrame ? { startFrame, endFrame } : null
}
/** 时间线帧边界 `frame` 对应的片段源时间（微秒，可在片段外）：在时间线上拖出、拖动区间时换回源时间。 */
export function recordingZoomSourceUsAtFrame(document: ZoomDocument, sequenceId: string, clip: VideoEditClipTiming, frame: number): number {
  const fps = sequenceFps(document, sequenceId)
  return Math.round(videoEditClipSourceSecondsAtTime(clip, frame / fps, fps) * 1e6)
}
