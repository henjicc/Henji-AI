import type { RelightKeyDirection, RelightRimDirection } from '@/features/canvas/capabilities/relightPolicy'
import { relightDirectionFromPoint, type RelightVisualizerView } from './relightDirectionVisualizerState'
import { rimAngleForDirection, rimDirectionFromAngle } from './relightRimLightState'

export interface LightPose { azimuth: number; elevation: number }
export interface RelightSpatialState { main: LightPose; rim: LightPose }
export interface SpatialPoint { x: number; y: number; z: number }

export function lightPosition(pose: LightPose): SpatialPoint {
  return { x: Math.sin(pose.azimuth) * Math.cos(pose.elevation),
    y: Math.sin(pose.elevation), z: Math.cos(pose.azimuth) * Math.cos(pose.elevation) }
}

export function poseForMain(direction: RelightKeyDirection): LightPose {
  return { azimuth: direction === 'left' ? -1.15 : direction === 'right' ? 1.15 : 0,
    elevation: direction === 'top' ? 1.1 : direction === 'bottom' ? -1.1 : 0 }
}

export function poseForRim(direction: RelightRimDirection): LightPose {
  const angle = rimAngleForDirection(direction === 'off' ? 'top-right' : direction)
  const x = Math.cos(angle) * 0.8
  const y = -Math.sin(angle) * 0.8
  return { azimuth: Math.atan2(x, -0.6), elevation: Math.asin(y) }
}

export function readSpatialState(value: unknown, main: RelightKeyDirection, rim: RelightRimDirection): RelightSpatialState {
  const state = value as Partial<RelightSpatialState> | null
  const valid = (pose: LightPose | undefined): pose is LightPose => Boolean(pose &&
    Number.isFinite(pose.azimuth) && Number.isFinite(pose.elevation) && Math.abs(pose.elevation) <= Math.PI / 2)
  return { main: valid(state?.main) && mainDirectionForPose(state.main) === main ? state.main : poseForMain(main),
    rim: valid(state?.rim) && (rim === 'off' || rimDirectionForPose(state.rim) === rim) ? state.rim : poseForRim(rim) }
}

/** The image is the XY plane. Both lamps and every grid line use this same orthographic camera. */
export function projectSpatialPoint(point: SpatialPoint, view: RelightVisualizerView): SpatialPoint {
  const yaw = view === 'front' ? 0 : 0.48
  const pitch = view === 'front' ? 0 : 0.16
  const x = Math.cos(yaw) * point.x - Math.sin(yaw) * point.z
  const z = Math.sin(yaw) * point.x + Math.cos(yaw) * point.z
  return { x: 50 + x * 41, y: 50 - (Math.cos(pitch) * point.y - Math.sin(pitch) * z) * 41,
    z: Math.sin(pitch) * point.y + Math.cos(pitch) * z }
}

export function dragLightPose(pose: LightPose, dx: number, dy: number): LightPose {
  return { azimuth: pose.azimuth + dx * Math.PI * 2,
    elevation: Math.max(-1.45, Math.min(1.45, pose.elevation - dy * Math.PI)) }
}

export function mainDirectionForPose(pose: LightPose): RelightKeyDirection {
  const p = lightPosition(pose)
  return relightDirectionFromPoint({ x: p.x, y: -p.y })
}

export function rimDirectionForPose(pose: LightPose): Exclude<RelightRimDirection, 'off'> {
  const p = lightPosition(pose)
  return rimDirectionFromAngle(Math.atan2(-p.y, p.x))
}

export function imagePlaneSize(aspect: number): { width: number; height: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return { width: Math.min(0.88, 0.88 * safeAspect), height: Math.min(0.88, 0.88 / safeAspect) }
}

/** Silhouette of a projected cone; one fill avoids seams between translucent triangles. */
export function projectedConeOutline(points: SpatialPoint[], view: RelightVisualizerView): string {
  const sorted = points.map(p => projectSpatialPoint(p, view)).sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (a: SpatialPoint, b: SpatialPoint, c: SpatialPoint): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const half = (list: SpatialPoint[]): SpatialPoint[] => {
    const hull: SpatialPoint[] = []
    for (const point of list) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop()
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())].map(p => `${p.x},${p.y}`).join(' ')
}
