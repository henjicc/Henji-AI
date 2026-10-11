import { solveAdaptiveLayout, solveStaticLayout, type LayoutItem } from '@/core/creativeIntent/layout'
import type { CandidateIdentity, LayoutConstraint } from '@/core/creativeIntent/contracts'
import type { CanvasNode } from '../domain/canvasNodes'

export const CANVAS_TIDY_MODES = ['align', 'distribute', 'grid'] as const
export type CanvasTidyMode = typeof CANVAS_TIDY_MODES[number]
export interface CanvasTidyPlacement { nodeId: string; position: { x: number; y: number } }
export interface CanvasTidyCandidate { mode: CanvasTidyMode; placements: CanvasTidyPlacement[]; unavailable?: string }

export function canvasTidySize(node: CanvasNode): { width: number; height: number } {
  const width = node.measured?.width ?? node.width
  const height = node.measured?.height ?? node.height
  if (!width || !height || width <= 0 || height <= 0 || ![width, height].every(Number.isFinite)) throw new Error('节点尚未完成测量，请稍后重新整理')
  return { width, height }
}

/** No viewport, content or edge traversal: validity depends only on geometry and membership. */
export function canvasTidyGeometryKey(nodes: readonly CanvasNode[]): string {
  return JSON.stringify(nodes.map(n => [n.id, n.position.x, n.position.y, n.measured?.width ?? n.width,
    n.measured?.height ?? n.height, n.parentId, n.draggable, n.hidden, n.selected, n.origin, n.extent]))
}

function itemFor(node: CanvasNode, projectId: string, locked: boolean): LayoutItem {
  const { width, height } = canvasTidySize(node)
  const x = node.position.x - width * (node.origin?.[0] ?? 0)
  const y = node.position.y - height * (node.origin?.[1] ?? 0)
  return { targetRef: { kind: 'canvas.node', id: `${projectId}:${node.id}` },
    affine: [1, 0, 0, 1, node.position.x, node.position.y],
    worldCorners: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], translationLocked: locked }
}

function align(id: string, items: LayoutItem[], axis: 'x' | 'y', reference = items[0]): LayoutConstraint {
  return { id, kind: 'align', targets: items.map(i => i.targetRef), axis, edge: 'start',
    reference: reference.targetRef, strength: 'hard', sourceRefs: [] }
}

/** Host adapter: partition local coordinate spaces, compile constraints, then delegate to the static kernel. */
export function solveCanvasTidy(nodes: readonly CanvasNode[], ids: readonly string[], pin: string | null,
  mode: CanvasTidyMode, identity: CandidateIdentity): CanvasTidyCandidate {
  try {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const selected = new Set(ids)
    if (selected.size < 2 || selected.size !== ids.length) throw new Error('请选择至少两个不同节点')
    if (pin && !selected.has(pin)) throw new Error('钉住的节点已不在选区，请重新整理')
    // Moving an ancestor must not move a locked descendant in world space. Selected
    // descendants are organized in their own container, so their ancestors stay put too.
    const fixedAncestors = new Set<string>()
    for (const node of nodes) {
      if (node.draggable !== false && !selected.has(node.id)) continue
      let parent = node.parentId
      const visited = new Set<string>()
      while (parent) {
        if (visited.has(parent)) throw new Error('容器层级存在循环，无法整理')
        visited.add(parent); fixedAncestors.add(parent)
        const ancestor = byId.get(parent)
        if (!ancestor) throw new Error('找不到节点的容器，请重新打开画布')
        parent = ancestor.parentId
      }
    }
    const groups = new Map<string, CanvasNode[]>()
    for (const id of ids) {
      const node = byId.get(id)
      if (!node || node.hidden) throw new Error('选区包含不可见或已删除的节点，请重新选择')
      const key = node.parentId ?? ''
      const group = groups.get(key) ?? []; group.push(node); groups.set(key, group)
    }
    const placements: CanvasTidyPlacement[] = []
    for (const [parentId, members] of groups) {
      const items = members.map(n => itemFor(n, identity.ownerRef.id,
        n.draggable === false || n.id === pin || fixedAncestors.has(n.id)))
      const constraints: LayoutConstraint[] = []
      const solveItems = [...items]
      if (items.length > 1) {
        if (mode === 'grid') {
          const ordered = [...items].sort((a, b) => a.worldCorners[0][1] - b.worldCorners[0][1] || a.worldCorners[0][0] - b.worldCorners[0][0])
          const columns = Math.ceil(Math.sqrt(items.length))
          const widths = Array<number>(columns).fill(0)
          const heights = Array<number>(Math.ceil(items.length / columns)).fill(0)
          ordered.forEach((i, k) => {
            widths[k % columns] = Math.max(widths[k % columns], i.worldCorners[1][0] - i.worldCorners[0][0])
            heights[Math.floor(k / columns)] = Math.max(heights[Math.floor(k / columns)], i.worldCorners[2][1] - i.worldCorners[0][1])
          })
          // Floating node titles live above the measured card. Leave room between rows.
          const gap = Math.max(48, [...widths, ...heights].reduce((min, n) => Math.min(min, n), Infinity) * .2)
          const offsets = (values: number[]): number[] => { let p = 0; return values.map(v => { const old = p; p += v + gap; return old }) }
          const xs = offsets(widths); const ys = offsets(heights)
          const anchor = Math.max(0, ordered.findIndex(i => i.translationLocked))
          const left = ordered[anchor].worldCorners[0][0] - xs[anchor % columns]
          const top = ordered[anchor].worldCorners[0][1] - ys[Math.floor(anchor / columns)]
          ordered.forEach((item, k) => {
            const x = left + xs[k % columns]; const y = top + ys[Math.floor(k / columns)]
            const target: LayoutItem = { targetRef: { kind: 'canvas.tidy_anchor', id: String(k) }, affine: [1, 0, 0, 1, x, y],
              worldCorners: [[x, y], [x + 1, y], [x + 1, y + 1]], translationLocked: true }
            solveItems.push(target)
            constraints.push(align(`grid-x-${k}`, [item, target], 'x', target), align(`grid-y-${k}`, [item, target], 'y', target))
          })
        } else {
          const ordered = [...items].sort((a, b) => a.worldCorners[0][0] - b.worldCorners[0][0])
          constraints.push(align('top', ordered, 'y', ordered.find(i => i.translationLocked) ?? ordered[0]))
          if (mode === 'distribute') {
            // The core spacing contract requires three members. A two-member row
            // gets an explicit locked edge anchor, without inventing a third node.
            if (ordered.length === 2) {
              const first = ordered[0]; const last = ordered[1]
              const anchor = first.translationLocked ? first : last.translationLocked ? last : first
              const other = anchor === first ? last : first
              const gap = Math.max(24, Math.min(...items.map(i => i.worldCorners[2][1] - i.worldCorners[0][1])) * .2)
              const x = anchor === first ? first.worldCorners[1][0] + gap : last.worldCorners[0][0] - gap - (first.worldCorners[1][0] - first.worldCorners[0][0])
              anchor.translationLocked = true
              const target: LayoutItem = { targetRef: { kind: 'canvas.tidy_anchor', id: 'pair' }, affine: [1, 0, 0, 1, x, anchor.worldCorners[0][1]],
                worldCorners: [[x, anchor.worldCorners[0][1]], [x + 1, anchor.worldCorners[0][1]], [x + 1, anchor.worldCorners[0][1] + 1]], translationLocked: true }
              solveItems.push(target); constraints.push(align('pair-x', [other, target], 'x', target))
            } else constraints.push({ id: 'spacing', kind: 'distribute', axis: 'x', targets: ordered.map(i => i.targetRef), strength: 'hard', sourceRefs: [] })
          }
        }
      }
      const result = mode === 'distribute' ? solveAdaptiveLayout(solveItems, constraints, identity) : solveStaticLayout(solveItems, constraints, identity)
      const parent = parentId ? byId.get(parentId) : undefined
      if (parentId && !parent) throw new Error('找不到节点的容器，请重新打开画布')
      const container = parent ? canvasTidySize(parent) : undefined
      for (let k = 0; k < members.length; k++) {
        const node = members[k]; const delta = result.changes[k].delta
        const position = { x: node.position.x + delta[0], y: node.position.y + delta[1] }
        const corners = items[k].worldCorners
        if (container && (corners[0][0] + delta[0] < -1e-8 || corners[0][1] + delta[1] < -1e-8 ||
          corners[2][0] + delta[0] > container.width + 1e-8 || corners[2][1] + delta[1] > container.height + 1e-8)) {
          throw new Error('此方案超出容器，请选择其他方案或先扩大容器')
        }
        placements.push({ nodeId: node.id, position })
      }
    }
    return { mode, placements }
  } catch (error) {
    return { mode, placements: [], unavailable: error instanceof Error ? error.message : '无法整理，请调整选区或解钉后重试' }
  }
}
