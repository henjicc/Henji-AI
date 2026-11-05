import { spaceClipIsSolid } from '@/core/videoEdit/spatialSchema'
import { spatialDefocusStrength } from './videoEditBuiltinEffectPasses'
import { evaluateSpatialFrame, includeSpatialWorldBounds, SpatialEvaluationError, spatialBoundsCorners, spatialClipPolygon, spatialCocRadius, spatialClipEnabled, spatialClipMatrix } from '@/core/videoEdit/spatialEvaluation'
import { spatialScale, spatialTranslation, spatialMultiply, spatialTransform, spatialInverse, spatialHomogeneous } from '@/core/videoEdit/spatialMatrices'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { requireVideoEditBuiltinEffect, resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { videoEditPictureFilter } from '@/core/videoEdit/clipGeometry'
import { videoEditClipSourceSecondsAt } from '@/core/videoEdit/clipSpeed'
import { videoEditClipMotionBlur, VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES, VIDEO_EDIT_MOTION_BLUR_PLAYBACK_SAMPLES, VIDEO_EDIT_MOTION_BLUR_SHUTTER } from '@/core/videoEdit/motionBlur'
import { activeVideoEditEffects, buildVideoEditCompositePlan, type VideoEditCompositeNode } from '@/core/videoEdit/compositing'
import { videoEditPictureTransitionsAt } from '@/core/videoEdit/clipGeometry'
import { videoEditTransitionAmount, videoEditTransitionPictureClips } from '@/core/videoEdit/transitions'
import type { SpatialCardGeometry, SpatialFrame, SpatialRect, SpatialVec3, SpatialMat4, SpatialVec2 } from '@/core/videoEdit/spatialTypes'
import type { SpatialExposurePlan, SpatialFrameRequest, SpatialGroupPlan, SpatialMaterialPlan, SpatialSample, SpatialSceneSample } from './videoEditSpatialContracts'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { videoEditTextResolution } from './videoEditTextSurface'
import { VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES, videoEditThreeTargetBytes } from './videoEditGpuBudget'

export type SpatialCompositionAt = (frame: number) => Readonly<VideoEditComposition>

/** 输出圆盘经中心投影逆 Jacobian 换成参考平面上的两轴长度。 */
function referenceDefocusRadius(card: SpatialCardGeometry, plane: SpatialMat4, request: SpatialFrameRequest): SpatialVec2 {
  if (card.cocRadiusPx === 0) return [0, 0]
  const { output } = request
  const worldFromReference = spatialMultiply(spatialTranslation(-output.displayWidth / output.displayHeight / 2, .5, 0), spatialScale(1 / output.displayHeight, -1 / output.displayHeight, 1))
  const projection = spatialMultiply(card.clipFromUv, spatialInverse(plane), worldFromReference)
  const center = spatialTransform(plane, [.5, .5, 0])
  const point: SpatialVec3 = [center[0] * output.displayHeight + output.displayWidth / 2, -center[1] * output.displayHeight + output.displayHeight / 2, 0]
  const q = spatialHomogeneous(projection, point), w2 = q[3] * q[3]
  const a = (projection[0] * q[3] - q[0] * projection[3]) / w2 * output.width / 2
  const b = (projection[4] * q[3] - q[0] * projection[7]) / w2 * output.width / 2
  const c = -(projection[1] * q[3] - q[1] * projection[3]) / w2 * output.height / 2
  const d = -(projection[5] * q[3] - q[1] * projection[7]) / w2 * output.height / 2
  const determinant = a * d - b * c
  if (determinant === 0) return [0, 0]
  return [Math.hypot(d, b), Math.hypot(c, a)].map(length => card.cocRadiusPx * length / Math.abs(determinant)) as unknown as SpatialVec2
}
function sceneGeometry(frame: SpatialFrame, index: number, scenes: readonly SpatialSceneSample[] | undefined, worldScenes: ReadonlySet<string>): SpatialFrame {
  if (!scenes) return frame
  const observations = new Map(scenes.filter(scene => scene.sampleIndex === index).map(scene => [scene.clipId, scene]))
  const missing = frame.cards.filter(card => worldScenes.has(card.clipId) && !observations.has(card.clipId)).map(card => card.clipId)
  if (missing.length) throw new SpatialEvaluationError([{ code: 'unknown-scene', clipIds: missing, sequenceFrame: frame.sequenceFrame, message: '作者场景缺少同一曝光样本的真实包围框。', values: { sampleIndex: index } }])
  frame = includeSpatialWorldBounds(frame, [...observations.values()].flatMap(scene => scene.worldBounds ? [scene.worldBounds] : []))
  const cards = frame.cards.map(card => {
    const observed = observations.get(card.clipId)
    if (!observed) return card
    const bounds = observed.worldBounds
    if (!bounds) return { ...card, visiblePolygon: [], screenPolygon: [], screenBounds: { x: 0, y: 0, width: 0, height: 0 }, cocRadiusPx: 0 }
    const points = spatialBoundsCorners(bounds)
    const centerWorld = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) as unknown as SpatialVec3
    const depths = points.map(point => -spatialTransform(frame.camera.view, point)[2])
    const matrix = spatialMultiply(frame.camera.projectionWebGpu, frame.camera.view)
    const visible = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
      .flatMap(face => spatialClipPolygon(face.map(vertex => points[vertex]), matrix))
    const projected = visible.map(point => spatialTransform(matrix, point))
    const xs = projected.map(point => (point[0] + 1) / 2), ys = projected.map(point => (1 - point[1]) / 2)
    const left = Math.max(0, Math.min(...xs)), right = Math.min(1, Math.max(...xs))
    const top = Math.max(0, Math.min(...ys)), bottom = Math.min(1, Math.max(...ys))
    const centerViewDepth = -spatialTransform(frame.camera.view, centerWorld)[2]
    const radii = depths.filter(depth => depth > frame.camera.near).map(depth => spatialCocRadius(frame.camera, depth, frame.output, frame.sequenceFrame))
    return { ...card, centerWorld, centerViewDepth, viewDepthRange: [Math.min(...depths), Math.max(...depths)] as const,
      screenBounds: visible.length ? { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) } : { x: 0, y: 0, width: 0, height: 0 },
      cocRadiusPx: centerViewDepth > frame.camera.near ? spatialCocRadius(frame.camera, centerViewDepth, frame.output, frame.sequenceFrame) : 0,
      cocRangePx: radii.length ? [Math.min(...radii), Math.max(...radii)] as const : [0, 0] as const, behindCamera: Math.max(...depths) <= 0 }
  })
  return { ...frame, cards }
}
type ExposureItem = { id: string; clips: string[]; node: VideoEditCompositeNode }
function depthOrder(items: readonly ExposureItem[], frame: SpatialFrame): string[] {
  const geometry = new Map(frame.cards.map(card => [card.clipId, card]))
  return items.map((entry, ordinal) => {
    const cards = entry.clips.map(id => geometry.get(id)).filter((card): card is SpatialCardGeometry => Boolean(card))
    const amount = entry.node.kind === 'transition' ? videoEditTransitionAmount(entry.node.window, frame.sequenceFrame) : 0
    const depth = cards.length === 2 ? cards[0].centerViewDepth * (1 - amount) + cards[1].centerViewDepth * amount : cards[0]?.centerViewDepth ?? 0
    return { id: entry.id, ordinal, depth }
  }).sort((a, b) => b.depth - a.depth || a.ordinal - b.ordinal).map(entry => entry.id)
}
function changesOrder(orders: readonly (readonly string[])[]): boolean {
  return orders.some(order => order.some((id, index) => id !== orders[0][index]))
}
function distance(a: SpatialCardGeometry, b: SpatialCardGeometry, request: SpatialFrameRequest): number {
  let maximum = 0
  for (const uv of [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as const) {
    const left = spatialTransform(a.clipFromUv, uv), right = spatialTransform(b.clipFromUv, uv)
    maximum = Math.max(maximum, Math.hypot((left[0] - right[0]) * request.output.width / 2, (left[1] - right[1]) * request.output.height / 2))
  }
  return maximum
}
function shutterRange(request: SpatialFrameRequest): readonly [number, number] {
  const center = request.sequenceFrame
  // 和二维同一个方向：快门在当前帧结束，拖影只留在身后。
  let start = Math.max(0, center - VIDEO_EDIT_MOTION_BLUR_SHUTTER), end = center
  const cut = (time: number): void => { if (time <= center) start = Math.max(start, time); else end = Math.min(end, time) }
  const visible = videoEditPictureFilter(request.composition)
  const transitions = videoEditPictureTransitionsAt(request.composition, center)
  for (const window of transitions) { cut(window.start); cut(window.end) }
  const handles = new Set(transitions.flatMap(window => videoEditTransitionPictureClips(window).map(clip => clip.id)))
  for (const clip of request.composition.clips) {
    if (!visible.has(clip) || clip.kind === 'audio') continue
    if (!handles.has(clip.id)) { cut(clip.start); cut(clip.start + clip.duration) }
    for (const points of Object.values(clip.curves ?? {})) for (let index = 1; index < points.length; index++) if (points[index - 1].interpolation === 'hold') cut(clip.start + points[index].time)
  }
  for (const points of Object.values(request.composition.spatialCamera?.curves ?? {})) for (let index = 1; index < points.length; index++) if (points[index - 1].interpolation === 'hold') cut(points[index].time)
  for (const points of Object.values(request.composition.spatialCamera?.bindings ?? {})) for (const point of points) cut(point.time)
  return [start, end]
}
/** 文字栅格与代码画布共用的单张纹理技术上限。 */
const SPATIAL_RASTER_LIMIT = 8192
/** 放大不足 5% 不升档：插值放大看不出，也避免恒等附近的快门样本让档位来回切换。 */
const SPATIAL_RASTER_SLACK = 1.05
type Mat2 = readonly [number, number, number, number]
/** 投影映射在 uv 处对 (u, v) 的导数，行是归一化后的 x、y。 */
function projectiveJacobian(matrix: SpatialMat4, u: number, v: number): Mat2 {
  const q = spatialHomogeneous(matrix, [u, v, 0]), w2 = q[3] * q[3]
  return [(matrix[0] * q[3] - q[0] * matrix[3]) / w2, (matrix[4] * q[3] - q[0] * matrix[7]) / w2,
    (matrix[1] * q[3] - q[1] * matrix[3]) / w2, (matrix[5] * q[3] - q[1] * matrix[7]) / w2]
}
function largestSingular([a, b, c, d]: Mat2): number {
  const sum = a * a + b * b + c * c + d * d, det = a * d - b * c
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2)
}
interface MaterialRaster { crop?: SpatialRect; need: number; limit: number }
/**
 * 推近时的材料面栅格：只栅格各曝光样本中可见（含效果扩边与景深溢入画幅）的参考平面区域，
 * 密度取卡片可见部分投影 Jacobian 的最大放大率。视频与图片的档位不超过源像素密度。
 */
function materialRaster(cards: readonly SpatialCardGeometry[], frames: readonly SpatialFrame[], plane: SpatialMat4, request: SpatialFrameRequest, picture: { width: number; height: number }, sourceLimited: boolean, full: SpatialRect, padding: SpatialVec2): MaterialRaster {
  const { output } = request
  const base = Math.max(output.width / output.displayWidth, output.height / output.displayHeight)
  const toReference = (uv: SpatialVec3): readonly [number, number] => {
    const world = spatialTransform(plane, [uv[0], uv[1], 0])
    return [world[0] * output.displayHeight + output.displayWidth / 2, -world[1] * output.displayHeight + output.displayHeight / 2]
  }
  const reference = (u: number, v: number): Mat2 => {
    const [a, b, c, d] = projectiveJacobian(plane, u, v)
    return [a * output.displayHeight, b * output.displayHeight, -c * output.displayHeight, -d * output.displayHeight]
  }
  let uvFromPlane: SpatialMat4
  // 缩放为零的卡片没有可栅格的面积。
  try { uvFromPlane = spatialInverse(plane) } catch { return { need: 1, limit: 1 } }
  // 完整范围含效果扩边；只有扩边伸进画面时也要保留这部分。
  const fullUv = [[full.x, full.y], [full.x + full.width, full.y], [full.x + full.width, full.y + full.height], [full.x, full.y + full.height]]
    .map(([x, y]) => spatialTransform(uvFromPlane, [(x - output.displayWidth / 2) / output.displayHeight, -(y - output.displayHeight / 2) / output.displayHeight, 0]))
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, need = 1
  for (const [index, card] of cards.entries()) {
    const camera = frames[index].camera
    const clipFromWorld = spatialMultiply(camera.projectionWebGpu, camera.view)
    // 画幅外按中心弥散半径扩边：景深会把略在画外的内容带进画面。
    const reach = card.cocRadiusPx + 1
    const padded = spatialMultiply(spatialScale(1 / (1 + 2 * reach / output.width), 1 / (1 + 2 * reach / output.height), 1), clipFromWorld)
    let uvFromWorld: SpatialMat4
    try { uvFromWorld = spatialInverse(card.uvToWorld) } catch { continue }
    for (const point of spatialClipPolygon(fullUv.map(uv => spatialTransform(card.uvToWorld, [uv[0], uv[1], 0])), padded)) {
      const [x, y] = toReference(spatialTransform(uvFromWorld, point))
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
    for (const point of card.visiblePolygon) {
      const uv = spatialTransform(uvFromWorld, point)
      const [a, b, c, d] = projectiveJacobian(card.clipFromUv, uv[0], uv[1])
      const screen: Mat2 = [a * output.width / 2, b * output.width / 2, -c * output.height / 2, -d * output.height / 2]
      const [p, q, r, t] = reference(uv[0], uv[1]), det = p * t - q * r
      if (det === 0) continue
      // 屏幕像素对参考像素的导数 = 屏幕对 uv × (参考对 uv)⁻¹。
      const inverse: Mat2 = [t / det, -q / det, -r / det, p / det]
      const perReference: Mat2 = [screen[0] * inverse[0] + screen[1] * inverse[2], screen[0] * inverse[1] + screen[1] * inverse[3],
        screen[2] * inverse[0] + screen[3] * inverse[2], screen[2] * inverse[1] + screen[3] * inverse[3]]
      const magnification = largestSingular(perReference) / base
      if (Number.isFinite(magnification)) need = Math.max(need, Math.min(magnification, SPATIAL_RASTER_LIMIT))
    }
  }
  let limit = Infinity
  if (sourceLimited) {
    const [p, q, r, t] = reference(.5, .5)
    // 材料面每 uv 的纹素不超过源画面像素（向下取档）：重新栅格不能为视频补出细节。
    limit = 2 ** Math.floor(Math.log2(Math.max(1, Math.min(picture.width / (Math.hypot(p, r) * base), picture.height / (Math.hypot(q, t) * base)))))
  }
  if (!Number.isFinite(left)) return { need: 1, limit }
  const crop = { x: left - padding[0], y: top - padding[1], width: right - left + 2 * padding[0], height: bottom - top + 2 * padding[1] }
  return { crop, need, limit }
}
/**
 * 材料面边界按台阶变化：景深留边按约 19% 一档向上取整，可见裁切向外对齐到整面的八分之一网格。
 * 拉焦、推近时材料面尺寸只在跨台阶时才变，跨帧缓存才命中；多出的只是透明边。
 */
function steppedRadius(value: number): number { return value > 0 ? 2 ** (Math.ceil(Math.log2(value) * 4) / 4) : 0 }
function snapCrop(crop: SpatialRect, full: SpatialRect): SpatialRect {
  const gridX = full.width / 8, gridY = full.height / 8
  const x = full.x + Math.floor((crop.x - full.x) / gridX) * gridX, y = full.y + Math.floor((crop.y - full.y) / gridY) * gridY
  return { x, y, width: full.x + Math.ceil((crop.x + crop.width - full.x) / gridX) * gridX - x, height: full.y + Math.ceil((crop.y + crop.height - full.y) / gridY) * gridY - y }
}
function intersectRect(a: SpatialRect, b: SpatialRect): SpatialRect | undefined {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}
/** 几何探测与正式渲染共用固定采样包络，第二次规划只修订层序与场景支持域。 */
export function planSpatialExposure(request: SpatialFrameRequest, scenes?: readonly SpatialSceneSample[], compositionAt?: SpatialCompositionAt): SpatialExposurePlan {
  request.signal.throwIfAborted(); request.assertCurrent()
  const { composition, output, sequenceFrame } = request
  const worldScenes = new Set(request.sources.filter(source => source.kind === 'worldScene').map(source => source.clipId))
  const evaluate = (time: number): SpatialFrame => {
    const source = compositionAt?.(time) ?? composition
    const scene = worldScenes.size ? { ...source, clips: source.clips.map(clip => worldScenes.has(clip.id) ? { ...clip, spatial: { enabled: true } } : clip) } : source
    return evaluateSpatialFrame(scene, time, output, request.quality)
  }
  const rawCenter = evaluate(sequenceFrame)
  const centerFrame = sceneGeometry(rawCenter, -1, scenes, worldScenes)
  const centerCards = new Map(centerFrame.cards.map(card => [card.clipId, card]))
  const shotRange = shutterRange(request)
  const active = new Map(composition.clips.map(clip => [clip.id, clip]))
  const canBlur = composition.clips.some(clip => videoEditClipMotionBlur(composition, clip)) && shotRange[1] > shotRange[0]
  const sharp = (id: string): boolean => { const clip = active.get(id); return !!clip && !videoEditClipMotionBlur(composition, clip) }
  const visible = videoEditPictureFilter(composition)
  const transitions = videoEditPictureTransitionsAt(composition, sequenceFrame)
  const clips = composition.clips.filter(clip => visible.has(clip) && clip.start <= sequenceFrame && sequenceFrame < clip.start + clip.duration)
  const runs: Array<{ id: string; items: ExposureItem[] }> = []
  const visit = (nodes: VideoEditCompositeNode[], parent: string): void => {
    let items: ExposureItem[] = []
    const flush = (): void => { if (items.length) runs.push({ id: `${parent}:${items[0].id}`, items }); items = [] }
    for (const node of nodes) {
      if (node.kind === 'adjustment') { flush(); visit(node.children, `${parent}:adjustment:${node.clip.id}`); continue }
      const sources = node.kind === 'clip' ? [node.clip] : videoEditTransitionPictureClips(node.window)
      if (!sources.every(clip => spatialClipEnabled(clip) || worldScenes.has(clip.id))) {
        flush()
        // 混合转场两端的空间片段各成一组，再由原转场合成；二维一侧仍隔断深度排序。
        if (node.kind === 'transition') for (const clip of sources) if (spatialClipEnabled(clip) || worldScenes.has(clip.id)) {
          runs.push({ id: `${parent}:${clip.id}`, items: [{ id: clip.id, clips: [clip.id], node: { kind: 'clip', clip, fromTrack: clip.track, toTrack: clip.track + 1 } }] })
        }
        continue
      }
      items.push({ id: node.kind === 'clip' ? node.clip.id : `transition:${node.window.transition.id}`, clips: sources.map(clip => clip.id), node })
    }
    flush()
  }
  visit(buildVideoEditCompositePlan(clips, transitions), 'spatial')
  const effective = (frame: SpatialFrame): SpatialFrame => ({ ...frame, cards: frame.cards.map(card => sharp(card.clipId) ? centerCards.get(card.clipId) ?? card : card) })
  const probes = Array.from({ length: 9 }, (_, index) => effective(evaluate(shotRange[0] + (shotRange[1] - shotRange[0]) * index / 8)))
  let travel = 0
  for (let index = 1; index < probes.length; index++) {
    const previous = new Map(probes[index - 1].cards.map(card => [card.clipId, card]))
    for (const card of probes[index].cards) if (previous.has(card.clipId)) travel = Math.max(travel, distance(previous.get(card.clipId)!, card, request) * 8)
  }
  const maxSamples = request.quality === 'interactive' ? VIDEO_EDIT_MOTION_BLUR_PLAYBACK_SAMPLES : VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES
  const dynamicScene = [...worldScenes].some(id => centerCards.has(id) && !sharp(id))
  const dynamicTransition = runs.some(run => run.items.some(item => item.node.kind === 'transition'))
  const crossing = runs.some(run => changesOrder(probes.map(frame => depthOrder(run.items, frame))))
  const count = canBlur ? dynamicScene || dynamicTransition || crossing ? maxSamples : travel >= .75 ? Math.min(maxSamples, Math.max(2, Math.ceil(travel / 1.5))) : 1 : 1
  const samples: SpatialSample[] = Array.from({ length: count }, (_, index) => {
    const time = count === 1 ? sequenceFrame : shotRange[0] + (index + .5) / count * (shotRange[1] - shotRange[0])
    const frame = effective(sceneGeometry(evaluate(time), index, scenes, worldScenes))
    return { index, sequenceFrame: time, weight: 1 / count, frame, clips: centerFrame.cards.map(card => {
      const clip = active.get(card.clipId)!, motionBlur = canBlur && !sharp(clip.id)
      const centerSourceTime = videoEditClipSourceSecondsAt(clip, sequenceFrame, composition.fps)
      return { clipId: clip.id, sequenceFrame: motionBlur ? time : sequenceFrame, sourceTime: motionBlur && worldScenes.has(clip.id) ? videoEditClipSourceSecondsAt(clip, time, composition.fps) : centerSourceTime, centerSourceTime, motionBlur }
    }) }
  })
  const groups: SpatialGroupPlan[] = []
  for (const { id, items } of runs) {
      const orderBySample = samples.map(sample => depthOrder(items, sample.frame))
      const clipIds = items.flatMap(entry => entry.clips)
      const crossing = changesOrder(orderBySample)
      const moving = count > 1 && (crossing || items.some(item => item.node.kind === 'transition') || clipIds.some(id => worldScenes.has(id) && !sharp(id)) || samples.some(sample => clipIds.some(id => {
        const a = centerCards.get(id), b = sample.frame.cards.find(card => card.clipId === id)
        return a && b && distance(a, b, request) > 0
      })))
      groups.push({ id, mode: !moving ? 'single' : crossing ? 'group' : 'transform', clipIds, itemIds: items.map(entry => entry.id), orderBySample })
      for (const entry of items) if (entry.node.kind === 'transition') {
        for (const frame of [centerFrame, ...samples.map(sample => sample.frame)]) for (const card of frame.cards) if (entry.clips.includes(card.clipId)) card.compoundGroup = entry.id
      }
  }
  const used = new Set(groups.flatMap(group => group.clipIds))
  const exposureFrames = [centerFrame, ...samples.map(sample => sample.frame)]
  const drafts = centerFrame.cards.filter(card => used.has(card.clipId)).map(card => {
    const kind = worldScenes.has(card.clipId) ? 'worldScene' as const : 'card' as const
    const group = groups.find(group => group.clipIds.includes(card.clipId))!
    const source = active.get(card.clipId)!
    const clip = evaluateVideoEditClip(compositionAt?.(sequenceFrame).clips.find(clip => clip.id === card.clipId) ?? source, sequenceFrame)
    const matrix = spatialClipMatrix(composition, { ...clip, spatial: { enabled: false } }, output)
    const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map(point => spatialTransform(matrix, point as unknown as SpatialVec3))
    const xs = corners.map(point => point[0] * output.displayHeight + output.displayWidth / 2)
    const ys = corners.map(point => -point[1] * output.displayHeight + output.displayHeight / 2)
    const reference = { referenceSize: { width: output.displayWidth, height: output.displayHeight }, contentBounds: { x: 0, y: 0, width: output.displayWidth, height: output.displayHeight }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: request.quality }
    const effects = activeVideoEditEffects(clip)
    const bleed = effects.reduce((total, effect) => {
      if (!effect.builtin) return total
      const params = resolveVideoEditBuiltinParams(effect.builtin)
      return total + (requireVideoEditBuiltinEffect(effect.builtin.id).bleed?.(params, reference) ?? 0) * output.displayHeight
    }, 0)
    const allReference = kind === 'worldScene' || effects.some(effect => effect.code)
    const left = allReference ? Math.min(0, ...xs) : Math.min(...xs), top = allReference ? Math.min(0, ...ys) : Math.min(...ys)
    const right = allReference ? Math.max(output.displayWidth, ...xs) : Math.max(...xs), bottom = allReference ? Math.max(output.displayHeight, ...ys) : Math.max(...ys)
    const radius = card.cocRadiusPx
    const localRadius = kind === 'worldScene' ? [radius * output.displayWidth / output.width, radius * output.displayHeight / output.height] : referenceDefocusRadius(card, matrix, request)
    const focusPadding = spatialDefocusStrength(radius) === 0 ? [0, 0] : localRadius.map((value, axis) => steppedRadius(value) + 2 * (axis ? output.displayHeight / output.height : output.displayWidth / output.width))
    const full = kind === 'worldScene' ? reference.contentBounds : { x: left - bleed - focusPadding[0], y: top - bleed - focusPadding[1], width: right - left + 2 * (bleed + focusPadding[0]), height: bottom - top + 2 * (bleed + focusPadding[1]) }
    // 作者代码效果可能读取整幅参考平面，世界场景已按屏幕投影；两者都保持整面一倍栅格。
    // 图形按准备时的二维档位栅格，推近只采样已有像素，与视频图片同样受源密度限制。
    const raster = allReference ? undefined : materialRaster(exposureFrames.map(frame => frame.cards.find(value => value.clipId === card.clipId) ?? card), exposureFrames, matrix, request,
      videoEditClipPictureSize(composition, source), ['video', 'image', 'sequence', 'graphic'].includes(source.kind), full, [bleed + focusPadding[0], bleed + focusPadding[1]])
    // 曝光内全程不可见的卡片仍保留一个参考像素，层序与回收路径不变。
    const bounds = !raster ? full : raster.crop && intersectRect(snapCrop(raster.crop, full), full) || { x: full.x, y: full.y, width: 1, height: 1 }
    // 材料面纹素格对齐输出像素格：恒等投影时第二次取样正落在纹素中心，接近零的空间量收敛到二维画面。
    const scaleX = output.width / output.displayWidth, scaleY = output.height / output.displayHeight
    const gridX = Math.floor(bounds.x * scaleX) / scaleX, gridY = Math.floor(bounds.y * scaleY) / scaleY
    const logicalBounds = kind === 'worldScene' ? bounds : { x: gridX, y: gridY, width: Math.ceil((bounds.x + bounds.width) * scaleX) / scaleX - gridX, height: Math.ceil((bounds.y + bounds.height) * scaleY) / scaleY - gridY }
    return { card, kind, group, source, radius, localRadius, logicalBounds, tier: raster ? Math.min(videoEditTextResolution(raster.need / SPATIAL_RASTER_SLACK), raster.limit) : 1 }
  })
  const base = (axis: 0 | 1): number => axis ? output.height / output.displayHeight : output.width / output.displayWidth
  const size = (draft: typeof drafts[number]): readonly [number, number] => [Math.max(1, Math.ceil(draft.logicalBounds.width * base(0) * draft.tier)), Math.max(1, Math.ceil(draft.logicalBounds.height * base(1) * draft.tier))]
  // 代码卡先按整幅画面乘栅格倍率生成，再画进裁剪后的材料面。
  const raw = (draft: typeof drafts[number]): readonly [number, number] | undefined => {
    if (draft.source.kind !== 'code') return undefined
    const picture = videoEditClipPictureSize(composition, draft.source), [width, height] = size(draft)
    return [Math.ceil(picture.width * width / draft.logicalBounds.width), Math.ceil(picture.height * height / draft.logicalBounds.height)]
  }
  for (const draft of drafts) while (draft.tier > 1 && Math.max(...size(draft), ...raw(draft) ?? []) > SPATIAL_RASTER_LIMIT) draft.tier /= 2
  const outputBytes = output.width * output.height * 8
  // 组合成、累积与整帧各一张，四样本覆盖率目标折合四张；稳定层序每项一张层图，各组结果持有到整帧合成。
  const outputs = 8 + groups.length + groups.filter(group => group.mode === 'transform').reduce((sum, group) => sum + group.itemIds.length, 0)
  const bytes = (): number => {
    let total = 0, transient = 0
    for (const draft of drafts) {
      const [width, height] = size(draft), material = width * height * 8, code = raw(draft)
      // 接管时生成完整 mip 链；未旁路的景深另有一张输出。
      total += material * 4 / 3 + (spatialDefocusStrength(draft.radius) === 0 ? 0 : material)
      // 生成原图与效果链临时目标逐项串行，只计最大的一项。
      transient = Math.max(transient, (code ? code[0] * code[1] * 8 : material) + 2 * material)
    }
    return total + transient + outputBytes * outputs + drafts.filter(draft => draft.kind === 'worldScene').length * videoEditThreeTargetBytes(output.width, output.height, 'webgpu')
  }
  // 推近升档只在工作集预算内进行；一倍栅格的必要工作集照常执行，不按固定容量拒绝。
  const wanted = new Map(drafts.map(draft => [draft, draft.tier]))
  for (let total = bytes(); total > VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES;) {
    const largest = drafts.filter(draft => draft.tier > 1).sort((a, b) => size(b)[0] * size(b)[1] - size(a)[0] * size(a)[1])[0]
    if (!largest) break
    largest.tier /= 2; total = bytes()
  }
  const materials: SpatialMaterialPlan[] = drafts.map(draft => {
    const { card, kind, group, radius, localRadius, logicalBounds } = draft
    const [width, height] = size(draft)
    const supportBoundsPx: SpatialRect = { x: 0, y: 0, width, height }
    return { clipId: card.clipId, kind, contentTime: kind === 'card' ? 'center' : 'sample', centerFrame: sequenceFrame,
      centerSourceTime: videoEditClipSourceSecondsAt(draft.source, sequenceFrame, composition.fps),
      referenceSize: { width: output.displayWidth, height: output.displayHeight }, logicalBounds,
      uvToReference: spatialMultiply(spatialTranslation(logicalBounds.x, logicalBounds.y, 0), spatialScale(logicalBounds.width, logicalBounds.height, 1)), rasterScale: [width / logicalBounds.width, height / logicalBounds.height], supportBoundsPx,
      defocus: { centerCocRadiusPx: radius, materialRadiusPx: [localRadius[0] * width / logicalBounds.width, localRadius[1] * height / logicalBounds.height], workBoundsPx: supportBoundsPx, downsample: 1, bypass: spatialDefocusStrength(radius) === 0,
        stage: kind === 'card' ? 'center-material' : group.mode === 'group' || card.compoundGroup ? 'per-scene-sample' : 'after-layer-accumulation' },
      target: { key: `spatial:${card.clipId}:material`, width, height, format: 'rgba16float', usage: 1 | 2 | 4 | 16 }, highPrecision: true, carriesLight: false }
  })
  const rasterLimits = drafts.filter(draft => draft.tier < wanted.get(draft)!).map(draft => ({ clipId: draft.card.clipId, wantedTier: wanted.get(draft)!, tier: draft.tier }))
  // 几何是平的但有片段在发光、受光、有厚度或非画面材质时也要走三维（二维合成没有这些）；空间帧本身的 flatIdentity 只表达几何，压平、展开拿它作判据。
  const emitting = centerFrame.cards.some(card => {
    const source = request.composition.clips.find(clip => clip.id === card.clipId)
    return !!source && ((evaluateVideoEditClip(source, request.sequenceFrame).spaceEmission ?? 0) > 0 || spaceClipIsSolid(source))
  })
  return { centerFrame: { ...centerFrame, flatIdentity: centerFrame.flatIdentity && samples.every(sample => sample.frame.flatIdentity) && worldScenes.size === 0 && !emitting }, samples, shotRange, groups, materials,
    workingSetBytes: bytes(), ...(rasterLimits.length ? { rasterLimits } : {}) }
}
