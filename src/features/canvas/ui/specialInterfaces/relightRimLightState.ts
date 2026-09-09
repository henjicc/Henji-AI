import type { RelightKeyDirection, RelightRimDirection } from '@/features/canvas/capabilities/relightPolicy'
import type { RelightDirectionPoint, RelightVisualizerView } from './relightDirectionVisualizerState'

export type EnabledRimDirection = Exclude<RelightRimDirection, 'off'>
export const RIM_DIRECTION_ORDER: EnabledRimDirection[] = [
  'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left', 'top', 'top-right',
]
export const RIM_DIRECTION_LABELS: Record<RelightRimDirection, string> = {
  off: '关闭', left: '左侧', right: '右侧', top: '上方', 'top-left': '左上',
  'top-right': '右上', bottom: '下方', 'bottom-left': '左下', 'bottom-right': '右下',
}

// 与主光错开初始位置只是操作默认值，不是接口限制；开启后两盏灯仍可独立调整。
export function defaultRimDirection(key: RelightKeyDirection): EnabledRimDirection {
  if (key === 'right') return 'top-left'
  if (key === 'top') return 'bottom-right'
  return 'top-right'
}

export function rimAngleForDirection(direction: EnabledRimDirection): number {
  return RIM_DIRECTION_ORDER.indexOf(direction) * Math.PI / 4
}

export function rimDirectionFromAngle(angle: number): EnabledRimDirection {
  const sector = Math.round(angle / (Math.PI / 4))
  return RIM_DIRECTION_ORDER[((sector % 8) + 8) % 8]
}

/** 轮廓光走更靠近主体的内轨道，避免与主光的外轨道灯位重叠。 */
export function rimPointForAngle(angle: number, view: RelightVisualizerView): RelightDirectionPoint {
  const x = Math.cos(angle) * 0.65
  const y = Math.sin(angle) * 0.65
  return view === 'front' ? { x, y } : { x: x * 0.88, y: y * 0.82 - x * 0.16 }
}

export function rimAngleFromPoint(point: RelightDirectionPoint, view: RelightVisualizerView): number | null {
  const x = view === 'front' ? point.x : point.x / 0.88
  const y = view === 'front' ? point.y : (point.y + x * 0.16) / 0.82
  // 拖到中心仍保留上一个方位，关闭只能由开关表达。
  return Math.hypot(x, y) < 0.08 ? null : Math.atan2(y, x)
}
