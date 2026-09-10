import type { MultiAngleViewV1, MultiAngleDiscretePreset } from '@/features/canvas/capabilities/multiAnglePolicy'
import { projectSpatialPoint, spatialOrbitPaths } from '../relightSpatialState'

type Point3 = readonly [number, number, number]

/** Lighting and orbit share a camera: image front is +Z, rear is -Z. */
export function projectMultiAnglePoint(point: Point3): { x: number; y: number; scale: number; depth: number } {
  const p = projectSpatialPoint({ x: point[0] * 0.59, y: point[1] * 0.59, z: point[2] * 0.59 }, 'perspective')
  return { x: p.x, y: p.y, scale: 24 * (1 + p.z * 0.15), depth: -p.z }
}

function orbitPath(radius: number, vertical: boolean): { front: string; back: string } {
  return spatialOrbitPaths(Array.from({ length: 97 }, (_, index) => {
    const angle = index * Math.PI / 48
    return vertical ? { x: 0, y: Math.sin(angle) * radius, z: Math.cos(angle) * radius }
      : { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }
  }), point => {
    const p = projectMultiAnglePoint([point.x, point.y, point.z])
    return { x: p.x, y: p.y, z: -p.depth }
  })
}

export const MULTI_ANGLE_ORBIT_PATHS = [orbitPath(1.55, false), orbitPath(1.2, true)]

export function multiAngleMarkerPosition(view: MultiAngleViewV1): [number, number, number] {
  if (view.kind === 'continuous') {
    const yaw = (view.yawControlDeg / 180) * Math.PI
    const radius = 1.62 - view.proximity * 0.052
    return [
      -Math.sin(yaw) * radius,
      -view.verticalControl * 0.95,
      Math.cos(yaw) * radius,
    ]
  }
  if (view.kind === 'flux') {
    const horizontal = (view.horizontalAngleDeg / 180) * Math.PI
    const vertical = (view.verticalAngleDeg / 180) * Math.PI
    const radius = 1.62 - view.zoom * 0.052
    return [
      Math.sin(horizontal) * Math.cos(vertical) * radius,
      Math.sin(vertical) * radius,
      Math.cos(horizontal) * Math.cos(vertical) * radius,
    ]
  }
  const positions: Record<MultiAngleDiscretePreset, [number, number, number]> = {
    front: [0, 0, 1.55],
    left_side: [-1.55, 0, 0],
    right_side: [1.55, 0, 0],
    back: [0, 0, -1.55],
    top_down: [0, 1.4, 0],
    bottom_up: [0, -1.4, 0],
    birds_eye: [-0.5, 1.25, 0.85],
    three_quarter_left: [-1.08, 0, 1.08],
    three_quarter_right: [1.08, 0, 1.08],
  }
  return positions[view.preset]
}
