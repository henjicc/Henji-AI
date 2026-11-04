import { v4 as uuidv4 } from 'uuid'
import type { StageVec3 } from './sceneTypes'
import { compileCameraMoveSamples } from './stateKeyframeCameraMovePresets'
import {
  addVec3,
  createBezierArcLengthCurve,
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

export function markSpatialPathCustom(path: StageSpatialPath): StageSpatialPath {
  if (path.source.kind === 'custom') return path
  return {
    ...path,
    source: { kind: 'custom', originPreset: path.source.preset },
  }
}
