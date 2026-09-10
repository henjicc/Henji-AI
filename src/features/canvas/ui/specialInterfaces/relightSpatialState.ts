import type { RelightKeyDirection, RelightRimDirection } from '@/features/canvas/capabilities/relightPolicy'
import { RELIGHT_DIRECTION_ORDER, type RelightVisualizerView } from './relightDirectionVisualizerState'
import { RIM_DIRECTION_ORDER, rimAngleForDirection, rimDirectionFromAngle } from './relightRimLightState'

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

/** The image is the XY plane. Both lamps and every grid line use this same orthographic camera. */
export function projectSpatialPoint(point: SpatialPoint, view: RelightVisualizerView): SpatialPoint {
  const yaw = view === 'front' ? 0 : 0.65
  const pitch = view === 'front' ? 0 : 0.32
  const x = Math.cos(yaw) * point.x - Math.sin(yaw) * point.z
  const z = Math.sin(yaw) * point.x + Math.cos(yaw) * point.z
  return { x: 50 + x * 41, y: 50 - (Math.cos(pitch) * point.y - Math.sin(pitch) * z) * 41,
    z: Math.sin(pitch) * point.y + Math.cos(pitch) * z }
}

/** Continuous pointer preview on the sphere; only release uses the discrete API stops. */
export function spatialPointAtPointer(x: number, y: number, view: RelightVisualizerView, depth: number, radius = 1): SpatialPoint {
  const yaw = view === 'front' ? 0 : 0.65
  const pitch = view === 'front' ? 0 : 0.32
  const cameraX = (x - 50) / 41
  const cameraY = (50 - y) / 41
  const scale = Math.max(1, Math.hypot(cameraX, cameraY) / radius)
  const px = cameraX / scale; const py = cameraY / scale
  const pz = (depth < 0 ? -1 : 1) * Math.sqrt(Math.max(0, radius * radius - px * px - py * py))
  const worldY = Math.cos(pitch) * py + Math.sin(pitch) * pz
  const yawZ = -Math.sin(pitch) * py + Math.cos(pitch) * pz
  return { x: Math.cos(yaw) * px + Math.sin(yaw) * yawZ, y: worldY,
    z: -Math.sin(yaw) * px + Math.cos(yaw) * yawZ }
}

export function mainDirectionForPose(pose: LightPose): RelightKeyDirection {
  const p = lightPosition(pose)
  return RELIGHT_DIRECTION_ORDER.reduce((best, direction) => {
    const distance = (key: RelightKeyDirection): number => {
      const target = lightPosition(poseForMain(key))
      return Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z)
    }
    return distance(direction) < distance(best) ? direction : best
  })
}

/** Hit targets and visible stops use exactly the same projection, including the rear rim ring. */
export function snapLightAtPoint(x: number, y: number, lamp: 'main' | 'rim', view: RelightVisualizerView): LightPose {
  const candidates = lamp === 'main' ? RELIGHT_DIRECTION_ORDER.map(poseForMain) : RIM_DIRECTION_ORDER.map(poseForRim)
  return candidates.reduce((best, pose) => {
    const distance = (candidate: LightPose): number => {
      const p = projectSpatialPoint(lightPosition(candidate), view)
      return Math.hypot(p.x - x, p.y - y)
    }
    return distance(pose) < distance(best) ? pose : best
  })
}

/** Thin image plate shared by lighting and camera previews; no DOM or rendering lifecycle. */
export function imagePlateGeometry(aspect: number, project: (p: SpatialPoint) => SpatialPoint): { sides: string[]; matrix: string; width: number; height: number } {
  const { width, height } = imagePlaneSize(aspect)
  const corners = [{ x: -width / 2, y: height / 2, z: 0 }, { x: width / 2, y: height / 2, z: 0 },
    { x: width / 2, y: -height / 2, z: 0 }, { x: -width / 2, y: -height / 2, z: 0 }]
  const points = (values: SpatialPoint[]): string => values.map(p => { const s = project(p); return `${s.x},${s.y}` }).join(' ')
  const origin = project({ x: 0, y: 0, z: 0 })
  const x = project({ x: 1, y: 0, z: 0 }); const y = project({ x: 0, y: -1, z: 0 })
  return { width, height, matrix: `matrix(${(x.x - origin.x) / 100} ${(x.y - origin.y) / 100} ${(y.x - origin.x) / 100} ${(y.y - origin.y) / 100} ${origin.x} ${origin.y})`,
    sides: corners.map((a, i) => { const b = corners[(i + 1) % 4]; return points([a, b, { ...b, z: -0.045 }, { ...a, z: -0.045 }]) }) }
}

export function rimDirectionForPose(pose: LightPose): Exclude<RelightRimDirection, 'off'> {
  const p = lightPosition(pose)
  return rimDirectionFromAngle(Math.atan2(-p.y, p.x))
}

export function imagePlaneSize(aspect: number): { width: number; height: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return { width: Math.min(0.88, 0.88 * safeAspect), height: Math.min(0.88, 0.88 / safeAspect) }
}

/** Static ring geometry, split into near/far halves so rear arcs can be drawn faint and dashed. */
export function spatialOrbitPaths(points: SpatialPoint[], project: (p: SpatialPoint) => SpatialPoint): { front: string; back: string } {
  let front = ''; let back = ''; let previous: SpatialPoint | undefined
  let wasFront: boolean | undefined
  for (const point of points) {
    const p = project(point); const near = p.z >= 0
    const segment = !previous ? `M${p.x},${p.y}` : near !== wasFront
      ? `M${previous.x},${previous.y} L${p.x},${p.y}` : `L${p.x},${p.y}`
    if (near) front += segment; else back += segment
    previous = p; wasFront = near
  }
  return { front, back }
}

export const RELIGHT_SPATIAL_GUIDES = Object.fromEntries((['front', 'perspective'] as const).map(view => [view,
  [0, 1, 2].map(axis => spatialOrbitPaths(Array.from({ length: 97 }, (_, i) => {
    const a = i * Math.PI / 48
    return axis === 0 ? { x: Math.cos(a), y: 0, z: Math.sin(a) }
      : axis === 1 ? { x: 0, y: Math.cos(a), z: Math.sin(a) } : { x: Math.cos(a), y: Math.sin(a), z: 0 }
  }), point => projectSpatialPoint(point, view)))
])) as Record<RelightVisualizerView, { front: string; back: string }[]>

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
