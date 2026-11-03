import type { EffectQuality } from '../imaging/effects/descriptor'
import type { VideoEditClip, VideoEditComposition } from './document'
import { videoEditClipPictureSize, videoEditPictureFilter, videoEditPictureTransitionsAt } from './clipGeometry'
import { videoEditTransitionPictureClips } from './transitions'
import { spatialElementFacts } from './spatialElementFacts'
import { evaluateVideoEditClip, evaluateVideoEditKeyframes } from './keyframes'
import { videoEditCornerPinMatrix, type VideoEditTrackQuad } from './tracking'
import { SPATIAL_KEYS, SPATIAL_CAMERA_NUMERIC_KEYS, SPATIAL_DEFAULT_FSTOP, SPATIAL_FOCAL_LENGTH_MM, SPATIAL_SENSOR_WIDTH_MM } from './spatialSchema'
import { spatialHomogeneous, spatialMultiply, spatialProjection, spatialRotation, spatialScale, spatialTransform, spatialTranslation, spatialView } from './spatialMatrices'
import type { SpatialBounds, SpatialCamera, SpatialCameraFrame, SpatialCameraNumericKey, SpatialCardGeometry, SpatialClipFields, SpatialFact, SpatialFocus, SpatialFrame, SpatialHold, SpatialMat4, SpatialOutput, SpatialTarget, SpatialVec3 } from './spatialTypes'

export class SpatialEvaluationError extends Error {
  constructor(readonly facts: readonly SpatialFact[]) { super(facts.map(fact => fact.message).join('；')); this.name = 'SpatialEvaluationError' }
}
type SpatialClip = VideoEditClip & SpatialClipFields
type Composition = Readonly<VideoEditComposition> & { spatialCamera?: SpatialCamera }
const quadUv = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as const
const zero: SpatialVec3 = [0, 0, 0]
const add = (a: SpatialVec3, b: SpatialVec3): SpatialVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: SpatialVec3, b: SpatialVec3): SpatialVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: SpatialVec3, amount: number): SpatialVec3 => [a[0] * amount, a[1] * amount, a[2] * amount]
const cross = (a: SpatialVec3, b: SpatialVec3): SpatialVec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function fail(code: SpatialFact['code'], frame: number, message: string, clipIds: readonly string[] = [], values: SpatialFact['values'] = {}): never {
  throw new SpatialEvaluationError([{ code, clipIds, sequenceFrame: frame, message, values }])
}
export function spatialClipEnabled(clip: SpatialClip): boolean {
  return clip.spatial?.enabled === true && !clip.disabledIntrinsicSections?.includes('motion') && clip.kind !== 'audio' && clip.kind !== 'adjustment'
}
function holdValue<T>(points: SpatialHold<T> | undefined, time: number, fallback: T): T {
  let value = fallback
  for (const point of points ?? []) { if (point.time > time) break; value = point.value }
  return value
}
/** 绑定先决定种类，休眠数值通道不改变绑定种类。 */
export function evaluateSpatialCamera(camera: SpatialCamera | undefined, frame: number): SpatialCamera {
  if (!camera) return {}
  const result = { ...camera }
  const numeric = Object.fromEntries(SPATIAL_CAMERA_NUMERIC_KEYS.map(key => [key, evaluateVideoEditKeyframes(camera.curves?.[key], frame,
    key === 'fStop' ? camera.fStop ?? SPATIAL_DEFAULT_FSTOP : key === 'framingHeightFraction' ? camera.framing?.heightFraction ?? 1 : key === 'focusDistance' ? camera.focus?.kind === 'distance' ? camera.focus.distance : 1 : (camera[key as keyof SpatialCamera] as number | undefined) ?? 0)])) as Record<SpatialCameraNumericKey, number>
  for (const key of ['offsetX', 'offsetY', 'offsetZ', 'rotationX', 'rotationY', 'rotationZ', 'perspective', 'defocus', 'fStop'] as const) result[key] = numeric[key]
  function target<T extends SpatialFocus>(kind: 'framing' | 'aim' | 'focus', value: T | null | undefined): T | null | undefined {
    if (!value || value.kind === 'clip') return value
    if (value.kind === 'distance') return { ...value, distance: camera!.curves?.focusDistance?.length ? numeric.focusDistance : value.distance }
    const components = (prefix: string, base: SpatialVec3): SpatialVec3 => ['X', 'Y', 'Z'].map((axis, index) => {
      const key = `${kind}${prefix}${axis}` as SpatialCameraNumericKey
      return camera!.curves?.[key]?.length ? numeric[key] : base[index]
    }) as unknown as SpatialVec3
    return value.kind === 'point' ? { ...value, point: components('', value.point) } : { ...value, bounds: { min: components('Min', value.bounds.min), max: components('Max', value.bounds.max) } }
  }
  const framing = target('framing', holdValue(camera.bindings?.framing, frame, camera.framing?.target ?? null))
  const aim = target('aim', holdValue(camera.bindings?.aim, frame, camera.aim ?? null))
  const focus = target('focus', holdValue(camera.bindings?.focus, frame, camera.focus ?? null))
  if (framing) result.framing = { target: framing, heightFraction: numeric.framingHeightFraction }; else delete result.framing
  if (aim) result.aim = aim; else delete result.aim
  if (focus) result.focus = focus; else delete result.focus
  delete result.curves; delete result.bindings
  return result
}
export function spatialBoundsCorners(bounds: SpatialBounds): SpatialVec3[] {
  return [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].flatMap(y => [bounds.min[2], bounds.max[2]].map(z => [x, y, z] as SpatialVec3)))
}
/** 面积加权的平面质心；三角扇使用世界面积，因此透视不改变排序中心的定义。 */
export function spatialPolygonCenter(polygon: readonly SpatialVec3[]): SpatialVec3 {
  if (!polygon.length) return zero
  let total = 0; let center: SpatialVec3 = zero
  for (let index = 1; index + 1 < polygon.length; index++) {
    const weight = Math.hypot(...cross(sub(polygon[index], polygon[0]), sub(polygon[index + 1], polygon[0])))
    total += weight; center = add(center, mul(add(add(polygon[0], polygon[index]), polygon[index + 1]), weight / 3))
  }
  return total > 0 ? mul(center, 1 / total) : mul(polygon.reduce(add, zero), 1 / polygon.length)
}
export function spatialClipMatrix(document: Composition, clip: SpatialClip, output: SpatialOutput): SpatialMat4 {
  const picture = videoEditClipPictureSize(document, clip)
  const aspect = output.displayWidth / output.displayHeight
  const fit = Math.min(output.displayWidth / picture.width, output.displayHeight / picture.height) * clip.scale / output.displayHeight
  const spatial = spatialClipEnabled(clip)
  const depth = spatial ? clip.depth ?? 0 : 0; const anchorDepth = spatial ? clip.anchorDepth ?? 0 : 0
  const tracked = (clip as SpatialClip & { trackingQuad?: VideoEditTrackQuad }).trackingQuad
  if (tracked) {
    const h = videoEditCornerPinMatrix(tracked)
    const homography: SpatialMat4 = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]]
    const plane = spatialMultiply(spatialTranslation(-aspect / 2, .5, 0), spatialScale(aspect, -1, 1), homography)
    const anchor = spatialTransform(plane, [clip.anchorX ?? .5, clip.anchorY ?? .5, 0])
    // 跟踪四角已经包含二维放置；空间倾斜只围绕四角上的运动轴心应用一次。
    return spatialMultiply(spatialTranslation(anchor[0], anchor[1], depth + anchorDepth),
      spatialRotation(spatial ? clip.rotationX ?? 0 : 0, spatial ? clip.rotationY ?? 0 : 0, 0),
      spatialTranslation(-anchor[0], -anchor[1], -anchorDepth), plane)
  }
  return spatialMultiply(
    spatialTranslation(clip.x * aspect, -clip.y, depth + anchorDepth),
    spatialRotation(spatial ? clip.rotationX ?? 0 : 0, spatial ? clip.rotationY ?? 0 : 0, clip.rotation),
    spatialTranslation(0, 0, -anchorDepth),
    spatialScale(picture.width * fit, -picture.height * fit * (clip.scaleAspect ?? 1), 1),
    spatialTranslation(-(clip.anchorX ?? .5), -(clip.anchorY ?? .5), 0),
  )
}
export function spatialClipPolygon(polygon: readonly SpatialVec3[], clipFromWorld: SpatialMat4): SpatialVec3[] {
  let result = [...polygon]
  const planes = [(v: readonly number[]): number => v[3] + v[0], (v: readonly number[]): number => v[3] - v[0],
    (v: readonly number[]): number => v[3] + v[1], (v: readonly number[]): number => v[3] - v[1],
    (v: readonly number[]): number => v[2], (v: readonly number[]): number => v[3] - v[2]]
  for (const plane of planes) {
    const input = result; result = []
    for (let index = 0; index < input.length; index++) {
      const a = input[index]; const b = input[(index + 1) % input.length]
      const da = plane(spatialHomogeneous(clipFromWorld, a)); const db = plane(spatialHomogeneous(clipFromWorld, b))
      if (da >= 0) result.push(a)
      if ((da < 0) !== (db < 0)) result.push(add(a, mul(sub(b, a), da / (da - db))))
    }
  }
  return result
}
function opticalCocRadius(camera: SpatialCameraFrame, depth: number, output: SpatialOutput, frame = 0): number {
  if (camera.defocus === 0) return 0
  const f = camera.focalLengthMm, s = depth * 1000, sf = camera.focusDistance * 1000
  if (!(depth > 0 && sf > f && camera.fStop > 0)) fail('invalid-optics', frame, '景深需要正视深，且焦点距离大于焦距。', [], { depth, focusDistance: camera.focusDistance, focalLengthMm: f })
  return Math.abs(f * f * (s - sf) / (camera.fStop * s * (sf - f))) * .5 / camera.sensorWidthMm * output.width * camera.defocus
}
export function spatialCocRadius(camera: SpatialCameraFrame, depth: number, output: SpatialOutput, frame = 0): number {
  if (camera.defocus !== 0 && depth <= camera.near) fail('invalid-optics', frame, '景深层须位于近裁剪面之后。', [], { depth, near: camera.near })
  return opticalCocRadius(camera, depth, output, frame)
}
/** 作者场景在准备后才有真实包围框；统一扩展裁剪面，再重新投影同帧的卡片。 */
export function includeSpatialWorldBounds(frame: SpatialFrame, bounds: readonly SpatialBounds[]): SpatialFrame {
  if (!bounds.length) return frame
  const camera = { ...frame.camera }
  for (const point of bounds.flatMap(spatialBoundsCorners)) {
    const depth = -spatialTransform(camera.view, point)[2]
    if (depth > 0) { camera.near = Math.min(camera.near, depth / 1000); camera.far = Math.max(camera.far, depth * 2) }
  }
  const distance = .5 / Math.tan(camera.fovYRadians / 2), aspect = frame.output.displayWidth / frame.output.displayHeight
  camera.projectionWebGpu = spatialProjection(aspect, distance, camera.near, camera.far, true)
  camera.projectionWebGl = spatialProjection(aspect, distance, camera.near, camera.far, false)
  return { ...frame, camera, cards: frame.cards.map(card => projectSpatialCard(card, camera, frame.output, frame.sequenceFrame)) }
}
function projectSpatialCard(card: Pick<SpatialCardGeometry, 'clipId' | 'ordinal' | 'uvToWorld' | 'logicalBounds' | 'effectPadding' | 'anchorWorld' | 'originalQuad' | 'ambiguousDepth'>, camera: SpatialCameraFrame, output: SpatialOutput, sequenceFrame: number): SpatialCardGeometry {
  const clipFromWorld = spatialMultiply(camera.projectionWebGpu, camera.view)
  const visiblePolygon = spatialClipPolygon(card.originalQuad, clipFromWorld)
  const centerWorld = spatialPolygonCenter(visiblePolygon.length ? visiblePolygon : card.originalQuad)
  const centerViewDepth = -spatialTransform(camera.view, centerWorld)[2]
  const allDepths = card.originalQuad.map(point => -spatialTransform(camera.view, point)[2])
  const visibleDepths = visiblePolygon.map(point => -spatialTransform(camera.view, point)[2])
  const screenPolygon = visiblePolygon.map(point => { const projected = spatialTransform(clipFromWorld, point); return [(projected[0] + 1) / 2, (1 - projected[1]) / 2] as const })
  const xs = screenPolygon.map(point => point[0]), ys = screenPolygon.map(point => point[1])
  const focusDepths = (visibleDepths.length ? visibleDepths : allDepths).filter(depth => depth > camera.near)
  const radii = focusDepths.map(depth => opticalCocRadius(camera, depth, output, sequenceFrame))
  return { ...card, clipFromUv: spatialMultiply(clipFromWorld, card.uvToWorld), visiblePolygon, centerWorld, centerViewDepth, screenPolygon,
    screenBounds: screenPolygon.length ? { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } : { x: 0, y: 0, width: 0, height: 0 },
    viewDepthRange: [Math.min(...allDepths), Math.max(...allDepths)], cocRadiusPx: centerViewDepth > camera.near ? spatialCocRadius(camera, centerViewDepth, output, sequenceFrame) : 0,
    cocRangePx: radii.length ? [Math.min(...radii, ...(Math.min(...focusDepths) <= camera.focusDistance && Math.max(...focusDepths) >= camera.focusDistance ? [0] : [])), Math.max(...radii)] : [0, 0],
    behindCamera: Math.max(...allDepths) <= 0,
    clipped: visiblePolygon.length !== 4 || visiblePolygon.some((point, index) => point.some((value, axis) => value !== card.originalQuad[index]?.[axis])) }
}
export function evaluateSpatialFrame(composition: Readonly<VideoEditComposition>, sequenceFrame: number, output: SpatialOutput, _quality: EffectQuality): SpatialFrame {
  const document: Composition = composition
  if (![sequenceFrame, output.width, output.height, output.displayWidth, output.displayHeight].every(Number.isFinite) || Math.min(output.width, output.height, output.displayWidth, output.displayHeight) <= 0) fail('invalid-optics', sequenceFrame, '空间求值需要有限时刻和正画幅。')
  const camera = evaluateSpatialCamera(document.spatialCamera, sequenceFrame)
  const aspect = output.displayWidth / output.displayHeight
  const focalLengthMm = SPATIAL_FOCAL_LENGTH_MM * 2 ** (camera.perspective ?? 0)
  const distance = focalLengthMm * aspect / SPATIAL_SENSOR_WIDTH_MM
  if (!(Number.isFinite(distance) && distance > 0)) fail('invalid-optics', sequenceFrame, '透视量无法生成有限的正焦距。')
  const evaluated = document.clips.map(clip => evaluateVideoEditClip(clip, sequenceFrame) as SpatialClip)
  const visible = videoEditPictureFilter(document)
  const handles = new Set(videoEditPictureTransitionsAt(document, sequenceFrame).flatMap(window => videoEditTransitionPictureClips(window).map(clip => clip.id)))
  const active = (clip: VideoEditClip): boolean => visible.has(clip) && (handles.has(clip.id) || sequenceFrame >= clip.start && sequenceFrame < clip.start + clip.duration)
  const geometry = new Map(evaluated.map(clip => { const matrix = spatialClipMatrix(document, clip, output); return [clip.id, { clip, matrix, quad: quadUv.map(point => spatialTransform(matrix, point)) }] }))
  let targetActive = true
  const resolve = (target: SpatialTarget): readonly SpatialVec3[] => {
    if (target.kind === 'point') return [target.point]
    if (target.kind === 'bounds') return spatialBoundsCorners(target.bounds)
    const entry = geometry.get(target.clipId)
    if (!entry) fail('missing-target', sequenceFrame, `相机引用的片段 ${target.clipId} 不存在。`, [target.clipId])
    if (sequenceFrame < entry.clip.start || sequenceFrame >= entry.clip.start + entry.clip.duration || !visible.has(entry.clip)) targetActive = false
    return entry.quad
  }
  const centerOf = (target: SpatialTarget): SpatialVec3 => target.kind === 'bounds' ? mul(add(target.bounds.min, target.bounds.max), .5) : spatialPolygonCenter(resolve(target))
  const offset: SpatialVec3 = [camera.offsetX ?? 0, camera.offsetY ?? 0, camera.offsetZ ?? 0]
  let position: SpatialVec3 = [0, 0, distance]
  let target: SpatialVec3 = zero
  if (camera.framing) {
    const points = resolve(camera.framing.target); const center = centerOf(camera.framing.target)
    if (points.length === 1) fail('invalid-optics', sequenceFrame, '点目标没有可取景高度，请提供包围框或片段。')
    target = camera.aim ? centerOf(camera.aim) : center
    const backward = camera.aim ? sub(position, target) : [0, 0, 1] as const
    const length = Math.hypot(...backward)
    if (length === 0) fail('singular-aim', sequenceFrame, '相机与瞄准目标重合。')
    const direction = mul(backward, 1 / length)
    let initialView: SpatialMat4
    try { initialView = spatialView(add(target, direction), target).view } catch { fail('singular-aim', sequenceFrame, '相机与瞄准目标重合。') }
    const projected = points.map(point => spatialTransform(initialView, point))
    const height = Math.max(...projected.map(point => point[1])) - Math.min(...projected.map(point => point[1]))
    if (!(height > 0 && camera.framing.heightFraction > 0)) fail('invalid-optics', sequenceFrame, '目标投影高度不能形成有效取景。')
    let travel = distance * height / camera.framing.heightFraction
    let converged = false
    // 同一意图逐帧求解；相机沿目标基准视向移动，禁止把派生机位落盘。
    for (let iteration = 0; iteration < 48; iteration++) {
      position = add(target, mul(direction, travel))
      let view: SpatialMat4
      try { view = spatialView(position, target).view } catch { fail('singular-aim', sequenceFrame, '相机与瞄准目标重合。') }
      const viewPoints = points.map(point => spatialTransform(view, point))
      if (viewPoints.some(point => point[2] >= 0)) { travel *= 2; continue }
      const ys = viewPoints.map(point => distance * point[1] / -point[2])
      const fraction = Math.max(...ys) - Math.min(...ys)
      if (Math.abs(fraction - camera.framing.heightFraction) * output.height < .01) { converged = true; break }
      travel *= fraction / camera.framing.heightFraction
      if (iteration === 47 || !Number.isFinite(travel)) fail('projection-residual', sequenceFrame, '当前瞄准与取景目标无法同时满足占高，请调整目标或占高比例。')
    }
    if (!converged) fail('projection-residual', sequenceFrame, '取景求解没有找到满足占高的有限机位。')
  }
  position = add(position, offset)
  if (camera.aim) target = centerOf(camera.aim)
  else if (!camera.framing) target = add(position, [0, 0, -distance])
  let viewAndUp: ReturnType<typeof spatialView>
  try { viewAndUp = spatialView(position, target, [camera.rotationX ?? 0, camera.rotationY ?? 0, camera.rotationZ ?? 0]) }
  catch { fail('singular-aim', sequenceFrame, '相机与瞄准目标重合。') }
  const { view, up } = viewAndUp
  const depths = [...geometry.values()].flatMap(entry => entry.quad.map(point => -spatialTransform(view, point)[2])).filter(value => value > 0)
  const near = depths.reduce((minimum, value) => Math.min(minimum, value), distance) / 1000
  const far = depths.reduce((maximum, value) => Math.max(maximum, value), distance) * 2
  const forward: SpatialVec3 = [-view[2], -view[6], -view[10]]
  const resolvedFocus = camera.focus?.kind === 'distance' ? add(position, mul(forward, camera.focus.distance)) : camera.focus ? centerOf(camera.focus) : zero
  const focusDistance = -spatialTransform(view, resolvedFocus)[2]
  const defaultFocus = !camera.focus || camera.focus.kind === 'point' && camera.focus.point.every(value => value === 0) || camera.focus.kind === 'distance' && camera.focus.distance === distance
  const canonicalIdentity = !camera.framing && !camera.aim && defaultFocus && ['offsetX', 'offsetY', 'offsetZ', 'rotationX', 'rotationY', 'rotationZ', 'perspective', 'defocus'].every(key => ((camera as Record<string, unknown>)[key] ?? 0) === 0)
  const cameraFrame: SpatialCameraFrame = { position, target, up, focalLengthMm, sensorWidthMm: SPATIAL_SENSOR_WIDTH_MM,
    focusDistance, fStop: camera.fStop ?? SPATIAL_DEFAULT_FSTOP, defocus: camera.defocus ?? 0,
    near, far, fovYRadians: 2 * Math.atan(.5 / distance), view,
    projectionWebGpu: spatialProjection(aspect, distance, near, far, true), projectionWebGl: spatialProjection(aspect, distance, near, far, false),
    canonicalIdentity, resolvedAim: target, resolvedFocus, targetActive }
  const facts: SpatialFact[] = []
  const cards: SpatialCardGeometry[] = []
  for (const [ordinal, source] of evaluated.entries()) {
    if (!spatialClipEnabled(source) || !active(source)) continue
    const entry = geometry.get(source.id)!
    const originalQuad = entry.quad as unknown as SpatialCardGeometry['originalQuad']
    const card = projectSpatialCard({ clipId: source.id, ordinal, uvToWorld: entry.matrix,
      logicalBounds: { x: 0, y: 0, width: output.displayWidth, height: output.displayHeight }, effectPadding: [0, 0, 0, 0],
      anchorWorld: [source.x * aspect, -source.y, (source.depth ?? 0) + (source.anchorDepth ?? 0)], originalQuad, ambiguousDepth: false }, cameraFrame, output, sequenceFrame)
    if (card.clipped) facts.push({ code: 'clipped', clipIds: [source.id], sequenceFrame, message: '空间卡片在视锥边界裁剪。', values: { visibleVertices: card.visiblePolygon.length } })
    cards.push(card)
  }
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j], x = a.screenBounds, y = b.screenBounds
    if (!a.visiblePolygon.length || !b.visiblePolygon.length || x.x >= y.x + y.width || y.x >= x.x + x.width || x.y >= y.y + y.height || y.y >= x.y + x.height) continue
    if (Math.min(a.viewDepthRange[1], b.viewDepthRange[1]) <= Math.max(a.viewDepthRange[0], b.viewDepthRange[0])) continue
    a.ambiguousDepth = b.ambiguousDepth = true
    facts.push({ code: 'ambiguous-depth', clipIds: [a.clipId, b.clipId], sequenceFrame, message: '投影与视深范围重叠，单层中心排序不能证明逐像素遮挡。', values: {} })
  }
  facts.push(...spatialElementFacts(document, sequenceFrame, evaluated.filter(active), spatialClipEnabled))
  const flatIdentity = canonicalIdentity && evaluated.every(clip => !spatialClipEnabled(clip) || !active(clip) || SPATIAL_KEYS.every(key => (clip[key] ?? 0) === 0))
  return { sequenceFrame, sequenceTime: sequenceFrame / document.fps, output, camera: cameraFrame, cards, flatIdentity, facts }
}
