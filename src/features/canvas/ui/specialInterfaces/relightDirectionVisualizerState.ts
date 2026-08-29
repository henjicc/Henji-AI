import type { RelightKeyDirection } from '@/features/canvas/capabilities/relightPolicy'

export type RelightVisualizerView = 'perspective' | 'front'

export interface RelightDirectionPoint {
  x: number
  y: number
}

export const RELIGHT_DIRECTION_LABELS: Record<RelightKeyDirection, string> = {
  none: '不指定',
  left: '左侧',
  right: '右侧',
  top: '上方',
  bottom: '下方',
}

export const RELIGHT_DIRECTION_ORDER: RelightKeyDirection[] = ['none', 'left', 'right', 'top', 'bottom']

const DIRECTION_POINTS: Record<RelightKeyDirection, RelightDirectionPoint> = {
  none: { x: 0, y: 0 },
  left: { x: -0.84, y: 0 },
  right: { x: 0.84, y: 0 },
  top: { x: 0, y: -0.84 },
  bottom: { x: 0, y: 0.84 },
}

const CENTER_ZONE_RADIUS = 0.28
const MAX_POINT_RADIUS = 0.92

function projectedPoint(point: RelightDirectionPoint, view: RelightVisualizerView): RelightDirectionPoint {
  if (view === 'front') return point
  return {
    x: point.x * 0.88,
    y: point.y * 0.82 - point.x * 0.16,
  }
}

export function relightPointForDirection(
  direction: RelightKeyDirection,
  view: RelightVisualizerView = 'front',
): RelightDirectionPoint {
  return projectedPoint(DIRECTION_POINTS[direction], view)
}

export function relightDirectionFromPoint(point: RelightDirectionPoint): RelightKeyDirection {
  const radius = Math.hypot(point.x, point.y)
  if (radius <= CENTER_ZONE_RADIUS) return 'none'
  if (Math.abs(point.x) >= Math.abs(point.y)) return point.x < 0 ? 'left' : 'right'
  return point.y < 0 ? 'top' : 'bottom'
}

export function clampRelightDirectionPoint(point: RelightDirectionPoint): RelightDirectionPoint {
  const radius = Math.hypot(point.x, point.y)
  if (radius <= MAX_POINT_RADIUS) return point
  const scale = MAX_POINT_RADIUS / radius
  return { x: point.x * scale, y: point.y * scale }
}
