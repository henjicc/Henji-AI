import { mapCanvasNodeMediaReferences, type CanvasMediaSchemaResolver } from './nodeMediaReferences'

export const PROJECT_IMAGE_REFERENCE_PREFIX = '__img_ref__:'
export type ProjectRecordField = 'nodesJson' | 'edgesJson' | 'viewportJson' | 'historyJson'
export interface CanvasProjectJsonRecord {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}
interface ProjectNode extends Record<string, unknown> {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}
interface ProjectEdge extends Record<string, unknown> { id: string; source: string; target: string }
interface ProjectGraph { nodes: ProjectNode[]; edges: ProjectEdge[] }
export interface ParsedCanvasProjectRecord extends ProjectGraph {
  viewport: { x: number; y: number; zoom: number }
  history: { past: ProjectGraph[]; future: ProjectGraph[] }
  imagePool: string[]
}

/** 错误只携带字段和原因，绝不携带 JSON 原文或解析器可能包含原文的 cause。 */
export class CanvasProjectRecordError extends Error {
  constructor(readonly field: ProjectRecordField, readonly reason: 'syntax' | 'structure' | 'media-reference') {
    super('工程数据无法安全读取，原内容未被修改。请重试打开，或从有效项目包导入为新工程。')
    this.name = 'CanvasProjectRecordError'
  }
}
function invalid(field: ProjectRecordField, reason: CanvasProjectRecordError['reason'] = 'structure'): never {
  throw new CanvasProjectRecordError(field, reason)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function parse(value: string, field: ProjectRecordField): unknown {
  if (typeof value !== 'string') return invalid(field)
  try { return JSON.parse(value) as unknown } catch { return invalid(field, 'syntax') }
}

export function parseCanvasProjectViewport(value: string): ParsedCanvasProjectRecord['viewport'] {
  const viewport = parse(value, 'viewportJson')
  if (!object(viewport) || !finite(viewport.x) || !finite(viewport.y)
    || !finite(viewport.zoom) || viewport.zoom <= 0) return invalid('viewportJson')
  return { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
}

export function decodeCanvasProjectImageReference(value: string, pool: readonly string[], field: ProjectRecordField): string {
  if (!value.startsWith(PROJECT_IMAGE_REFERENCE_PREFIX)) return value
  const suffix = value.slice(PROJECT_IMAGE_REFERENCE_PREFIX.length)
  const index = Number(suffix)
  if (!/^(0|[1-9]\d*)$/.test(suffix) || !Number.isSafeInteger(index) || index >= pool.length) {
    return invalid(field, 'media-reference')
  }
  return pool[index]
}

function validateGraph(nodes: unknown, edges: unknown, nodeField: ProjectRecordField,
  edgeField: ProjectRecordField, pool: readonly string[], resolveSchema: CanvasMediaSchemaResolver): ProjectGraph {
  if (!Array.isArray(nodes)) return invalid(nodeField)
  if (!Array.isArray(edges)) return invalid(edgeField)
  const ids = new Set<string>()
  for (const node of nodes as unknown[]) {
    if (!object(node) || !text(node.id) || ids.has(node.id) || !text(node.type)
      || !object(node.position) || !finite(node.position.x) || !finite(node.position.y)
      || !object(node.data)) return invalid(nodeField)
    ids.add(node.id)
    if (node.data.params !== undefined && !object(node.data.params)) {
      return invalid(nodeField)
    }
    mapCanvasNodeMediaReferences(node.data, (value) => decodeCanvasProjectImageReference(value, pool, nodeField), resolveSchema)
  }
  const edgeIds = new Set<string>()
  for (const edge of edges as unknown[]) {
    if (!object(edge) || !text(edge.id) || edgeIds.has(edge.id) || !text(edge.source)
      || !text(edge.target) || !ids.has(edge.source) || !ids.has(edge.target)) return invalid(edgeField)
    edgeIds.add(edge.id)
  }
  return { nodes: nodes as ProjectNode[], edges: edges as ProjectEdge[] }
}

/** 当前格式完整校验；合法大历史照常读取，不以字符数截断成可回写的空历史。 */
export function parseCanvasProjectRecord(record: CanvasProjectJsonRecord, resolveSchema: CanvasMediaSchemaResolver): ParsedCanvasProjectRecord {
  const history = parse(record.historyJson, 'historyJson')
  if (!object(history) || !Array.isArray(history.past) || !Array.isArray(history.future)
    || !Array.isArray(history.imagePool) || !history.imagePool.every(text)) {
    return invalid('historyJson')
  }
  const imagePool = history.imagePool as string[]
  const graph = validateGraph(parse(record.nodesJson, 'nodesJson'), parse(record.edgesJson, 'edgesJson'),
    'nodesJson', 'edgesJson', imagePool, resolveSchema)
  const validateHistory = (snapshots: unknown[]): ProjectGraph[] => snapshots.map((snapshot) => {
    if (!object(snapshot)) return invalid('historyJson')
    return validateGraph(snapshot.nodes, snapshot.edges, 'historyJson', 'historyJson', imagePool, resolveSchema)
  })
  return { ...graph, viewport: parseCanvasProjectViewport(record.viewportJson), imagePool,
    history: { past: validateHistory(history.past), future: validateHistory(history.future) } }
}
