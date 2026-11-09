import dagre from '@dagrejs/dagre'
import { solveAdaptiveLayout, solveStaticLayout, type LayoutItem } from '@/core/creativeIntent/layout'
import type { CandidateIdentity, LayoutConstraint } from '@/core/creativeIntent/contracts'
import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import { resolveCanvasNodeLayoutSize } from '../domain/nodeRegistry'
import { nearbyTidyDeltas, type NearbyRect } from './canvasTidyNearby'

/** nearby（就近整理）排第一：用户说“整理一下”时默认它，只理顺不重排 */
export const CANVAS_TIDY_MODES = ['nearby', 'flow', 'align', 'distribute', 'grid'] as const
export type CanvasTidyMode = typeof CANVAS_TIDY_MODES[number]
export interface CanvasTidyPlacement { nodeId: string; position: { x: number; y: number } }
export interface CanvasTidyCandidate { mode: CanvasTidyMode; placements: CanvasTidyPlacement[]; unavailable?: string }

/** 尚未测量的节点按类型估值参与整理，不因同一回合刚建的节点而失败。 */
export function canvasTidySize(node: CanvasNode): { width: number; height: number } {
  return resolveCanvasNodeLayoutSize(node)
}

/** 方案只依赖几何、成员与连线方向；视口与节点内容变化不使方案失效。 */
export function canvasTidyGeometryKey(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[] = []): string {
  return JSON.stringify([nodes.map(n => [n.id, n.position.x, n.position.y, n.measured?.width ?? n.width,
    n.measured?.height ?? n.height, n.parentId, n.draggable, n.hidden, n.selected, n.origin, n.extent]),
  edges.map(e => [e.source, e.target])])
}

/** 同层节点之间留出浮动标题的高度，层与层之间留出连线可读的水平距离。 */
const FLOW_NODE_GAP = 48
const FLOW_RANK_GAP = 96

/**
 * 按连线方向分层：上游在左、下游在右，同层纵向排列。分层与交叉最少化交给 dagre，
 * 结果整体平移到钉住/锁定的节点不动，没有时保持选区原来的左上角。
 */
function flowDeltas(items: LayoutItem[], members: CanvasNode[], edges: readonly CanvasEdge[]): [number, number][] {
  const locked = items.filter(i => i.translationLocked)
  if (locked.length > 1) throw new Error('多个节点被钉住或锁定，无法按连线方向整理，请解钉后重试')
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: FLOW_NODE_GAP, ranksep: FLOW_RANK_GAP, marginx: 0, marginy: 0 })
  graph.setDefaultEdgeLabel(() => ({}))
  const ids = new Set(members.map(n => n.id))
  items.forEach((item, k) => graph.setNode(members[k].id, {
    width: item.worldCorners[1][0] - item.worldCorners[0][0], height: item.worldCorners[2][1] - item.worldCorners[0][1] }))
  for (const edge of edges) {
    if (edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target)) graph.setEdge(edge.source, edge.target)
  }
  dagre.layout(graph)
  const tops = members.map(n => { const { x, y, width, height } = graph.node(n.id); return [x - width / 2, y - height / 2] as const })
  let shift: [number, number]
  const anchor = locked[0] ? items.indexOf(locked[0]) : -1
  if (anchor >= 0) shift = [items[anchor].worldCorners[0][0] - tops[anchor][0], items[anchor].worldCorners[0][1] - tops[anchor][1]]
  else {
    const min = (values: number[]) => values.reduce((a, b) => Math.min(a, b), Infinity)
    shift = [min(items.map(i => i.worldCorners[0][0])) - min(tops.map(t => t[0])),
      min(items.map(i => i.worldCorners[0][1])) - min(tops.map(t => t[1]))]
  }
  return items.map((item, k) => [tops[k][0] + shift[0] - item.worldCorners[0][0], tops[k][1] + shift[1] - item.worldCorners[0][1]])
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
  mode: CanvasTidyMode, identity: CandidateIdentity, edges: readonly CanvasEdge[] = []): CanvasTidyCandidate {
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
      if (mode === 'flow' || mode === 'nearby') {
        // 流向整理与就近整理各有求解：dagre 给分层坐标、就近整理自带约束求解，下面与其他模式共用容器校验。
      } else if (items.length > 1) {
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
      const rectOf = (item: LayoutItem): NearbyRect => ({ x: item.worldCorners[0][0], y: item.worldCorners[0][1],
        width: item.worldCorners[1][0] - item.worldCorners[0][0], height: item.worldCorners[2][1] - item.worldCorners[0][1], locked: item.translationLocked })
      // 选区外同一容器里的节点不挪，但整理后的节点要避开它们
      const obstacles = nodes.filter(n => (n.parentId ?? '') === parentId && !selected.has(n.id) && !n.hidden)
        .map(n => rectOf(itemFor(n, identity.ownerRef.id, true)))
      const deltas = mode === 'nearby' ? nearbyTidyDeltas(items.map(rectOf), obstacles)
        : mode === 'flow' ? flowDeltas(items, members, edges)
        : (mode === 'distribute' ? solveAdaptiveLayout(solveItems, constraints, identity) : solveStaticLayout(solveItems, constraints, identity))
          .changes.slice(0, members.length).map(change => [change.delta[0], change.delta[1]] as [number, number])
      const parent = parentId ? byId.get(parentId) : undefined
      if (parentId && !parent) throw new Error('找不到节点的容器，请重新打开画布')
      const container = parent ? canvasTidySize(parent) : undefined
      for (let k = 0; k < members.length; k++) {
        const node = members[k]; const delta = deltas[k]
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
