import type { MultiAngleViewV1, MultiAngleDiscretePreset } from '@/features/canvas/capabilities/multiAnglePolicy'

type Point3 = readonly [number, number, number]
const CAMERA: Point3 = [3.8, 2.5, 4.5]
const distance = Math.hypot(...CAMERA)
const forward = CAMERA.map(value => value / distance)
const horizontal = Math.hypot(CAMERA[0], CAMERA[2])
const right = [CAMERA[2] / horizontal, 0, -CAMERA[0] / horizontal]
const up = [forward[1] * right[2], forward[2] * right[0] - forward[0] * right[2], -forward[1] * right[0]]
const focalLength = 50 / Math.tan(24 * Math.PI / 180)

/** Same 48° camera and world coordinates as the orbit editor, without a GPU context. */
export function projectMultiAnglePoint(point: Point3): { x: number; y: number; scale: number; depth: number } {
  const dot = (axis: number[]): number => axis.reduce((sum, value, index) => sum + value * point[index], 0)
  const depth = distance - dot(forward)
  const scale = focalLength / depth
  return { x: 50 + dot(right) * scale, y: 50 - dot(up) * scale, scale, depth }
}

function orbitPath(radius: number, vertical: boolean): string {
  const points = Array.from({ length: 97 }, (_, index) => {
    const angle = index * Math.PI / 48
    const point = projectMultiAnglePoint(vertical
      ? [0, Math.sin(angle) * radius, Math.cos(angle) * radius]
      : [Math.cos(angle) * radius, 0, Math.sin(angle) * radius])
    return `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`
  })
  return points.join(' ') + ' Z'
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
