import { CANVAS_NODE_TYPES, type CanvasNode } from './canvasNodes'
import type { RelightMode } from '../capabilities/relightPolicy'

export const RELIGHT_NODE_LAYOUT = {
  manual: { width: 720, height: 420, minWidth: 600, minHeight: 300 },
  smart: { width: 360, height: 420, minWidth: 320, minHeight: 300 },
} as const

type Size = { width: number; height: number }
type ModeSizes = Partial<Record<RelightMode, Size>>

function modeOf(node: CanvasNode): RelightMode {
  const settings = node.data.relightSettings as { lightingMode?: string } | undefined
  return settings?.lightingMode === 'smart' ? 'smart' : 'manual'
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function constrain(size: Partial<Size>, mode: RelightMode): Size {
  const layout = RELIGHT_NODE_LAYOUT[mode]
  return {
    width: Math.max(layout.minWidth, Math.min(1400, positive(size.width) ?? layout.width)),
    height: Math.max(layout.minHeight, Math.min(1000, positive(size.height) ?? layout.height)),
  }
}

function currentSize(node: CanvasNode): Size {
  return constrain({
    width: positive(node.width) ?? positive(node.style?.width) ?? positive(node.measured?.width),
    height: positive(node.height) ?? positive(node.style?.height) ?? positive(node.measured?.height),
  }, modeOf(node))
}

function withSize(node: CanvasNode, size: Size): CanvasNode {
  // 外框、绘制隔离盒和端口测量必须使用同一份尺寸，不能只扩大内部工作面。
  return { ...node, ...size, initialWidth: undefined, initialHeight: undefined,
    measured: { ...node.measured, ...size }, style: { ...node.style, ...size } }
}

/** 模式切换是一笔可撤销的布局修改，保留右边缘和各模式的手动尺寸。 */
export function applyRelightModeLayout(previous: CanvasNode, next: CanvasNode): CanvasNode {
  if (next.type !== CANVAS_NODE_TYPES.relightGen || modeOf(previous) === modeOf(next)) return next
  const oldMode = modeOf(previous)
  const newMode = modeOf(next)
  const oldSize = currentSize(previous)
  const saved = previous.data.relightModeSizes as ModeSizes | undefined
  const newSize = constrain(saved?.[newMode] ?? { width: RELIGHT_NODE_LAYOUT[newMode].width, height: oldSize.height }, newMode)
  return withSize({ ...next,
    position: { ...previous.position, x: previous.position.x + (oldSize.width - newSize.width) * (1 - (previous.origin?.[0] ?? 0)) },
    data: { ...next.data, relightModeSizes: { ...saved, [oldMode]: oldSize, [newMode]: newSize } },
  }, newSize)
}

/** 修复历史工程中的窄外框 / 宽工作面，并将自动布局尺寸统一给 ReactFlow。 */
export function normalizeRelightNodeLayout(node: CanvasNode): CanvasNode {
  if (node.type !== CANVAS_NODE_TYPES.relightGen) return node
  return withSize(node, node.data.isSizeManuallyAdjusted
    ? currentSize(node)
    : constrain(RELIGHT_NODE_LAYOUT[modeOf(node)], modeOf(node)))
}
