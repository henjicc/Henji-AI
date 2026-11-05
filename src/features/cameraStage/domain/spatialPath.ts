import { v4 as uuidv4 } from 'uuid'
import type { StageVec3 } from './sceneTypes'
import { compileCameraMoveSamples } from './stateKeyframeCameraMovePresets'
import {
  addVec3,
  createBezierArcLengthCurve,
  cubicSegmentPoint,
  getSpatialPathAnchors,
  scaleVec3,
  subtractVec3,
  type PathAnchor,
} from './arcLengthCurve'
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

export { getSpatialPathAnchors } from './arcLengthCurve'
export { sampleSpatialMotion } from './spatialMotionEngine'

export function defaultSpatialPath(from: StageVec3, to: StageVec3): StageSpatialPath {
  const delta = subtractVec3(to, from)
  return {
    kind: 'bezier',
    source: { kind: 'custom' },
    startOutTangent: scaleVec3(delta, 1 / 3),
    knots: [],
    endInTangent: scaleVec3(delta, -1 / 3),
  }
}

/** 按整条路径弧长比例取点（0–1）；多段路径的 progress 不受各段长度差异影响。 */
export function createSpatialPathSampler(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
): StageSpatialPathSampler {
  const curve = createBezierArcLengthCurve(getSpatialPathAnchors(from, to, path))
  return (progress) => curve.pointAt(curve.length * Math.max(0, Math.min(1, progress)))
}

export function cubicSpatialPoint(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
  progress: number,
): StageVec3 {
  return createSpatialPathSampler(from, to, path)(progress)
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

function createOrbitPath(
  preset: Extract<StageCameraMovePreset, { kind: 'orbit' }>,
  from: StageVec3,
  target: StageVec3,
): GeneratedCameraPath {
  const degrees = Number.isFinite(preset.degrees) ? preset.degrees : 0
  const signedAngle = Math.abs(degrees) * Math.PI / 180 * (preset.direction === 'ccw' ? 1 : -1)
  const segmentCount = Math.max(1, Math.ceil(Math.abs(degrees) / 90))
  const segmentAngle = signedAngle / segmentCount
  const relativeStart = subtractVec3(from, target)
  const anchors: PathAnchor[] = []
  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = segmentAngle * index
    const position = addVec3(target, rotateAroundY(relativeStart, angle))
    const incomingScale = index > 0 ? -(4 / 3) * Math.tan(segmentAngle / 4) : 0
    const outgoingScale = index < segmentCount ? (4 / 3) * Math.tan(segmentAngle / 4) : 0
    anchors.push({
      position,
      inTangent: scaleVec3(orbitDerivative(relativeStart, angle), incomingScale),
      outTangent: scaleVec3(orbitDerivative(relativeStart, angle), outgoingScale),
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

const lerpVec3 = (a: StageVec3, b: StageVec3, t: number): StageVec3 => addVec3(a, scaleVec3(subtractVec3(b, a), t))
const distanceVec3 = (a: StageVec3, b: StageVec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/**
 * 在离 point 最近的位置把路径一分为二（de Casteljau 分割），前后两段拼起来与原路径完全重合。
 * point 落在起点或终点上时那一侧没有路程，为 null。两段都记为自定义路径：预设的幅度只对整段成立。
 */
export function splitSpatialPath(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
  point: StageVec3,
): { before: StageSpatialPath | null; after: StageSpatialPath | null } {
  const anchors = getSpatialPathAnchors(from, to, path)
  const pieces = anchors.length - 1
  const distanceAt = (piece: number, t: number): number => distanceVec3(cubicSegmentPoint(anchors[piece], anchors[piece + 1], t), point)
  const COARSE = 64
  let best = { piece: 0, t: 0, distance: Infinity }
  for (let piece = 0; piece < pieces; piece += 1) {
    for (let step = 0; step <= COARSE; step += 1) {
      const distance = distanceAt(piece, step / COARSE)
      if (distance < best.distance) best = { piece, t: step / COARSE, distance }
    }
  }
  // 黄金分割在最近取样点两侧各一格内细化。
  let low = Math.max(0, best.t - 1 / COARSE)
  let high = Math.min(1, best.t + 1 / COARSE)
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const a = high - (high - low) / 1.618034
    const b = low + (high - low) / 1.618034
    if (distanceAt(best.piece, a) < distanceAt(best.piece, b)) high = b
    else low = a
  }
  const piece = best.piece
  const t = (low + high) / 2
  if (piece + t <= 1e-4) return { before: null, after: path }
  if (piece + t >= pieces - 1e-4) return { before: path, after: null }

  const start = anchors[piece]
  const end = anchors[piece + 1]
  const p0 = start.position
  const p1 = addVec3(p0, start.outTangent)
  const p3 = end.position
  const p2 = addVec3(p3, end.inTangent)
  const left1 = lerpVec3(p0, p1, t)
  const middle = lerpVec3(p1, p2, t)
  const right2 = lerpVec3(p2, p3, t)
  const left2 = lerpVec3(left1, middle, t)
  const right1 = lerpVec3(middle, right2, t)
  const cut = lerpVec3(left2, right1, t)
  // 锚点 0 是起点、1..n 是 knots、n+1 是终点；被切的那段两端的切线换成分割后的控制点。
  const beforeKnots = path.knots.slice(0, piece).map((knot, index) => (index === piece - 1 ? { ...knot, outTangent: subtractVec3(left1, p0) } : knot))
  const afterKnots = path.knots.slice(piece).map((knot, index) => (index === 0 ? { ...knot, inTangent: subtractVec3(right2, p3) } : knot))
  return {
    before: markSpatialPathCustom({
      ...path,
      startOutTangent: piece === 0 ? subtractVec3(left1, p0) : path.startOutTangent,
      knots: beforeKnots,
      endInTangent: subtractVec3(left2, cut),
    }),
    after: markSpatialPathCustom({
      ...path,
      startOutTangent: subtractVec3(right1, cut),
      knots: afterKnots,
      endInTangent: piece === pieces - 1 ? subtractVec3(right2, p3) : path.endInTangent,
    }),
  }
}

export function markSpatialPathCustom(path: StageSpatialPath): StageSpatialPath {
  if (path.source.kind === 'custom') return path
  return {
    ...path,
    source: { kind: 'custom', originPreset: path.source.preset },
  }
}
