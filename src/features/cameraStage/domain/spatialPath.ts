import { v4 as uuidv4 } from 'uuid'
import { easeProgress } from './keyframeEngine'
import type { StageEasingPreset } from './animationTypes'
import type { StageVec3 } from './sceneTypes'
import { compileCameraMoveSamples } from './shotCameraMovePresets'
import type {
  StageCameraMovePreset,
  StageSpatialPath,
  StageSpatialPathKnot,
} from './shotTypes'

export interface StageSpatialPathSample {
  time: number
  position: StageVec3
}

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

const SPATIAL_PATH_SEGMENTS = 48
const ARC_LENGTH_STEPS_PER_SEGMENT = 24
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

export function compileSpatialPathSamples(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
  startTime: number,
  endTime: number,
  easing: StageEasingPreset,
): StageSpatialPathSample[] {
  const samplePath = createSpatialPathSampler(from, to, path)
  return Array.from({ length: SPATIAL_PATH_SEGMENTS + 1 }, (_, index) => {
    const timeRatio = index / SPATIAL_PATH_SEGMENTS
    return {
      time: startTime + (endTime - startTime) * timeRatio,
      position: samplePath(easeProgress(easing, timeRatio)),
    }
  })
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
