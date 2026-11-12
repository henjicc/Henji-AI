import type { Viewport } from '@xyflow/react'

import type { CanvasDocumentContent } from '@/core/documents/kinds/canvas'
import { decodeCanvasImageReference, parseCanvasDocumentGraph, parseCanvasHistory } from '@/core/canvas/canvasDocumentGraph'
import type { CanvasEdge, CanvasHistorySnapshot, CanvasHistoryState, CanvasNode, CanvasNodeData } from '@/stores/canvasStore'

import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { createSnapshot } from '@/stores/canvasStoreHelpers'
import { resetTransientNodeRuntimeState } from '../domain/nodeMigrations'
import { mapCanvasNodeMediaReferences, resolveCanvasNodeMediaSchema } from './canvasNodeMediaReferences'

/*
 * 画布文档内容与内存画布之间的换算（3.4 画布接入）。
 *
 * - 文档内容（kinds/canvas.ts）= 节点、连线、可选媒体池（缺失模型的不透明参数用）、可选多图层包位置；
 *   位置都是绝对路径，换成相对写法由主进程整份完成，这里不声明路径字段。
 * - 写入前清掉节点里的瞬时运行状态（与原画布保存规则相同）：没有服务端任务的“生成中”落盘为失败提示等。
 * - 撤销记录与视口不写进文档，存在程序目录的会话状态里（见 canvasSessionState.ts）；撤销记录用同一套规则清理与校验。
 */

export const DEFAULT_CANVAS_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }
/** 程序目录里保留的撤销步数（与原画布记录一致）。 */
const MAX_PERSISTED_CANVAS_HISTORY_STEPS = 12

export interface ProjectSummary {
  /** 画布文档 ID。 */
  id: string
  /** 文档名（文件名去扩展名）。 */
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  /** 画布封面由通用文档封面按文档 ID 管理（3.4），这里恒为 null；保留字段只为兼容旧的构造写法。 */
  coverPath?: string | null
}

/** 一份打开的画布在内存里的快照（历史命名：Project 指一份画布文档）。 */
export interface Project extends ProjectSummary {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: Viewport
  history: CanvasHistoryState
  /** 保留缺失模型中无法识别的参数引用，原池索引不得重新编号。 */
  imagePool?: string[]
  /** 多图层节点内嵌图片文档的单文件包位置（文档 ID → 绝对路径），由 canvasLayers 维护。 */
  layerPackages?: Record<string, string>
}

export type CanvasGraphContent = Pick<Project, 'nodes' | 'edges' | 'imagePool' | 'layerPackages'>

function hasOpaqueParams(nodes: readonly CanvasNode[]): boolean {
  return nodes.some(({ data }) => typeof data.modelId === 'string' && data.params !== undefined
    && !resolveCanvasNodeMediaSchema(data.modelId))
}

/** 一次写入里共享的节点清理缓存：撤销快照与当前节点共用未修改的节点对象，只清理一次。 */
function createNodeCleaner(): (nodes: readonly CanvasNode[]) => CanvasNode[] {
  const cleaned = new Map<CanvasNode, CanvasNode>()
  return (nodes) => nodes.map((node) => {
    const cached = cleaned.get(node)
    if (cached) return cached
    const data = { ...(node.data as DynamicValueMap) }
    resetTransientNodeRuntimeState(node.type, data)
    if (node.type === CANVAS_NODE_TYPES.cameraStage) {
      // 恢复描述符仍由任务服务对账；作品中不保留正在渲染的视图状态。
      Object.assign(data, { imageExporting: false, videoExporting: false, videoProgress: null, videoRenderPhase: null })
    }
    const next = { ...node, data: data as CanvasNodeData }
    cleaned.set(node, next)
    return next
  })
}

function assertNoBlobMedia(value: unknown, pathLabel = 'canvas'): void {
  if (typeof value === 'string') {
    if (value.startsWith('blob:')) throw new Error(`Transient blob URL reached canvas persistence at ${pathLabel}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoBlobMedia(item, `${pathLabel}[${index}]`))
    return
  }
  if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, item]) => assertNoBlobMedia(item, `${pathLabel}.${key}`))
  }
}

/** 内存画布 → 文档内容。 */
export function canvasToDocumentContent(graph: CanvasGraphContent): CanvasDocumentContent {
  const clean = createNodeCleaner()
  const nodes = clean(graph.nodes)
  // 只有存在缺失模型的不透明参数时才需要媒体池（它们的 `__img_ref__:N` 指向这里）
  const imagePool = graph.imagePool?.length && hasOpaqueParams(graph.nodes) ? [...graph.imagePool] : undefined
  const content: CanvasDocumentContent = {
    nodes: nodes as unknown as CanvasDocumentContent['nodes'],
    edges: graph.edges as unknown as CanvasDocumentContent['edges'],
    ...(imagePool ? { imagePool } : {}),
    ...(graph.layerPackages && Object.keys(graph.layerPackages).length ? { layerPackages: { ...graph.layerPackages } } : {}),
  }
  if (import.meta.env.DEV) assertNoBlobMedia(content)
  return content
}

function decodeNodes(nodes: readonly CanvasNode[], pool: readonly string[], decoded?: Map<CanvasNode, CanvasNode>): CanvasNode[] {
  if (!pool.length) return [...nodes]
  return nodes.map((node) => {
    const cached = decoded?.get(node)
    if (cached) return cached
    const next = {
      ...node,
      data: mapCanvasNodeMediaReferences(node.data as DynamicValueMap,
        (value) => decodeCanvasImageReference(value, pool, 'nodes')) as CanvasNodeData,
    }
    decoded?.set(node, next)
    return next
  })
}

/** 文档内容 → 内存画布；节点图不合法时抛 CanvasDocumentGraphError（不留半个画布）。 */
export function canvasFromDocumentContent(content: unknown): CanvasGraphContent {
  const parsed = parseCanvasDocumentGraph(content, resolveCanvasNodeMediaSchema)
  const record = content as { layerPackages?: unknown }
  const layerPackages = record.layerPackages && typeof record.layerPackages === 'object' && !Array.isArray(record.layerPackages)
    ? Object.fromEntries(Object.entries(record.layerPackages as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0))
    : undefined
  return {
    nodes: decodeNodes(parsed.nodes as unknown as CanvasNode[], parsed.imagePool),
    edges: parsed.edges as unknown as CanvasEdge[],
    ...(parsed.imagePool.length ? { imagePool: parsed.imagePool } : {}),
    ...(layerPackages && Object.keys(layerPackages).length ? { layerPackages } : {}),
  }
}

/**
 * 会话状态里的撤销记录（程序目录里可随时丢弃的缓存，不是登记的持久格式）。
 * 内存撤销是结构共享的：相邻快照共用没改动的节点与连线对象。落盘也按对象去重，节点和连线各存一份，
 * 每步只记下标；否则 JSON 会把共享对象展开成每步一份完整画布，写入量随步数成倍增长。
 * 旧写法（每步一份完整的 nodes/edges）仍能读。
 */
const POOLED_HISTORY_VERSION = 2

interface PooledHistoryStep { nodes: number[]; edges: number[] }
export interface PooledCanvasHistory {
  version: typeof POOLED_HISTORY_VERSION
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  past: PooledHistoryStep[]
  future: PooledHistoryStep[]
}

/** 撤销记录写进会话状态前：裁到上限、清理瞬时状态，并按对象去重。 */
export function canvasHistoryForSessionState(history: CanvasHistoryState): PooledCanvasHistory {
  const clean = createNodeCleaner()
  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []
  const nodeIndex = new Map<CanvasNode, number>()
  const edgeIndex = new Map<CanvasEdge, number>()
  const indexOf = <T>(item: T, index: Map<T, number>, items: T[]): number => {
    let at = index.get(item)
    if (at === undefined) { at = items.push(item) - 1; index.set(item, at) }
    return at
  }
  const step = (item: CanvasHistorySnapshot): PooledHistoryStep => ({
    nodes: clean(createSnapshot(item.nodes, item.edges).nodes).map(node => indexOf(node, nodeIndex, nodes)),
    edges: item.edges.map(edge => indexOf(edge, edgeIndex, edges)),
  })
  const past = history.past.slice(-MAX_PERSISTED_CANVAS_HISTORY_STEPS).map(step)
  const future = history.future.slice(-MAX_PERSISTED_CANVAS_HISTORY_STEPS).map(step)
  return { version: POOLED_HISTORY_VERSION, nodes, edges, past, future }
}

/** 去重写法还原成每步一份 nodes/edges（共用同一批对象），交给与文档相同的图校验；下标不合法时抛错。 */
function expandPooledHistory(value: unknown): unknown {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== POOLED_HISTORY_VERSION) return value
  const { nodes, edges, past, future } = value as Record<string, unknown>
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(past) || !Array.isArray(future)) throw new Error('invalid history')
  const pick = (indexes: unknown, items: unknown[]): unknown[] => {
    if (!Array.isArray(indexes)) throw new Error('invalid history')
    return indexes.map((at) => {
      if (!Number.isInteger(at) || (at as number) < 0 || (at as number) >= items.length) throw new Error('invalid history')
      return items[at as number]
    })
  }
  const step = (item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('invalid history')
    const { nodes: nodeIndexes, edges: edgeIndexes } = item as Record<string, unknown>
    return { nodes: pick(nodeIndexes, nodes), edges: pick(edgeIndexes, edges) }
  }
  return { past: past.map(step), future: future.map(step) }
}

/** 会话状态里的撤销记录 → 内存；读不懂时返回 null（丢弃撤销记录，不影响打开）。 */
export function canvasHistoryFromSessionState(value: unknown, pool: readonly string[] = []): CanvasHistoryState | null {
  try {
    const parsed = parseCanvasHistory(expandPooledHistory(value), pool, resolveCanvasNodeMediaSchema)
    // 同一个节点对象只解码一次，还原后各步仍共用对象，和编辑时的内存撤销一样。
    const decoded = new Map<CanvasNode, CanvasNode>()
    const snapshot = (item: { nodes: unknown[]; edges: unknown[] }): CanvasHistorySnapshot => ({
      nodes: decodeNodes(item.nodes as CanvasNode[], pool, decoded),
      edges: item.edges as CanvasEdge[],
    })
    return { past: parsed.past.map(snapshot), future: parsed.future.map(snapshot) }
  } catch {
    return null
  }
}

export function parseCanvasViewport(value: unknown): Viewport | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, zoom } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) return null
  return { x, y, zoom }
}
