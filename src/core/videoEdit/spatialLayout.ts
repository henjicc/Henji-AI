import polygonClipping, { type MultiPolygon, type Pair } from 'polygon-clipping'
import { activeVideoEditClips, videoEditPictureTransitionsAt, type VideoEditClip, type VideoEditComposition } from './document'
import { buildVideoEditCompositePlan, type VideoEditCompositeNode } from './compositing'
import { videoEditTransitionAmount, videoEditTransitionPictureClips } from './transitions'
import { prepareVideoEditGraphic } from './graphics'
import { evaluateSpatialFrame } from './spatialEvaluation'
import { applySpatialPatch } from './spatialPropagation'
import { spatialMultiply, spatialTransform } from './spatialMatrices'
import { SPATIAL_KEYS, spatialCameraSchema, spatialClipSchema } from './spatialSchema'
import { fitScalarCurve } from '../creativeIntent/fitting'
import { evaluateVideoEditKeyframes, sliceVideoEditCurves, videoEditClipValue, videoEditClipAnimatedValueSchemas, type VideoEditKeyframe, type VideoEditKeyframes } from './keyframes'
import type { SpatialCamera, SpatialCameraNumericKey, SpatialCardGeometry, SpatialClipEdit, SpatialClipFields, SpatialFact, SpatialFrame, SpatialInspection, SpatialLayoutIntent, SpatialOutput, SpatialPatch, SpatialSnapshot, SpatialVec2, SpatialVec3 } from './spatialTypes'

type Clip = VideoEditClip & SpatialClipFields
type LayoutKey = 'x' | 'y' | 'scale' | 'rotation' | typeof SPATIAL_KEYS[number]
const LAYOUT_KEYS: readonly LayoutKey[] = ['x', 'y', 'scale', 'rotation', ...SPATIAL_KEYS]
const CAMERA_ZERO_KEYS = ['offsetX', 'offsetY', 'offsetZ', 'rotationX', 'rotationY', 'rotationZ', 'perspective', 'defocus'] as const
const PROJECTION_TOLERANCE_PX = .25

export class SpatialLayoutError extends Error {
  constructor(message: string, readonly facts: readonly SpatialFact[]) { super(message); this.name = 'SpatialLayoutError' }
}
function reject(message: string, frame: number, clipIds: readonly string[], values: SpatialFact['values'] = {}): never {
  throw new SpatialLayoutError(message, [{ code: 'projection-residual', sequenceFrame: frame, clipIds, message, values }])
}
function composition(snapshot: SpatialSnapshot): VideoEditComposition {
  if (snapshot.revision !== snapshot.composition.revision || snapshot.sequenceId !== snapshot.composition.id) throw new Error('空间快照与序列或内容版本不一致，请重新读取。')
  return snapshot.composition as VideoEditComposition
}
function cameraOf(value: Readonly<VideoEditComposition>): SpatialCamera | undefined { return (value as Readonly<VideoEditComposition> & { spatialCamera?: SpatialCamera }).spatialCamera }
function value(clip: Clip, key: LayoutKey, frame: number): number {
  return SPATIAL_KEYS.some(k => k === key) ? clip.spatial?.enabled && !clip.disabledIntrinsicSections?.includes('motion') ? evaluateVideoEditKeyframes((clip.curves as Record<string, VideoEditKeyframes> | undefined)?.[key], frame - clip.start, clip[key] ?? 0) : 0 : videoEditClipValue(clip, key as 'x' | 'y' | 'scale' | 'rotation', frame)
}
function frameOf(base: VideoEditComposition, at: number, output: SpatialOutput, edits: readonly SpatialClipEdit[] = [], camera?: SpatialCamera | null): SpatialFrame {
  // 平面输入也需参考几何；仅在求解快照中开启零空间值，休眠空间数据不能参与试解。
  const prepared = { ...base, clips: base.clips.map((source): VideoEditClip => {
    const clip = source as Clip
    if (clip.spatial?.enabled || clip.kind === 'audio' || clip.kind === 'adjustment') return clip
    const curves = { ...clip.curves }
    for (const key of SPATIAL_KEYS) delete (curves as Record<string, VideoEditKeyframes>)[key]
    return { ...clip, depth: 0, rotationX: 0, rotationY: 0, anchorDepth: 0, spatial: { enabled: true }, curves }
  }) }
  const next = applySpatialPatch({ composition: prepared, sequenceId: base.id, revision: base.revision }, { sequenceId: base.id, expectedRevision: base.revision, clips: edits, ...(camera === undefined ? {} : { camera: { value: camera } }), achievedParallaxRatio: 1, maxProjectionErrorPx: 0, facts: [] })
  return evaluateSpatialFrame(next, at, output, 'final')
}
function cardOf(frame: SpatialFrame, id: string): SpatialCardGeometry {
  const card = frame.cards.find(value => value.clipId === id)
  if (!card || !card.visiblePolygon.length || card.behindCamera) reject('目标未入画或位于镜头后方，请选择有效参考帧。', frame.sequenceFrame, [id])
  return card
}
function polygon(points: readonly SpatialVec2[]): MultiPolygon {
  if (points.length < 3) return []
  const ring: Pair[] = points.map(([x, y]) => [x, y]); ring.push([points[0][0], points[0][1]])
  return [[ring]]
}
export function spatialPolygonArea(polygons: MultiPolygon): number {
  return polygons.reduce((total, rings) => total + rings.reduce((sum, ring, index) => {
    let twice = 0
    for (let i = 0; i < ring.length - 1; i++) twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return sum + (index === 0 ? 1 : -1) * Math.abs(twice) / 2
  }, 0), 0)
}
/** 结构查询只证明静态满幅不透明矩形；媒体 alpha 与作者输出必须留给实际渲染观察。 */
function opaque(clip: VideoEditClip, at: number): boolean {
  if (videoEditClipValue(clip, 'opacity', at) !== 1 || clip.effects?.some(effect => effect.enabled && effect.amount > 0) || clip.follow) return false
  const graphic = clip.graphic
  if (clip.kind !== 'graphic' || !graphic || graphic.objects.length !== 1) return false
  const object = graphic.objects[0], p = prepareVideoEditGraphic(graphic).objects[0].parameters.values
  return object.kind === 'rect' && object.visible !== false && !object.curves && p.x === 0 && p.y === 0 && p.width === graphic.width && p.height === graphic.height && p.rotation === 0 && p.opacity === 1 && p.radius === 0 && Array.isArray(p.fill) && p.fill[3] === 1
}

/** 保留调整层屏障与转场原子性，只对同级连续空间项按几何中心视深排序。 */
function drawOrder(snapshot: SpatialSnapshot, frame: SpatialFrame): string[] {
  const base = composition(snapshot), cards = new Map(frame.cards.map(card => [card.clipId, card]))
  const tree = buildVideoEditCompositePlan(activeVideoEditClips(base, frame.sequenceFrame), videoEditPictureTransitionsAt(base, frame.sequenceFrame))
  const visit = (nodes: readonly VideoEditCompositeNode[]): string[] => {
    const output: string[] = [], group: { ids: string[]; depth: number; ordinal: number }[] = []
    const flush = (): void => { group.sort((a, b) => b.depth - a.depth || a.ordinal - b.ordinal); output.push(...group.flatMap(item => item.ids)); group.length = 0 }
    for (const node of nodes) {
      if (node.kind === 'adjustment') { flush(); output.push(...visit(node.children), node.clip.id); continue }
      const ids = node.kind === 'clip' ? [node.clip.id] : videoEditTransitionPictureClips(node.window).map(clip => clip.id)
      const members = ids.map(id => cards.get(id)).filter((card): card is SpatialCardGeometry => !!card)
      const spatial = ids.every(id => (base.clips.find(clip => clip.id === id) as Clip | undefined)?.spatial?.enabled)
      if (!spatial || !members.length) { flush(); output.push(...ids); continue }
      const amount = node.kind === 'transition' ? videoEditTransitionAmount(node.window, frame.sequenceFrame) : 0
      group.push({ ids, depth: members.length === 2 ? members[0].centerViewDepth * (1 - amount) + members[1].centerViewDepth * amount : members[0].centerViewDepth, ordinal: Math.min(...members.map(card => card.ordinal)) })
    }
    flush(); return output
  }
  return visit(tree)
}
export function spatialCoverage(card: SpatialCardGeometry, occluders: readonly SpatialCardGeometry[]): MultiPolygon {
  const surface = polygon(card.screenPolygon), blockers = occluders.map(value => polygon(value.screenPolygon)).filter(value => value.length)
  if (!surface.length || !blockers.length) return []
  let union: MultiPolygon = []
  for (let index = 0; index < blockers.length; index += 128) { const partial = polygonClipping.union(blockers[index], ...blockers.slice(index + 1, index + 128)); union = union.length ? polygonClipping.union(union, partial) : partial }
  return polygonClipping.intersection(surface, union)
}
/** 二维屏幕覆盖项不经过序列相机，但同样会遮住空间层；几何仍委托同一求值器。 */
export function spatialOcclusionGeometry(snapshot: SpatialSnapshot, frame: SpatialFrame): readonly SpatialCardGeometry[] {
  const base = composition(snapshot)
  const compounds = new Map(videoEditPictureTransitionsAt(base, frame.sequenceFrame).flatMap(window => videoEditTransitionPictureClips(window).map(clip => [clip.id, window.transition.id] as const)))
  const cards = frame.cards.map(card => compounds.has(card.clipId) && !card.compoundGroup ? { ...card, compoundGroup: compounds.get(card.clipId) } : card)
  const flatIds = new Set(base.clips.filter(clip => !(clip as Clip).spatial?.enabled && clip.kind !== 'audio' && clip.kind !== 'adjustment').map(clip => clip.id))
  if (!flatIds.size) return cards
  const clips = base.clips.map(clip => {
    const curves = { ...clip.curves }
    for (const key of SPATIAL_KEYS) delete (curves as Record<string, VideoEditKeyframes>)[key]
    return { ...clip, depth: 0, rotationX: 0, rotationY: 0, anchorDepth: 0, spatial: { enabled: true }, curves }
  })
  const flat = evaluateSpatialFrame({ ...base, clips, spatialCamera: undefined }, frame.sequenceFrame, frame.output, 'final')
  return [...cards, ...flat.cards.filter(card => flatIds.has(card.clipId)).map(card => compounds.has(card.clipId) ? { ...card, compoundGroup: compounds.get(card.clipId) } : card)]
}
export function inspectSpatialFrame(snapshot: SpatialSnapshot, frame: SpatialFrame): SpatialInspection {
  const base = composition(snapshot), geometry = spatialOcclusionGeometry(snapshot, frame), order = drawOrder(snapshot, { ...frame, cards: geometry }), byId = new Map(base.clips.map(clip => [clip.id, clip]))
  const spatialCards = frame.cards.map(card => geometry.find(item => item.clipId === card.clipId)!)
  const cards = spatialCards.map(card => {
    const clip = byId.get(card.clipId)!, rank = order.indexOf(card.clipId)
    const above = geometry.filter(other => order.indexOf(other.clipId) > rank && !(card.compoundGroup && other.compoundGroup === card.compoundGroup) && spatialPolygonArea(spatialCoverage(card, [other])) > 0)
    const adjustment = activeVideoEditClips(base, frame.sequenceFrame).some(clip => clip.kind === 'adjustment')
    const known = above.filter(other => !other.compoundGroup && !other.ambiguousDepth && other.cocRadiusPx === 0 && !adjustment && opaque(byId.get(other.clipId)!, frame.sequenceFrame))
    const area = spatialPolygonArea(polygon(card.screenPolygon)), covered = spatialPolygonArea(spatialCoverage(card, known))
    const uncertain = above.length !== known.length || clip.kind === 'code' || card.ambiguousDepth || !!card.compoundGroup || adjustment
    const hidden = area === 0 || covered >= area - 1e-12
    const proven = !uncertain && opaque(clip, frame.sequenceFrame)
    return { clipId: card.clipId, drawOrder: rank, visibleFraction: uncertain ? null : area > 0 ? Math.max(0, 1 - covered / area) : 0, occludedBy: above.map(value => value.clipId), visibility: clip.kind === 'code' ? 'unknown' as const : hidden && !card.ambiguousDepth ? 'proven-occluded' as const : proven ? 'proven-visible' as const : uncertain ? 'unknown' as const : 'estimated' as const, approximation: 'layer-center' as const, sceneBoundsSource: 'none' as const }
  })
  return { frame: { ...frame, cards: spatialCards }, cards }
}

function staticEdit(clip: Clip, at: number, values: SpatialClipEdit['values']): SpatialClipEdit {
  // 计算姿态时移除被覆盖通道，避免旧动画盖过本次试解值；持久合并另行处理。
  const curves = { ...clip.curves }
  for (const key of LAYOUT_KEYS) delete (curves as Record<string, VideoEditKeyframes>)[key]
  return { clipId: clip.id, values: { ...Object.fromEntries(LAYOUT_KEYS.map(key => [key, value(clip, key, at)])), ...values, spatial: { enabled: true } }, curves }
}
function quad(card: SpatialCardGeometry, frame: SpatialFrame): SpatialVec2[] {
  const matrix = spatialMultiply(frame.camera.projectionWebGpu, frame.camera.view)
  return card.originalQuad.map(point => { const p = spatialTransform(matrix, point); return [(p[0] + 1) / 2, (1 - p[1]) / 2] })
}
function projectionError(a: SpatialCardGeometry, fa: SpatialFrame, b: SpatialCardGeometry, fb: SpatialFrame): number {
  const qa = quad(a, fa), qb = quad(b, fb)
  return qa.reduce((maximum, point, i) => { const error = Math.hypot((point[0] - qb[i][0]) * fa.output.width, (point[1] - qb[i][1]) * fa.output.height); return Number.isFinite(error) ? Math.max(maximum, error) : Number.MAX_VALUE }, 0)
}
function splice(points: VideoEditKeyframes | undefined, fallback: number, range: readonly [number, number], duration: number, generated: VideoEditKeyframes): VideoEditKeyframes {
  const [start, end] = range
  const before = start > 0 ? sliceVideoEditCurves({ v: points?.length ? points : [{ time: 0, value: fallback, interpolation: 'hold' }] }, 0, start)?.v ?? [] : []
  const after = end + 1 < duration ? (sliceVideoEditCurves({ v: points?.length ? points : [{ time: 0, value: fallback, interpolation: 'hold' }] }, end + 1, duration - end - 1)?.v ?? []).map(point => ({ ...point, time: point.time + end + 1 })) : []
  return [...before, ...generated, ...after]
}
function validateEdit(edit: SpatialClipEdit, at: number): void {
  for (const key of LAYOUT_KEYS) if (edit.values[key] !== undefined) {
    const schema = SPATIAL_KEYS.some(k => k === key) ? spatialClipSchema.shape[key as typeof SPATIAL_KEYS[number]].unwrap() : videoEditClipAnimatedValueSchemas[key as 'x' | 'y' | 'scale' | 'rotation']
    if (!schema.safeParse(edit.values[key]).success) reject('保持构图需要的数值超出片段可编辑范围，请降低视差比或调整参考构图。', at, [edit.clipId], { key, value: edit.values[key]! })
  }
}
function arrangeAt(base: VideoEditComposition, ids: readonly string[], focusId: string, ratio: number, at: number, output: SpatialOutput): { edits: SpatialClipEdit[]; error: number; achieved: number } {
  const original = frameOf(base, at, output), focus = cardOf(original, focusId), reference = ids.length === 1 ? 0 : ids.indexOf(focusId) / (ids.length - 1)
  const edits = ids.map((id, index): SpatialClipEdit => {
    const clip = base.clips.find(clip => clip.id === id) as Clip, card = cardOf(original, id)
    const desired = focus.centerViewDepth * ratio ** (reference - (ids.length === 1 ? 0 : index / (ids.length - 1)))
    if (!(desired > 0 && Number.isFinite(desired))) reject('请求的视差比使层位越过近裁剪面。', at, ids, { parallaxRatio: ratio, desiredDepth: desired, near: original.camera.near })
    const factor = desired / card.centerViewDepth, camera = original.camera.position
    const anchor = card.anchorWorld.map((component, axis) => camera[axis] + factor * (component - camera[axis])) as unknown as SpatialVec3
    const a = output.displayWidth / output.displayHeight
    const edit = staticEdit(clip, at, { x: anchor[0] / a, y: -anchor[1], depth: camera[2] + factor * (value(clip, 'depth', at) - camera[2]), scale: value(clip, 'scale', at) * factor, anchorDepth: value(clip, 'anchorDepth', at) * factor })
    validateEdit(edit, at); return edit
  })
  const result = frameOf(base, at, output, edits), depths = ids.map(id => cardOf(result, id).centerViewDepth)
  const error = ids.reduce((maximum, id) => Math.max(maximum, projectionError(cardOf(original, id), original, cardOf(result, id), result)), 0)
  if (error > PROJECTION_TOLERANCE_PX) reject('当前倾斜或裁剪构图无法在误差范围内保持，请调整参考帧。', at, ids, { maxProjectionErrorPx: error, tolerancePx: PROJECTION_TOLERANCE_PX })
  return { edits, error, achieved: depths.reduce((maximum, depth) => Math.max(maximum, depth), -Infinity) / depths.reduce((minimum, depth) => Math.min(minimum, depth), Infinity) }
}

function bounds(points: readonly SpatialVec2[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
/** 用原生二维旋转与缩放匹配尾点可见包围框；不能表示的倾斜构图返回残差，不伪造角点精确保持。 */
function flattenEdit(base: VideoEditComposition, clip: Clip, original: SpatialFrame, output: SpatialOutput): SpatialClipEdit {
  const at = original.sequenceFrame, source = bounds(quad(cardOf(original, clip.id), original))
  const zero = { depth: 0, rotationX: 0, rotationY: 0, anchorDepth: 0, x: 0, y: 0, scale: 1, rotation: 0 }
  const nativeFrame = frameOf(base, at, output, [staticEdit(clip, at, zero)], null), native = bounds(quad(cardOf(nativeFrame, clip.id), nativeFrame))
  const w = native.width * output.width, h = native.height * output.height, ratio = source.width * output.width / (source.height * output.height)
  const theta = Math.atan2(w - ratio * h, ratio * w - h) * 180 / Math.PI
  const current = value(clip, 'rotation', at)
  const angles = [current, ...[-1, 1].flatMap(sign => [-360, -180, 0, 180, 360].map(turn => sign * theta + turn))].filter(angle => angle >= -360 && angle <= 360)
  const candidates = angles.map(rotation => {
    const unit = staticEdit(clip, at, { ...zero, rotation }), trial = frameOf(base, at, output, [unit], null), b = bounds(quad(cardOf(trial, clip.id), trial))
    const scale = source.height / b.height, error = Math.abs(b.width * scale - source.width) * output.width
    return { rotation, scale, error }
  })
  const chosen = candidates.filter(candidate => candidate.error <= PROJECTION_TOLERANCE_PX).sort((a, b) => Math.abs(a.rotation - current) - Math.abs(b.rotation - current) || a.error - b.error)[0]
  if (!chosen || chosen.error > PROJECTION_TOLERANCE_PX) reject('原构图无法用平面缩放和旋转保持主体包围框。', at, [clip.id], { maxProjectionErrorPx: chosen?.error ?? Number.MAX_VALUE })
  const edit = staticEdit(clip, at, { ...zero, rotation: chosen.rotation, scale: chosen.scale })
  const trial = frameOf(base, at, output, [edit], null), b = bounds(quad(cardOf(trial, clip.id), trial))
  edit.values.x = source.x + source.width / 2 - b.x - b.width / 2
  edit.values.y = source.y + source.height / 2 - b.y - b.height / 2
  validateEdit(edit, at); return edit
}

function boundAt<T>(points: readonly { time: number; value: T }[] | undefined, at: number, fallback: T): T {
  let result = fallback
  for (const point of points ?? []) { if (point.time > at) break; result = point.value }
  return result
}
function bindRange<K extends 'framing' | 'aim' | 'focus'>(camera: SpatialCamera, original: SpatialCamera | undefined, key: K, range: readonly [number, number], begin: NonNullable<NonNullable<SpatialCamera['bindings']>[K]>[number]['value'], end?: NonNullable<NonNullable<SpatialCamera['bindings']>[K]>[number]['value']): void {
  const source = original?.bindings?.[key] ?? [], fallback = key === 'framing' ? original?.framing?.target ?? null : key === 'aim' ? original?.aim ?? null : original?.focus ?? null
  const events = [...source.filter(p => p.time < range[0] || p.time > range[1]), { time: range[0], value: begin, interpolation: 'hold' as const }, ...(end === undefined ? [] : [{ time: range[1], value: end, interpolation: 'hold' as const }])]
  if (range[0] > 0 && !events.some(p => p.time === 0)) events.push({ time: 0, value: boundAt(source, 0, fallback), interpolation: 'hold' })
  if (!events.some(p => p.time === range[1] + 1)) events.push({ time: range[1] + 1, value: boundAt(source, range[1] + 1, fallback), interpolation: 'hold' })
  camera.bindings = { ...camera.bindings, [key]: events.sort((a, b) => a.time - b.time) }
}

/** 纯计算入口由既有运动 Worker 调用；不读取实例、不写文件，也不执行作者源码。 */
export async function planSpatialLayout(snapshot: SpatialSnapshot, intent: SpatialLayoutIntent, output: SpatialOutput, signal: AbortSignal): Promise<SpatialPatch> {
  signal.throwIfAborted()
  const base = composition(snapshot), ids = intent.clipIds
  if (!ids.length || new Set(ids).size !== ids.length || !ids.includes(intent.focusClipId)) throw new Error('clipRefs 不得重复，focusRef 必须属于所选片段。')
  for (const id of ids) {
    const clip = base.clips.find(clip => clip.id === id)
    if (!clip || clip.kind === 'audio' || clip.kind === 'adjustment') throw new Error(`空间布局目标不存在或不是画面片段：${id}。`)
    if (base.tracks.find(track => track.index === clip.track)?.locked) throw new Error('所选片段轨道已锁定。')
    if (clip.disabledIntrinsicSections?.includes('motion')) throw new Error('所选片段的运动分区已关闭，请先启用。')
  }
  if (intent.kind !== 'flatten' && (!Number.isFinite(intent.parallaxRatio) || intent.parallaxRatio < 1)) throw new Error('parallaxRatio 必须为大于等于 1 的有限数。')
  const range = intent.range, at = intent.kind === 'arrange' ? intent.referenceFrame : intent.range[0]
  if (!Number.isSafeInteger(at) || at < 0 || range && (!range.every(Number.isSafeInteger) || range[0] < 0 || range[1] <= range[0])) throw new Error('range 必须为非空递增整数序列帧区间。')
  for (const id of ids) { const clip = base.clips.find(clip => clip.id === id)!; if (at < clip.start || at >= clip.start + clip.duration || range && (range[0] < clip.start || range[1] >= clip.start + clip.duration)) throw new Error('参考帧与完整过渡区间必须落在所有所选片段内。') }
  if (range) for (const id of ids) {
    const clip = base.clips.find(clip => clip.id === id) as Clip
    // enabled 没有动画通道；激活休眠非零数据会改变区间外画面，不能伪装成局部修改。
    if (!clip.spatial?.enabled && (range[0] > clip.start || range[1] < clip.start + clip.duration - 1) && SPATIAL_KEYS.some(key => (clip[key] ?? 0) !== 0 || clip.curves?.[key]?.some(point => point.value !== 0))) reject('片段含休眠的非零空间数据，局部开启会改变区间外画面。请先明确开启空间，或将范围覆盖整个片段。', at, [id])
  }
  const initial = frameOf(base, at, output), currentCamera = cameraOf(base)
  const camera: SpatialCamera = structuredClone(currentCamera ?? {})
  let maxError = 0, achieved = 1
  const samples = new Map<string, Map<LayoutKey, VideoEditKeyframes>>(ids.map(id => [id, new Map()]))
  const endpoint = intent.kind === 'flatten' ? undefined : arrangeAt(base, ids, intent.focusClipId, intent.parallaxRatio, at, output)
  if (endpoint) { maxError = endpoint.error; achieved = endpoint.achieved }
  if (!range) {
    const edits = endpoint!.edits.map(edit => {
      const clip = base.clips.find(clip => clip.id === edit.clipId) as Clip
      const factor = edit.values.scale! / value(clip, 'scale', at), curves: Record<string, VideoEditKeyframes> = { ...clip.curves }
      if (!clip.spatial?.enabled) for (const key of SPATIAL_KEYS) delete curves[key]
      for (const key of ['x', 'y', 'scale', 'depth', 'anchorDepth'] as const) {
        const points = curves[key]
        if (!points?.length) continue
        const old = value(clip, key, at), offset = edit.values[key]! - factor * old
        const transform = (v: VideoEditKeyframe['value']): number => {
          if (typeof v !== 'number') throw new Error('空间布局需要数值动画。')
          return factor * v + offset
        }
        curves[key] = points.map(point => {
          const { source: _source, reframeOrigin: _reframeOrigin, duckingOrigin: _duckingOrigin, ...manual } = point
          return { ...manual, value: transform(point.value), ...(point.easeValues ? { easeValues: point.easeValues.map(transform) as [number, number] } : {}) }
        })
      }
      return { ...edit, curves }
    })
    return { sequenceId: snapshot.sequenceId, expectedRevision: snapshot.revision, clips: edits, camera: { value: { ...camera, focus: { kind: 'clip', clipId: intent.focusClipId }, bindings: { ...camera.bindings, focus: undefined } } }, achievedParallaxRatio: achieved, maxProjectionErrorPx: maxError, facts: initial.facts }
  }
  const [start, end] = range
  const cameraPoints = new Map<SpatialCameraNumericKey, VideoEditKeyframes>()
  const addCamera = (key: SpatialCameraNumericKey, frame: number, v: number): void => { const points = cameraPoints.get(key) ?? []; points.push({ time: frame, value: v, interpolation: 'linear' }); cameraPoints.set(key, points) }
  const duration = Math.max(base.clips.reduce((maximum, clip) => Math.max(maximum, clip.start + clip.duration), end + 2), Object.values(currentCamera?.curves ?? {}).reduce((maximum, points) => Math.max(maximum, (points.at(-1)?.time ?? 0) + 1), 1))
  const cameraValue = (key: typeof CAMERA_ZERO_KEYS[number], frame: number): number => evaluateVideoEditKeyframes(currentCamera?.curves?.[key], frame, currentCamera?.[key] ?? 0)
  const focusCard = cardOf(initial, intent.focusClipId)
  if (intent.kind === 'expand') {
    if (!initial.flatIdentity) reject('展开起点必须是规范平面构图，请先压平或选择平面起点。', start, ids)
    camera.framing = currentCamera?.framing ?? { target: { kind: 'clip', clipId: intent.focusClipId }, heightFraction: focusCard.screenBounds.height }
    for (let frame = start; frame <= end; frame++) addCamera('framingHeightFraction', frame, focusCard.screenBounds.height)
    bindRange(camera, currentCamera, 'framing', range, { kind: 'clip', clipId: intent.focusClipId })
    bindRange(camera, currentCamera, 'focus', range, { kind: 'clip', clipId: intent.focusClipId })
    bindRange(camera, currentCamera, 'aim', range, { kind: 'point', point: [0, 0, 0] })
    const framed = frameOf(base, start, output, [], { ...camera, curves: { ...camera.curves, framingHeightFraction: [{ time: start, value: focusCard.screenBounds.height, interpolation: 'hold' }] } })
    for (const [axis, key] of ['offsetX', 'offsetY', 'offsetZ'].entries()) camera[key as 'offsetX' | 'offsetY' | 'offsetZ'] = initial.camera.position[axis] - framed.camera.position[axis]
  } else if (intent.kind === 'flatten') {
    const target = boundAt(currentCamera?.bindings?.framing, start, currentCamera?.framing?.target ?? null)
    if (target) {
      const source = target.kind === 'clip' ? cardOf(initial, target.clipId).originalQuad : target.kind === 'bounds' ? [target.bounds.min, target.bounds.max] : [target.point]
      const min = [0, 1, 2].map(axis => Math.min(...source.map(p => p[axis]))) as unknown as SpatialVec3
      const max = [0, 1, 2].map(axis => Math.max(...source.map(p => p[axis]))) as unknown as SpatialVec3
      const boundsTarget = { kind: 'bounds' as const, bounds: { min, max } }
      bindRange(camera, currentCamera, 'framing', range, boundsTarget, null)
      for (let frame = start; frame <= end; frame++) {
        const u = (frame - start) / (end - start), p = u * u * (3 - 2 * u), a = output.displayWidth / output.displayHeight
        for (const [bound, from] of [['Min', min], ['Max', max]] as const) for (const [axis, axisName] of ['X', 'Y', 'Z'].entries()) {
          const destination = axis === 0 ? (bound === 'Min' ? -a / 2 : a / 2) : axis === 1 ? (bound === 'Min' ? -.5 : .5) : 0
          addCamera(`framing${bound}${axisName}` as SpatialCameraNumericKey, frame, from[axis] + p * (destination - from[axis]))
        }
        const height = evaluateVideoEditKeyframes(currentCamera?.curves?.framingHeightFraction, start, currentCamera?.framing?.heightFraction ?? focusCard.screenBounds.height)
        addCamera('framingHeightFraction', frame, height + p * (1 - height))
      }
    } else bindRange(camera, currentCamera, 'framing', range, null, null)
    const aim = boundAt(currentCamera?.bindings?.aim, start, currentCamera?.aim ?? null)
    bindRange(camera, currentCamera, 'aim', range, aim ? { kind: 'point', point: initial.camera.resolvedAim } : null, null)
    bindRange(camera, currentCamera, 'focus', range, { kind: 'distance', distance: initial.camera.focusDistance }, null)
    for (let frame = start; frame <= end; frame++) {
      const u = (frame - start) / (end - start), p = u * u * (3 - 2 * u)
      if (aim) for (const [axis, name] of ['aimX', 'aimY', 'aimZ'].entries()) addCamera(name as SpatialCameraNumericKey, frame, initial.camera.resolvedAim[axis] * (1 - p))
      addCamera('focusDistance', frame, initial.camera.focusDistance + p * (80 * output.displayWidth / output.displayHeight / 36 - initial.camera.focusDistance))
    }
  } else bindRange(camera, currentCamera, 'focus', range, { kind: 'clip', clipId: intent.focusClipId })
  const solvePoseAt = (frame: number): SpatialClipEdit[] => {
    signal.throwIfAborted()
    const u = Math.max(0, Math.min(1, (frame - start) / (end - start))), p = u * u * (3 - 2 * u)
    if (intent.kind === 'arrange') return arrangeAt(base, ids, intent.focusClipId, intent.parallaxRatio ** p, frame, output).edits
    if (intent.kind === 'expand') {
      const arranged = arrangeAt(base, ids, intent.focusClipId, intent.parallaxRatio ** p, frame, output)
      return arranged.edits
    }
    const oldFrame = frameOf(base, frame, output)
    return ids.map(id => {
      const clip = base.clips.find(clip => clip.id === id) as Clip, destination = flattenEdit(base, clip, oldFrame, output)
      const values = Object.fromEntries(LAYOUT_KEYS.map(key => [key, frame === end ? destination.values[key] ?? value(clip, key, frame) : value(clip, key, frame) + p * ((destination.values[key] ?? value(clip, key, frame)) - value(clip, key, frame))]))
      return staticEdit(clip, frame, values)
    })
  }
  const poseCache = new Map<number, SpatialClipEdit[]>()
  const poseAt = (frame: number): SpatialClipEdit[] => { const cached = poseCache.get(frame); if (cached) return cached; const result = solvePoseAt(frame); poseCache.set(frame, result); return result }
  for (let frame = start; frame <= end; frame++) {
    for (const edit of poseAt(frame)) for (const key of LAYOUT_KEYS) {
      const points = samples.get(edit.clipId)!.get(key) ?? []
      points.push({ time: frame - base.clips.find(c => c.id === edit.clipId)!.start, value: edit.values[key]!, interpolation: 'linear' })
      samples.get(edit.clipId)!.set(key, points)
    }
    for (const key of CAMERA_ZERO_KEYS) {
      if (intent.kind === 'arrange') continue
      const u = (frame - start) / (end - start), p = u * u * (3 - 2 * u)
      const desired = intent.kind === 'flatten' ? 0 : key === 'perspective' ? intent.perspective : camera[key] ?? 0
      const from = intent.kind === 'expand' && key.startsWith('offset') ? desired : cameraValue(key, start)
      addCamera(key, frame, frame === end ? desired : from + p * (desired - from))
    }
    if (frame % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  const edits = ids.map(id => {
    const clip = base.clips.find(clip => clip.id === id) as Clip, curves: Record<string, VideoEditKeyframes> = { ...clip.curves }
    for (const [key, points] of samples.get(id)!) {
      const reference = (local: number): number => poseAt(local + clip.start).find(edit => edit.clipId === id)!.values[key]!
      const fitted = fitScalarCurve(points.map(point => ({ time: point.time, value: point.value as number, hard: point.time === start - clip.start || point.time === end - clip.start || !!curves[key]?.some(p => p.time === point.time && p.interpolation === 'hold') })), .01 / Math.max(output.width, output.height), { cancelled: () => signal.aborted }, reference).points
      curves[key] = splice(curves[key], clip[key] ?? 0, [start - clip.start, end - clip.start], clip.duration, fitted)
    }
    return { clipId: id, values: { spatial: { enabled: true } }, curves } satisfies SpatialClipEdit
  })
  camera.curves = { ...camera.curves }
  for (const [key, points] of cameraPoints) {
    const fallback = key === 'framingHeightFraction' ? currentCamera?.framing?.heightFraction ?? 1 : key === 'focusDistance' ? initial.camera.focusDistance : (currentCamera as Record<string, unknown> | undefined)?.[key] as number | undefined ?? 0
    const fitted = fitScalarCurve(points.map(point => ({ time: point.time, value: point.value as number, hard: point.time === start || point.time === end })), .000001, { cancelled: () => signal.aborted }).points
    camera.curves[key] = splice(currentCamera?.curves?.[key], fallback, range, duration, fitted)
  }
  spatialCameraSchema.parse(camera)
  const patch: SpatialPatch = { sequenceId: snapshot.sequenceId, expectedRevision: snapshot.revision, clips: edits, camera: { value: camera }, achievedParallaxRatio: achieved, maxProjectionErrorPx: maxError, facts: [...initial.facts] }
  const final = frameOf(base, end, output, edits, camera)
  const depths = ids.map(id => cardOf(final, id).centerViewDepth)
  patch.achievedParallaxRatio = depths.reduce((maximum, depth) => Math.max(maximum, depth), -Infinity) / depths.reduce((minimum, depth) => Math.min(minimum, depth), Infinity)
  if (intent.kind === 'flatten') {
    if (!final.flatIdentity) reject('压平尾点未达到规范恒等；请检查未选中的空间层。', end, ids)
    const original = frameOf(base, end, output), a = cardOf(original, intent.focusClipId), b = cardOf(final, intent.focusClipId)
    const error = Math.max(...(['x', 'y', 'width', 'height'] as const).map(key => Math.abs(a.screenBounds[key] - b.screenBounds[key]) * (key === 'x' || key === 'width' ? output.width : output.height)))
    if (error > PROJECTION_TOLERANCE_PX) reject('压平主体构图残差超过允许范围，未提交修改。', end, ids, { maxProjectionErrorPx: error })
    patch.maxProjectionErrorPx = Math.max(maxError, error)
    patch.facts = [...patch.facts, { code: 'projection-residual', sequenceFrame: end, clipIds: ids, message: '压平保持主体包围框；相交轮廓和遮挡采用层中心近似。', values: { maxProjectionErrorPx: error } }]
  }
  for (let frame = start; frame < end; frame++) for (const fraction of [0, .25, .5, .75]) {
    signal.throwIfAborted()
    const t = frame + fraction, expected = frameOf(base, t, output, poseAt(t), camera), actual = frameOf(base, t, output, edits, camera)
    const error = ids.reduce((maximum, id) => Math.max(maximum, projectionError(cardOf(expected, id), expected, cardOf(actual, id), actual)), 0)
    if (error > PROJECTION_TOLERANCE_PX) reject('空间动画在输出帧或曝光子时刻超出投影误差。', t, ids, { maxProjectionErrorPx: error, tolerancePx: PROJECTION_TOLERANCE_PX })
    patch.maxProjectionErrorPx = Math.max(patch.maxProjectionErrorPx, error)
    if (frame % 16 === 0 && fraction === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  signal.throwIfAborted(); return patch
}
