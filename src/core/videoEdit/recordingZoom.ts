import { z } from 'zod'
import type { CaptureEvent } from '../captureLog/events'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceSecondsAtTime, type VideoEditClipTiming } from './clipSpeed'
import type { VideoEditRatio } from './time'

/**
 * 录屏自动缩放（参照 Recordly 的缩放区间模型）：缩放区间是效果实例上的独立数据，时间是片段素材的源时间（微秒），
 * 与 `videoEditClipSourceTimeAt` 同一基准，修剪、拆分、移动、变速、倒放后区间自动跟着画面内容走。
 * - 区间内是“保持放大”；放大过渡在区间开始之前完成，缩小过渡在区间结束之后进行，相邻区间可直接平移衔接。
 * - 镜头只去“目的地”，不跟着指针走。自动生成的区间对准固定位置：一段操作（点击以及随后的输入、停留）共用一个取景，全程不动。
 *   焦点 `cursor` 跟随指针时，目的地是指针停下来的地方：路过的位置不取景，停下的地方仍在视野里也不动；
 *   取景按比例放在可移动范围里，靠近画面边缘时视野贴边（参照 Cap）；镜头用临界阻尼弹簧去目的地。
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
const TRANSITIONS = { smooth: { inUs: 1_000_000, outUs: 800_000 }, quick: { inUs: 500_000, outUs: 400_000 } } as const
/** 指针在一处活动的范围（相对视野宽、高）：指针移出这个框才重新取景，框内的小幅移动镜头不动。取值同 Cap。 */
const CLUSTER_WIDTH = 0.5
const CLUSTER_HEIGHT = 0.7
/** 焦点离画面边缘不到这个比例时视野直接贴边，边角内容整块露出，不随指针在边角附近走动（同 Cap 的 edge snap）。 */
const EDGE_SNAP = 0.25
/** 这组指针的外接框离视野边至少留这部分（相对半视野）：高倍数下按比例取景时指针也不出视野。 */
const FOCUS_MARGIN = 0.1
/** 指针在一处至少停这么久才算目的地；更短的只是路过，镜头不为它取景。 */
const MIN_DWELL_US = 400_000
/** 镜头弹簧角频率（每秒，临界阻尼）：约 0.2 秒走完一半、0.5 秒到位、不过冲。接近 Cap 默认（刚度 200、阻尼 40、质量 2.25）。 */
const FOLLOW_OMEGA = 9.4

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
  const { inUs, outUs } = TRANSITIONS[params.transition]
  // A block on the zoom lane is exactly the stretch that moves: zooming in starts at its start and zooming out
  // ends at its end. The held part sits inside; short blocks shrink both transitions to fit.
  const spans: Span[] = sortRecordingZoomRegions(regions).map(outer => {
    const fit = Math.min(1, (outer.endUs - outer.startUs) * 0.8 / (inUs + outUs))
    const region = { ...outer, startUs: outer.startUs + Math.round(inUs * fit), endUs: outer.endUs - Math.round(outUs * fit) }
    return { region, scale: recordingZoomScale(outer.depth), activeStart: outer.startUs, activeEnd: outer.endUs, inStart: outer.startUs, outEnd: outer.endUs, linkedPrev: false, linkedNext: false }
  })
  const pans: Array<{ from: number; to: number }> = []
  for (let i = 0; i + 1 < spans.length; i++) {
    const a = spans[i]; const b = spans[i + 1]; const gap = b.inStart - a.outEnd
    // 紧挨着的区间没有时间先缩小再放大，总是直接平移；平移占用两段相接处的过渡时间。
    if (gap <= 0 || params.connect && gap <= RECORDING_ZOOM_CONNECT_GAP_US) {
      // 前一段的关注一结束镜头就去下一段，用一次推近的时长走完后在那里等：指针横穿画面通常一秒左右，
      // 平移拉得更长镜头就落在指针后面；也不把平移拉长到填满整个间隔。
      const pan = { from: a.region.endUs, to: Math.min(b.region.startUs, a.region.endUs + inUs) }
      pans.push(pan); a.linkedNext = true; b.linkedPrev = true; a.activeEnd = pan.to; b.activeStart = pan.from
      continue
    }
    pans.push({ from: NaN, to: NaN })
  }
  return { spans, pans }
}

/**
 * 一个轴上一组指针（外接框 lo–hi）对应的视野中心：框中心按比例落在视野可移动范围里（在最左时视野贴左边，最右时贴右边），
 * 离边不到 `EDGE_SNAP` 直接贴边；再保证整个框在视野内侧（分组框不超过视野的 0.5×0.7，留得下边距）。
 */
function frameAxis(lo: number, hi: number, half: number): number {
  const travel = clamp(((lo + hi) / 2 - EDGE_SNAP) / (1 - 2 * EDGE_SNAP), 0, 1)
  const margin = half * FOCUS_MARGIN
  return clamp(clamp(half + travel * (1 - 2 * half), hi - half + margin, lo + half - margin), half, 1 - half)
}
interface Cluster { startUs: number; x0: number; x1: number; y0: number; y1: number }
/**
 * 保持段里指针的目的地：先按时间贪心分组（一组的外接框不超过视野宽 50%、高 70%，超出就开新组，同 Cap），
 * 再去掉停留不到 `MIN_DWELL_US` 的组（指针只是路过）。目的地的 `startUs` 是指针离开上一个目的地的时刻：
 * 镜头从那一刻起直接去下一个目的地，途中经过哪里都不管。
 */
function pointerStops(scale: number, fromUs: number, endUs: number, untilUs: number, pointerAt: RecordingZoomPointer): Cluster[] {
  const maxW = CLUSTER_WIDTH / scale; const maxH = CLUSTER_HEIGHT / scale
  const clusters: Cluster[] = []
  /** 返回 false 表示 `untilUs` 之后已经有一个完整的目的地：求值用不到更后面的，不必再扫。 */
  const add = (time: number): boolean => {
    const p = pointerAt(time)
    if (!p) return true
    const last = clusters.at(-1)
    if (last && Math.max(last.x1, p.x) - Math.min(last.x0, p.x) <= maxW && Math.max(last.y1, p.y) - Math.min(last.y0, p.y) <= maxH) {
      last.x0 = Math.min(last.x0, p.x); last.x1 = Math.max(last.x1, p.x); last.y0 = Math.min(last.y0, p.y); last.y1 = Math.max(last.y1, p.y)
      return true
    }
    if (last && last.startUs > untilUs && time - last.startUs >= MIN_DWELL_US) return false
    clusters.push({ startUs: time, x0: p.x, x1: p.x, y0: p.y, y1: p.y })
    return true
  }
  add(fromUs)
  for (let grid = (Math.floor(fromUs / RECORDING_ZOOM_FOLLOW_STEP_US) + 1) * RECORDING_ZOOM_FOLLOW_STEP_US; grid <= endUs; grid += RECORDING_ZOOM_FOLLOW_STEP_US) if (!add(grid)) break
  const stops: Cluster[] = []
  let leftUs = fromUs
  for (let i = 0; i < clusters.length; i++) {
    const until = clusters[i + 1]?.startUs ?? endUs
    if (until - clusters[i].startUs < MIN_DWELL_US) continue
    stops.push({ ...clusters[i], startUs: leftUs }); leftUs = until
  }
  // 指针整段都没停过：对准它最开始所在的位置。
  return stops.length || !clusters.length ? stops : [{ ...clusters[0], startUs: fromUs }]
}
/**
 * 跟随镜头：对准指针的目的地（整组外接框，用 `frameAxis` 取景）；新目的地已经在当前取景里就不动。
 * 镜头用临界阻尼弹簧去目的地（精确解，速度跨目标变化连续），从 `fromUs` 起按全局网格推进到 `toUs`。
 * 结果只取决于区间内的指针采样，任何定位顺序都得到同一结果。
 */
function followCenter(scale: number, fromUs: number, endUs: number, toUs: number, pointerAt: RecordingZoomPointer): RecordingZoomPoint {
  const half = 0.5 / scale; const inner = half * (1 - FOCUS_MARGIN)
  const stops = pointerStops(scale, fromUs, endUs, toUs, pointerAt)
  let index = -1
  const target = { x: 0.5, y: 0.5 }
  const aim = (time: number): void => {
    while (index + 1 < stops.length && stops[index + 1].startUs <= time) {
      const c = stops[++index]
      if (index > 0 && c.x0 >= target.x - inner && c.x1 <= target.x + inner && c.y0 >= target.y - inner && c.y1 <= target.y + inner) continue
      target.x = frameAxis(c.x0, c.x1, half); target.y = frameAxis(c.y0, c.y1, half)
    }
  }
  aim(fromUs)
  const camera = { ...target }; const velocity = { x: 0, y: 0 }
  const step = (time: number, dt: number): void => {
    aim(time)
    const t = dt / 1e6; const decay = Math.exp(-FOLLOW_OMEGA * t)
    for (const axis of ['x', 'y'] as const) {
      const offset = camera[axis] - target[axis]; const c = velocity[axis] + FOLLOW_OMEGA * offset
      camera[axis] = target[axis] + (offset + c * t) * decay; velocity[axis] = (velocity[axis] - FOLLOW_OMEGA * c * t) * decay
    }
  }
  let last = fromUs
  for (let grid = (Math.floor(fromUs / RECORDING_ZOOM_FOLLOW_STEP_US) + 1) * RECORDING_ZOOM_FOLLOW_STEP_US; grid <= toUs; grid += RECORDING_ZOOM_FOLLOW_STEP_US) { step(grid, grid - last); last = grid }
  if (toUs > last) step(toUs, toUs - last)
  return camera
}
/**
 * 保持段的视野。跟随只在保持段里进行，过渡段取保持段两端的定值：推近、拉远、衔接平移各自只是一次运动，
 * 缩放与位移同一条曲线、同时开始同时结束，不会叠上跟随镜头的另一段运动而显得发飘。
 */
function held(span: Span, sourceUs: number, pointerAt: RecordingZoomPointer): RecordingZoomTransform {
  const focus = span.region.focus
  const { startUs, endUs } = span.region
  const center = focus === 'cursor' ? followCenter(span.scale, startUs, endUs, clamp(sourceUs, startUs, endUs), pointerAt) : focus
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
  // 跟随只在保持段里；目的地要看指针之后停在哪（镜头提前去那里），所以读到保持段结束。
  return spans.filter(span => span.region.focus === 'cursor' && sourceUs >= span.activeStart && sourceUs <= span.activeEnd).map(span => ({ fromUs: span.region.startUs, toUs: span.region.endUs }))
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

/**
 * 自动生成的参数：`beforeUs` 是第一次点击前留给放大的时间，`afterUs` 是关注结束后留给缩小的时间（两个过渡都在区间内）；
 * `mergeGapUs` 内又回到同一处操作就并成一段；指针离开取景超过 `leaveGraceUs` 才算离开，镜头提前 `leaveLeadUs` 动身；
 * 最后一次操作后至少保持 `minHoldUs`。
 */
export const RECORDING_ZOOM_SUGGEST = { mergeGapUs: 2_500_000, beforeUs: 1_000_000, afterUs: 800_000, minHoldUs: 500_000, leaveGraceUs: 1_000_000, leaveLeadUs: 200_000 } as const
/** 一段操作的全部点击占视野的比例不超过这个值才共用一个取景，四周留得下边距。 */
const SUGGEST_FIT = 0.7
interface Attention { presses: number[]; x0: number; x1: number; y0: number; y1: number }
/** 升序数组里第一个大于 `value` 的下标。 */
function upperBound<T>(list: readonly T[], value: number, key: (item: T) => number): number {
  let lo = 0; let hi = list.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (key(list[mid]) <= value) lo = mid + 1; else hi = mid }
  return lo
}
/**
 * 按“关注的地方”自动生成缩放区间（纯函数；对照 Screen Studio 的自动缩放只对准点击位置、Cap 按点击加时间合并）。
 * 镜头只去目的地，一段操作一个固定取景：
 * - 关注点是按下鼠标的位置；位置放得进同一个取景、又隔得不久的点击并成一段，取景由这一段全部点击的范围决定并贴边。
 * - 一段持续到关注离开为止：指针还留在点击位置附近（取景里、离这些点击不超过半个视野）、还在按键输入，就一直保持，不因为一时没有点击而缩回去；
 *   指针离开不回来、开始滚动页面（在看大范围内容）、或去点别处时结束。没有点击的移动不生成区间。
 * - 紧接着去点别处时两段相接，求值时是一次平移；隔得久才先缩小。接连点在相距很远的地方时改用更小的倍数一起框住，不来回甩镜头。
 * 默认第 3 档（1.8 倍）；段内有双击（0.5 秒内两次按下）或点击后 2 秒内打字时用第 4 档（2.2 倍），方便看清被编辑的细节。
 * `existing` 里已有的区间（通常是用户手动调过的）保留，与之重叠的新区间跳过。
 * 时间换算：素材源时间 = 事件 recordingUs − recordingStartUs；`size` 是事件坐标所在的画面尺寸。
 */
export function suggestRecordingZoomRegions(events: readonly CaptureEvent[], options: { recordingStartUs: number; durationUs: number; size: { width: number; height: number }; existing?: readonly RecordingZoomRegion[]; createId?: () => string }): RecordingZoomRegion[] {
  const { mergeGapUs, beforeUs, afterUs, minHoldUs, leaveGraceUs, leaveLeadUs } = RECORDING_ZOOM_SUGGEST
  const durationUs = Math.round(options.durationUs)
  const media = (event: CaptureEvent): number => Math.round(event.recordingUs - options.recordingStartUs)
  const place = (point: readonly number[]): RecordingZoomPoint => ({ x: clamp(point[0] / Math.max(1, options.size.width), 0, 1), y: clamp(point[1] / Math.max(1, options.size.height), 0, 1) })
  const times = (match: (event: CaptureEvent) => boolean): number[] => events.filter(match).map(media).sort((a, b) => a - b)
  const presses = events.flatMap(event => event.kind === 'click' && event.phase === 'down' ? [{ us: media(event), ...place(event.point) }] : []).filter(press => press.us >= 0 && press.us <= durationUs).sort((a, b) => a.us - b.us)
  const pointer = events.flatMap(event => event.kind === 'cursor' ? [{ us: media(event), point: event.point ? place(event.point) : null }] : []).sort((a, b) => a.us - b.us)
  const keys = times(event => event.kind === 'key'); const typing = times(event => event.kind === 'key' && event.category === 'typing'); const scrolls = times(event => event.kind === 'scroll')
  const self = (us: number): number => us

  /** 这一段用的档位：从想用的档位往下找到放得进全部点击的那一档；`minDepth` 以上都放不进时为 undefined。 */
  const depthOf = (seg: Attention, minDepth: number): number | undefined => {
    const doubleClick = seg.presses.some((us, i) => i > 0 && us - seg.presses[i - 1] <= 500_000)
    const typed = seg.presses.some(us => { const key = typing[upperBound(typing, us - 1, self)]; return key !== undefined && key - us <= 2_000_000 })
    for (let depth = doubleClick || typed ? 4 : RECORDING_ZOOM_DEFAULT_DEPTH; depth >= minDepth; depth--) {
      const fit = SUGGEST_FIT / recordingZoomScale(depth)
      if (seg.x1 - seg.x0 <= fit && seg.y1 - seg.y0 <= fit) return depth
    }
    return undefined
  }
  const viewOf = (seg: Attention): RecordingZoomTransform => {
    const scale = recordingZoomScale(depthOf(seg, 1) ?? 1); const half = 0.5 / scale
    return { scale, centerX: frameAxis(seg.x0, seg.x1, half), centerY: frameAxis(seg.y0, seg.y1, half) }
  }
  /** `fromUs` 之后指针离开这一段（超过 `leaveGraceUs` 没回来）的时刻；到 `limitUs` 还在就返回 `limitUs`。没有指针记录时无从判断，按立刻离开算。 */
  const leaveAt = (seg: Attention, fromUs: number, limitUs: number): number => {
    if (!pointer.length) return fromUs
    const view = viewOf(seg); const half = 0.5 / view.scale
    // 贴边的取景另一头离点击很远，指针到了那里已经是在看别的东西。
    const inside = (p: RecordingZoomPoint | null): boolean => !!p && Math.abs(p.x - view.centerX) <= half && Math.abs(p.y - view.centerY) <= half
      && p.x >= seg.x0 - half && p.x <= seg.x1 + half && p.y >= seg.y0 - half && p.y <= seg.y1 + half
    let i = upperBound(pointer, fromUs, sample => sample.us)
    let outsideSince = i > 0 && !inside(pointer[i - 1].point) ? fromUs : undefined
    for (; i < pointer.length && pointer[i].us < limitUs; i++) {
      if (outsideSince !== undefined && pointer[i].us - outsideSince >= leaveGraceUs) return outsideSince
      if (inside(pointer[i].point)) outsideSince = undefined; else outsideSince ??= pointer[i].us
    }
    return outsideSince !== undefined && limitUs - outsideSince >= leaveGraceUs ? outsideSince : limitUs
  }
  /** 这一段的关注到什么时候结束（不超过 `limitUs`）：`aliveUs` 是最后一次操作，`heldEndUs` 是取景保持到的时刻。 */
  const attention = (seg: Attention, limitUs: number): { aliveUs: number; heldEndUs: number } => {
    let aliveUs = seg.presses.at(-1)!
    for (;;) {
      const scroll = scrolls[upperBound(scrolls, aliveUs, self)] ?? Infinity
      const leaveUs = Math.min(leaveAt(seg, aliveUs, limitUs), scroll)
      // 人还在这里时按的键、上次操作后不久按的键（打字时常把鼠标挪开），都是这段操作的延续；
      // 滚动之后的按键（翻页、方向键）是在看滚动的内容，不再延续。
      const key = keys[upperBound(keys, Math.min(limitUs, scroll - 1, Math.max(leaveUs, aliveUs + mergeGapUs)), self) - 1]
      if (!(key > aliveUs)) return { aliveUs, heldEndUs: Math.min(limitUs, Math.max(leaveUs - leaveLeadUs, aliveUs + minHoldUs)) }
      aliveUs = key
    }
  }

  const existing = sortRecordingZoomRegions(options.existing ?? [])
  const created: RecordingZoomRegion[] = []
  /** 结束一段并写出区间；后面紧跟着下一段（`nextUs` 处的点击）时两段相接，返回下一段区间的开始。 */
  const close = (seg: Attention, startUs: number, limitUs: number, nextUs?: number): number | undefined => {
    const { aliveUs, heldEndUs } = attention(seg, limitUs)
    let endUs = Math.min(durationUs, heldEndUs + afterUs)
    let nextStartUs = nextUs === undefined ? undefined : Math.max(0, nextUs - beforeUs)
    // 相接处是一次平移：尽量在下一次点击前到位，但不早于这一段最后一次操作就离开。
    if (nextStartUs !== undefined && endUs > nextStartUs) endUs = nextStartUs = Math.min(endUs, Math.max(nextStartUs, aliveUs + afterUs))
    if (endUs > startUs && !existing.some(region => region.startUs < endUs && region.endUs > startUs)) {
      const view = viewOf(seg); const round = (value: number): number => Math.round(value * 1e4) / 1e4
      created.push({ id: options.createId?.() ?? crypto.randomUUID(), startUs, endUs, depth: depthOf(seg, 1) ?? 1, focus: { x: round(view.centerX), y: round(view.centerY) }, origin: 'auto' })
    }
    return nextStartUs
  }
  let seg: Attention | undefined; let startUs = 0
  for (const press of presses) {
    if (seg) {
      const { aliveUs, heldEndUs } = attention(seg, press.us)
      const grown: Attention = { presses: [...seg.presses, press.us], x0: Math.min(seg.x0, press.x), x1: Math.max(seg.x1, press.x), y0: Math.min(seg.y0, press.y), y1: Math.max(seg.y1, press.y) }
      // 来不及平移过去的接连点击，宁可用小一点的倍数一起框住。
      const minDepth = press.us - aliveUs < beforeUs + afterUs ? 1 : RECORDING_ZOOM_DEFAULT_DEPTH
      const scrolled = (scrolls[upperBound(scrolls, aliveUs, self)] ?? Infinity) < press.us
      if (!scrolled && press.us - heldEndUs <= mergeGapUs && depthOf(grown, minDepth) !== undefined) { seg = grown; continue }
      startUs = close(seg, startUs, press.us, press.us)!
    } else startUs = Math.max(0, press.us - beforeUs)
    seg = { presses: [press.us], x0: press.x, x1: press.x, y0: press.y, y1: press.y }
  }
  if (seg) close(seg, startUs, durationUs)
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
