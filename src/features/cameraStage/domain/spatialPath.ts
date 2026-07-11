import { easeProgress } from './keyframeEngine'
import type { StageEasingPreset } from './animationTypes'
import type { StageVec3 } from './sceneTypes'
import type { StageSpatialPath } from './shotTypes'

export interface StageSpatialPathSample {
  time: number
  position: StageVec3
}

const SPATIAL_PATH_SEGMENTS = 24

export function defaultSpatialPath(from: StageVec3, to: StageVec3): StageSpatialPath {
  return {
    kind: 'bezier',
    outTangent: {
      x: (to.x - from.x) / 3,
      y: (to.y - from.y) / 3,
      z: (to.z - from.z) / 3,
    },
    inTangent: {
      x: (from.x - to.x) / 3,
      y: (from.y - to.y) / 3,
      z: (from.z - to.z) / 3,
    },
  }
}

export function cubicSpatialPoint(from: StageVec3, to: StageVec3, path: StageSpatialPath, u: number): StageVec3 {
  const t = Math.max(0, Math.min(1, u))
  const inverse = 1 - t
  const p1 = { x: from.x + path.outTangent.x, y: from.y + path.outTangent.y, z: from.z + path.outTangent.z }
  const p2 = { x: to.x + path.inTangent.x, y: to.y + path.inTangent.y, z: to.z + path.inTangent.z }
  const component = (a: number, b: number, c: number, d: number): number => (
    inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d
  )
  return {
    x: component(from.x, p1.x, p2.x, to.x),
    y: component(from.y, p1.y, p2.y, to.y),
    z: component(from.z, p1.z, p2.z, to.z),
  }
}

export function compileSpatialPathSamples(
  from: StageVec3,
  to: StageVec3,
  path: StageSpatialPath,
  startTime: number,
  endTime: number,
  easing: StageEasingPreset,
): StageSpatialPathSample[] {
  return Array.from({ length: SPATIAL_PATH_SEGMENTS + 1 }, (_, index) => {
    const timeRatio = index / SPATIAL_PATH_SEGMENTS
    return {
      time: startTime + (endTime - startTime) * timeRatio,
      position: cubicSpatialPoint(from, to, path, easeProgress(easing, timeRatio)),
    }
  })
}
