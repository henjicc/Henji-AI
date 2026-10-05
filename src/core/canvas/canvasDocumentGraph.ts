import { mapCanvasNodeMediaReferences, type CanvasMediaSchemaResolver } from './nodeMediaReferences'

/*
 * 画布文档节点图的完整校验（3.4，主进程与渲染层共用的纯模块）。
 *
 * 文档类型登记（kinds/canvas.ts）只校验外层结构；这里在打开时做失败关闭的完整校验：
 * 节点 ID 唯一、位置是有限数、连线两端存在、参数是对象、媒体字段里的 `__img_ref__:N` 引用都指向媒体池。
 * 缺失模型（schema 找不到）的参数保持不透明，不当成损坏（canvas.md“缺失节点的工程恢复”）。
 * 撤销记录（程序目录里的会话状态）用同一套规则校验，读不懂就丢弃。
 */

export const PROJECT_IMAGE_REFERENCE_PREFIX = '__img_ref__:'

export type CanvasGraphField = 'nodes' | 'edges' | 'history'

interface GraphNode extends Record<string, unknown> {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}
interface GraphEdge extends Record<string, unknown> { id: string; source: string; target: string }
export interface CanvasGraph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface ParsedCanvasDocumentGraph extends CanvasGraph { imagePool: string[] }
export interface ParsedCanvasHistory { past: CanvasGraph[]; future: CanvasGraph[] }

/** 错误只携带字段和原因，绝不携带原文（提示词等用户内容）。 */
export class CanvasDocumentGraphError extends Error {
  constructor(readonly field: CanvasGraphField, readonly reason: 'structure' | 'media-reference') {
    super('画布内容无法安全读取，原文件未被修改。请检查文件是否被其他程序改坏，或从项目包重新导入。')
    this.name = 'CanvasDocumentGraphError'
  }
}

function invalid(field: CanvasGraphField, reason: CanvasDocumentGraphError['reason'] = 'structure'): never {
  throw new CanvasDocumentGraphError(field, reason)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

/** 媒体池引用解码；不是引用的值原样返回。 */
export function decodeCanvasImageReference(value: string, pool: readonly string[], field: CanvasGraphField): string {
  if (!value.startsWith(PROJECT_IMAGE_REFERENCE_PREFIX)) return value
  const suffix = value.slice(PROJECT_IMAGE_REFERENCE_PREFIX.length)
  const index = Number(suffix)
  if (!/^(0|[1-9]\d*)$/.test(suffix) || !Number.isSafeInteger(index) || index >= pool.length) {
    return invalid(field, 'media-reference')
  }
  return pool[index]
}

export function parseCanvasGraph(
  nodes: unknown,
  edges: unknown,
  pool: readonly string[],
  resolveSchema: CanvasMediaSchemaResolver,
  field: { nodes: CanvasGraphField; edges: CanvasGraphField } = { nodes: 'nodes', edges: 'edges' },
): CanvasGraph {
  if (!Array.isArray(nodes)) return invalid(field.nodes)
  if (!Array.isArray(edges)) return invalid(field.edges)
  const ids = new Set<string>()
  for (const node of nodes as unknown[]) {
    if (!object(node) || !text(node.id) || ids.has(node.id) || !text(node.type)
      || !object(node.position) || !finite(node.position.x) || !finite(node.position.y)
      || !object(node.data)) return invalid(field.nodes)
    ids.add(node.id)
    if (node.data.params !== undefined && !object(node.data.params)) return invalid(field.nodes)
    mapCanvasNodeMediaReferences(node.data, (value) => decodeCanvasImageReference(value, pool, field.nodes), resolveSchema)
  }
  const edgeIds = new Set<string>()
  for (const edge of edges as unknown[]) {
    if (!object(edge) || !text(edge.id) || edgeIds.has(edge.id) || !text(edge.source)
      || !text(edge.target) || !ids.has(edge.source) || !ids.has(edge.target)) return invalid(field.edges)
    edgeIds.add(edge.id)
  }
  return { nodes: nodes as GraphNode[], edges: edges as GraphEdge[] }
}

function parsePool(value: unknown, field: CanvasGraphField): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(text)) return invalid(field)
  return value as string[]
}

/** 画布文档内容（内存形态）的完整校验。 */
export function parseCanvasDocumentGraph(content: unknown, resolveSchema: CanvasMediaSchemaResolver): ParsedCanvasDocumentGraph {
  if (!object(content)) return invalid('nodes')
  const imagePool = parsePool(content.imagePool, 'nodes')
  return { ...parseCanvasGraph(content.nodes, content.edges, imagePool, resolveSchema), imagePool }
}

/** 撤销记录（会话状态）的校验；快照与文档共用同一个媒体池。 */
export function parseCanvasHistory(value: unknown, pool: readonly string[], resolveSchema: CanvasMediaSchemaResolver): ParsedCanvasHistory {
  if (!object(value) || !Array.isArray(value.past) || !Array.isArray(value.future)) return invalid('history')
  const field = { nodes: 'history', edges: 'history' } as const
  const snapshots = (items: unknown[]): CanvasGraph[] => items.map((snapshot) => {
    if (!object(snapshot)) return invalid('history')
    return parseCanvasGraph(snapshot.nodes, snapshot.edges, pool, resolveSchema, field)
  })
  return { past: snapshots(value.past), future: snapshots(value.future) }
}
