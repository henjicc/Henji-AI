import type { Viewport } from '@xyflow/react'
import type { CanvasNode, CanvasNodeData, CanvasNodeType } from '../domain/canvasNodes'
import type { CanvasNodeLayoutSize } from '../domain/nodeLayoutSize'
import { resolveCanvasNodeLayoutSize } from '../domain/nodeRegistry'
import { resolveUploadNodeDefaultSize } from './uploadNodeSizing'

interface Point { x: number; y: number }
interface Rect extends Point, CanvasNodeLayoutSize {}

export interface CanvasPlacementScene {
  nodes: readonly CanvasNode[]
  viewport: Viewport
  viewportSize: { width: number; height: number }
}

/** 节点卡片上方有浮动标题，纵向留得比横向宽，避免标题压到上一个节点底边。 */
const MARGIN_X = 16
const MARGIN_Y = 36
const SOURCE_GAP_X = 56

/** 新节点在创建前的尺寸估值：上传类按工厂的默认尺寸，其余按节点类型声明。 */
export function estimateNewCanvasNodeSize(type: CanvasNodeType | string, data: Partial<CanvasNodeData> = {}): CanvasNodeLayoutSize {
  return resolveUploadNodeDefaultSize(type as CanvasNodeType, data) ?? resolveCanvasNodeLayoutSize({ type, data })
}

function rectOf(node: CanvasNode): Rect {
  return { ...node.position, ...resolveCanvasNodeLayoutSize(node) }
}

function visibleBounds(scene: CanvasPlacementScene) {
  const { width, height } = scene.viewportSize
  if (!(width > 0 && height > 0)) return null
  const zoom = Math.max(0.01, scene.viewport.zoom || 1)
  const minX = -scene.viewport.x / zoom
  const minY = -scene.viewport.y / zoom
  return { minX, minY, maxX: minX + width / zoom, maxY: minY + height / zoom }
}

/**
 * 在 anchor 附近找一个不与任何节点（含同一回合刚建、尚未测量的节点）重叠的位置；
 * 有来源节点时优先放在它右侧，其次下方，再向外环形搜索，视口内的位置优先。
 */
export function findFreeCanvasPosition(
  scene: CanvasPlacementScene,
  size: CanvasNodeLayoutSize,
  anchor: Point,
  source?: CanvasNode,
): Point {
  const occupied = scene.nodes.filter(node => !node.hidden && !node.parentId).map(rectOf)
  const collides = (x: number, y: number) => occupied.some(rect => (
    x < rect.x + rect.width + MARGIN_X && x + size.width + MARGIN_X > rect.x
    && y < rect.y + rect.height + MARGIN_Y && y + size.height + MARGIN_Y > rect.y
  ))
  const bounds = visibleBounds(scene)
  const overflow = (x: number, y: number) => !bounds ? 0
    : Math.max(0, bounds.minX - x) + Math.max(0, bounds.minY - y)
      + Math.max(0, x + size.width - bounds.maxX) + Math.max(0, y + size.height - bounds.maxY)
  let bestInView: (Point & { score: number }) | null = null
  let bestOutOfView: (Point & { score: number }) | null = null
  const evaluate = (x: number, y: number) => {
    if (collides(x, y)) return
    const dy = y - anchor.y
    const out = overflow(x, y)
    const score = Math.hypot(x - anchor.x, dy) + (dy < 0 ? -dy * 0.25 : 0) + out * 1000
    if (out === 0) { if (!bestInView || score < bestInView.score) bestInView = { x, y, score } }
    else if (!bestOutOfView || score < bestOutOfView.score) bestOutOfView = { x, y, score }
  }

  if (source) {
    const rect = rectOf(source)
    evaluate(anchor.x, anchor.y)
    evaluate(rect.x, rect.y + rect.height + MARGIN_Y)
    evaluate(rect.x - size.width - SOURCE_GAP_X, rect.y)
    evaluate(rect.x, rect.y - size.height - MARGIN_Y)
  } else evaluate(anchor.x, anchor.y)

  const stepX = Math.max(size.width + MARGIN_X, 110)
  const stepY = Math.max(Math.round(size.height * 0.35), 54)
  for (let ring = 1; ring <= 8; ring += 1) {
    for (const [ox, oy] of [[ring, 0], [ring, 1], [ring, -1], [0, ring], [0, -ring], [-ring, 0], [ring, 2], [ring, -2], [-ring, 1], [-ring, -1]]) {
      evaluate(anchor.x + ox * stepX, anchor.y + oy * stepY)
    }
  }

  // 环形采样漏掉视口内的空位时，再在视口里密扫一遍，最后才退到视口外。
  if (!bestInView && bounds) {
    const minX = bounds.minX + 8; const maxX = bounds.maxX - size.width - 8
    const minY = bounds.minY + 8; const maxY = bounds.maxY - size.height - 8
    if (maxX >= minX && maxY >= minY) {
      const scanX = Math.max(42, Math.round(size.width * 0.32))
      const scanY = Math.max(42, Math.round(size.height * 0.32))
      for (let y = minY; y <= maxY; y += scanY) for (let x = minX; x <= maxX; x += scanX) evaluate(x, y)
      evaluate(minX, minY); evaluate(maxX, minY); evaluate(minX, maxY); evaluate(maxX, maxY)
    }
  }
  const best = (bestInView ?? bestOutOfView) as (Point & { score: number }) | null
  if (best) return { x: best.x, y: best.y }
  // 近处全满：放到所有节点的右侧之外，保证不重叠。
  const right = occupied.reduce((max, rect) => Math.max(max, rect.x + rect.width), anchor.x)
  return { x: right + SOURCE_GAP_X, y: anchor.y }
}

/** 来源节点右侧的落点。 */
export function findCanvasPositionRightOf(scene: CanvasPlacementScene, sourceNodeId: string, size: CanvasNodeLayoutSize): Point {
  const source = scene.nodes.find(node => node.id === sourceNodeId)
  if (!source) return { x: 100, y: 100 }
  const rect = rectOf(source)
  return findFreeCanvasPosition(scene, size, { x: rect.x + rect.width + SOURCE_GAP_X, y: rect.y }, source)
}

/** 视口中心的落点，同样避让已有节点。 */
export function findCanvasPositionNearViewportCenter(scene: CanvasPlacementScene, size: CanvasNodeLayoutSize): Point {
  const zoom = Math.max(0.01, scene.viewport.zoom || 1)
  const width = scene.viewportSize.width || 1_200
  const height = scene.viewportSize.height || 800
  return findFreeCanvasPosition(scene, size, {
    x: (width / 2 - scene.viewport.x) / zoom - size.width / 2,
    y: (height / 2 - scene.viewport.y) / zoom - size.height / 2,
  })
}
