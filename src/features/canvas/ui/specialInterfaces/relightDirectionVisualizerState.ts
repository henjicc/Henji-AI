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

const CENTER_ZONE_RADIUS = 0.28

export function relightDirectionFromPoint(point: RelightDirectionPoint): RelightKeyDirection {
  const radius = Math.hypot(point.x, point.y)
  if (radius <= CENTER_ZONE_RADIUS) return 'none'
  if (Math.abs(point.x) >= Math.abs(point.y)) return point.x < 0 ? 'left' : 'right'
  return point.y < 0 ? 'top' : 'bottom'
}
