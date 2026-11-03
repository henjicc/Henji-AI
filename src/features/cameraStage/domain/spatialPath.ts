import { v4 as uuidv4 } from 'uuid'
import { easeProgress } from './keyframeEngine'
import type { StageEasingPreset, StageSpatialMotion, StageSpatialMotionSegment } from './animationTypes'
import type { StageVec3 } from './sceneTypes'
import { compileCameraMoveSamples } from './stateKeyframeCameraMovePresets'
import type {
  StageCameraMovePreset,
  StageSpatialPath,
  StageSpatialPathKnot,
} from './stateKeyframeTypes'

export interface GeneratedCameraPath {
  path: StageSpatialPath
  endPosition: StageVec3
}

export type StageSpatialPathSampler = (progress: number) => StageVec3

interface PathAnchor {
  position: StageVec3
  inTangent: StageVec3
  outTangent: StageVec3
}

interface ArcLengthEntry {
  distance: number
  segmentIndex: number
  localT: number
}

// 弧长表在每步内按参数线性插值（与 three.js Curve.getUtoTmapping 同法）；90° 一段取 64 步时
// 匀速采样的点距误差远低于 0.1%，不会出现折线烤点那种逐段台阶速度。
const ARC_LENGTH_STEPS_PER_SEGMENT = 64
const ZERO_VEC3: StageVec3 = { x: 0, y: 0, z: 0 }

function add(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: StageVec3, factor: number): StageVec3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor }
}

function distance(a: StageVec3, b: StageVec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function rotateAroundY(value: StageVec3, angle: number): StageVec3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: value.x * cosine + value.z * sine,
    y: value.y,
    z: -value.x * sine + value.z * cosine,
  }
}

function orbitDerivative(value: StageVec3, angle: number): StageVec3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: -value.x * sine + value.z * cosine,
    y: 0,
    z: -value.x * cosine - value.z * sine,
  }
}

function cubicSegmentPoint(start: PathAnchor, end: PathAnchor, t: number): StageVec3 {
  const u = Math.max(0, Math.min(1, t))
  const inverse = 1 - u
  const control1 = add(start.position, start.outTangent)
  const control2 = add(end.position, end.inTangent)
  const component = (a: number, b: number, c: number, d: number): number => (
    inverse ** 3 * a + 3 * inverse ** 2 * u * b + 3 * inverse * u ** 2 * c + u ** 3 * d
  )
  return {
    x: component(start.position.x, control1.x, control2.x, end.position.x),
    y: component(start.position.y, control1.y, control2.y, end.position.y),
    z: component(start.position.z, control1.z, control2.z, end.position.z),
  }
}

export function getSpatialPathAnchors(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
): PathAnchor[] {
  return [
    { position: from, inTangent: ZERO_VEC3, outTangent: path.startOutTangent },
    ...path.knots.map((knot) => ({
      position: knot.position,
      inTangent: knot.inTangent,
      outTangent: knot.outTangent,
    })),
    { position: to, inTangent: path.endInTangent, outTangent: ZERO_VEC3 },
  ]
}

function buildArcLengthTable(anchors: PathAnchor[]): ArcLengthEntry[] {
  const table: ArcLengthEntry[] = [{ distance: 0, segmentIndex: 0, localT: 0 }]
  let totalDistance = 0
  let previous = anchors[0].position
  for (let segmentIndex = 0; segmentIndex < anchors.length - 1; segmentIndex += 1) {
    for (let step = 1; step <= ARC_LENGTH_STEPS_PER_SEGMENT; step += 1) {
      const localT = step / ARC_LENGTH_STEPS_PER_SEGMENT
      const point = cubicSegmentPoint(anchors[segmentIndex], anchors[segmentIndex + 1], localT)
      totalDistance += distance(previous, point)
      table.push({ distance: totalDistance, segmentIndex, localT })
      previous = point
    }
  }
  return table
}

function pointAtDistanceProgress(anchors: PathAnchor[], table: ArcLengthEntry[], progress: number): StageVec3 {
  const totalDistance = table[table.length - 1]?.distance ?? 0
  if (totalDistance <= 1e-8) return { ...anchors[0].position }
  const targetDistance = totalDistance * Math.max(0, Math.min(1, progress))
  let high = table.length - 1
  let low = 0
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (table[middle].distance < targetDistance) low = middle + 1
    else high = middle
  }
  const next = table[low]
  const previous = table[Math.max(0, low - 1)]
  const span = next.distance - previous.distance
  const ratio = span <= 1e-8 ? 0 : (targetDistance - previous.distance) / span
  const segmentIndex = next.segmentIndex
  const previousT = previous.segmentIndex === segmentIndex ? previous.localT : 0
  const localT = previousT + (next.localT - previousT) * ratio
  return cubicSegmentPoint(anchors[segmentIndex], anchors[segmentIndex + 1], localT)
}

export function defaultSpatialPath(from: StageVec3, to: StageVec3): StageSpatialPath {
  const delta = subtract(to, from)
  return {
    kind: 'bezier',
    source: { kind: 'custom' },
    startOutTangent: scale(delta, 1 / 3),
    knots: [],
    endInTangent: scale(delta, -1 / 3),
  }
}

export function createSpatialPathSampler(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
): StageSpatialPathSampler {
  const anchors = getSpatialPathAnchors(from, to, path)
  const table = buildArcLengthTable(anchors)
  return (progress) => pointAtDistanceProgress(anchors, table, progress)
}

/** 按整条路径弧长取点；多段路径的 progress 不受各段长度差异影响。 */
export function cubicSpatialPoint(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
  progress: number,
): StageVec3 {
  return createSpatialPathSampler(from, to, path)(progress)
}

interface SpatialMotionSegmentRuntime {
  segment: StageSpatialMotionSegment
  anchors: PathAnchor[]
  table: ArcLengthEntry[]
  length: number
  /** 段起点、终点的弧长速度（每秒）；null 表示该端是停靠点，整段按缓动预设求值。 */
  startSpeed: number | null
  endSpeed: number | null
}

const SLOPE_PROBE = 1e-3
const motionRuntimeCache = new WeakMap<StageSpatialMotion, SpatialMotionSegmentRuntime[]>()

/** 缓动曲线两端的归一化斜率，让平滑链的首尾仍遵守该段的速度预设。 */
function easingEndSlopes(easing: StageEasingPreset): [number, number] {
  if (easing === 'hold') return [0, 0]
  return [
    easeProgress(easing, SLOPE_PROBE) / SLOPE_PROBE,
    (1 - easeProgress(easing, 1 - SLOPE_PROBE)) / SLOPE_PROBE,
  ]
}

/**
 * 平滑链各衔接点的弧长速度：以链首尾的速度预设为边界条件，解一条 C2 连续的三次样条
 * （夹持样条的三对角方程，Thomas 算法），速度曲线在衔接点连续且不会凹下去；再按
 * Fritsch-Carlson 条件把每个衔接点速度限制在两侧平均速度的 3 倍以内，保证弧长随时间单调
 * 增加——镜头不会在路径上倒退。
 */
function solveJointSpeeds(runtime: SpatialMotionSegmentRuntime[]): void {
  const spans = runtime.map((item) => item.segment.endTime - item.segment.startTime)
  const count = runtime.length
  if (spans.some((span) => span <= 1e-8)) {
    for (let index = 0; index < count; index += 1) {
      runtime[index].startSpeed = 0
      runtime[index].endSpeed = 0
    }
    return
  }
  const secants = runtime.map((item, index) => item.length / spans[index])
  const speeds = new Array<number>(count + 1).fill(0)
  speeds[0] = easingEndSlopes(runtime[0].segment.easing)[0] * secants[0]
  speeds[count] = easingEndSlopes(runtime[count - 1].segment.easing)[1] * secants[count - 1]

  // 未知量为内部衔接点 1..count-1：h[i] m[i-1] + 2(h[i-1]+h[i]) m[i] + h[i-1] m[i+1] = 3(h[i] d[i-1] + h[i-1] d[i])
  const upper: number[] = []
  const rhs: number[] = []
  for (let joint = 1; joint < count; joint += 1) {
    const before = spans[joint - 1]
    const after = spans[joint]
    let diagonal = 2 * (before + after)
    let value = 3 * (after * secants[joint - 1] + before * secants[joint])
    if (joint === 1) value -= after * speeds[0]
    if (joint === count - 1) value -= before * speeds[count]
    if (joint > 1) {
      const lower = after
      diagonal -= lower * upper[joint - 2]
      value -= lower * rhs[joint - 2]
    }
    upper.push(before / diagonal)
    rhs.push(value / diagonal)
  }
  for (let joint = count - 1; joint >= 1; joint -= 1) {
    speeds[joint] = rhs[joint - 1] - (joint < count - 1 ? upper[joint - 1] * speeds[joint + 1] : 0)
  }
  for (let joint = 1; joint < count; joint += 1) {
    const limit = 3 * Math.min(secants[joint - 1], secants[joint])
    speeds[joint] = limit <= 1e-8 ? 0 : Math.max(0, Math.min(speeds[joint], limit))
  }
  for (let index = 0; index < count; index += 1) {
    runtime[index].startSpeed = speeds[index]
    runtime[index].endSpeed = speeds[index + 1]
  }
}

function buildMotionRuntime(motion: StageSpatialMotion): SpatialMotionSegmentRuntime[] {
  const runtime: SpatialMotionSegmentRuntime[] = motion.segments.map((segment) => {
    const anchors = getSpatialPathAnchors(segment.from, segment.to, segment.path)
    const table = buildArcLengthTable(anchors)
    return { segment, anchors, table, length: table[table.length - 1]?.distance ?? 0, startSpeed: null, endSpeed: null }
  })
  if (runtime.length > 1) solveJointSpeeds(runtime)
  return runtime
}

function hermiteDistance(length: number, startTangent: number, endTangent: number, u: number): number {
  const u2 = u * u
  const u3 = u2 * u
  return (u3 - 2 * u2 + u) * startTangent + (-2 * u3 + 3 * u2) * length + (u3 - u2) * endTangent
}

function segmentDistanceAt(runtime: SpatialMotionSegmentRuntime, time: number): number {
  const { segment, length, startSpeed, endSpeed } = runtime
  const span = segment.endTime - segment.startTime
  if (span <= 1e-8) return time >= segment.endTime ? length : 0
  const u = Math.max(0, Math.min(1, (time - segment.startTime) / span))
  if (startSpeed === null || endSpeed === null) return length * easeProgress(segment.easing, u)
  return hermiteDistance(length, startSpeed * span, endSpeed * span, u)
}

/**
 * 在空间路径链上按时间取位置；时间不在链的区间内时返回 undefined，由轨道端点值负责。
 * 弧长表按链对象缓存：编译产物不变时，逐帧求值只做查找与插值。
 */
export function sampleSpatialMotion(motion: StageSpatialMotion, time: number): StageVec3 | undefined {
  const first = motion.segments[0]
  const last = motion.segments[motion.segments.length - 1]
  if (!first || !last || time < first.startTime || time > last.endTime) return undefined
  let runtime = motionRuntimeCache.get(motion)
  if (!runtime) {
    runtime = buildMotionRuntime(motion)
    motionRuntimeCache.set(motion, runtime)
  }
  const current = runtime.find((item) => time <= item.segment.endTime) ?? runtime[runtime.length - 1]
  if (current.length <= 1e-8) return { ...current.segment.from }
  const distance = segmentDistanceAt(current, time)
  return pointAtDistanceProgress(current.anchors, current.table, distance / current.length)
}

function createOrbitPath(
  preset: Extract<StageCameraMovePreset, { kind: 'orbit' }>,
  from: StageVec3,
  target: StageVec3,
): GeneratedCameraPath {
  const degrees = Number.isFinite(preset.degrees) ? preset.degrees : 0
  const signedAngle = Math.abs(degrees) * Math.PI / 180 * (preset.direction === 'ccw' ? 1 : -1)
  const segmentCount = Math.max(1, Math.ceil(Math.abs(degrees) / 90))
  const segmentAngle = signedAngle / segmentCount
  const relativeStart = subtract(from, target)
  const anchors: PathAnchor[] = []
  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = segmentAngle * index
    const position = add(target, rotateAroundY(relativeStart, angle))
    const incomingScale = index > 0 ? -(4 / 3) * Math.tan(segmentAngle / 4) : 0
    const outgoingScale = index < segmentCount ? (4 / 3) * Math.tan(segmentAngle / 4) : 0
    anchors.push({
      position,
      inTangent: scale(orbitDerivative(relativeStart, angle), incomingScale),
      outTangent: scale(orbitDerivative(relativeStart, angle), outgoingScale),
    })
  }
  const knots: StageSpatialPathKnot[] = anchors.slice(1, -1).map((anchor) => ({
    id: uuidv4(),
    position: anchor.position,
    inTangent: anchor.inTangent,
    outTangent: anchor.outTangent,
  }))
  return {
    path: {
      kind: 'bezier',
      source: { kind: 'preset', preset },
      startOutTangent: anchors[0].outTangent,
      knots,
      endInTangent: anchors[anchors.length - 1].inTangent,
    },
    endPosition: anchors[anchors.length - 1].position,
  }
}

export function createCameraPresetPath(
  preset: StageCameraMovePreset,
  from: StageVec3,
  target: StageVec3,
): GeneratedCameraPath {
  if (preset.kind === 'orbit') return createOrbitPath(preset, from, target)
  const samples = compileCameraMoveSamples(preset, from, target, 0, 1, 'linear')
  const endPosition = samples[samples.length - 1]?.position ?? from
  const base = defaultSpatialPath(from, endPosition)
  return {
    path: {
      ...base,
      source: { kind: 'preset', preset },
    },
    endPosition,
  }
}

export function markSpatialPathCustom(path: StageSpatialPath): StageSpatialPath {
  if (path.source.kind === 'custom') return path
  return {
    ...path,
    source: { kind: 'custom', originPreset: path.source.preset },
  }
}
