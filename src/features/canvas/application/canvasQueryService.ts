import { findCanvasProjectInstance, getCanvasProjectInstance } from './canvasProjectInstances'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { canvasFromDocumentContent, canvasHistoryFromSessionState, DEFAULT_CANVAS_VIEWPORT, type Project, type ProjectSummary } from './canvasDocumentContent'
import { canvasDocumentCommands } from './canvasDocumentEnvironment'
import { listCanvasDocumentSummaries } from './canvasProjectService'

import { extractCanvasNodeData } from '../domain/nodeControlRegistry'
import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'

function projectSummary(project: ProjectSummary): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodeCount: project.nodeCount,
  }
}

function safeNodeData(node: CanvasNode, overview: boolean): Record<string, unknown> {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = extractCanvasNodeData(node.type, node.data as Record<string, unknown>) as Record<string, unknown>
  } catch {
    parsed = {}
  }
  const safe = Object.fromEntries(Object.entries(parsed).filter(([key]) => {
    if (overview) return ['modelId', 'status'].includes(key)
    const normalized = key.toLowerCase()
    return !normalized.includes('url')
      && !normalized.includes('path')
      && !normalized.includes('base64')
      && !normalized.includes('source')
  }))
  return {
    ...safe,
    ...(overview ? { displayName: String(node.data.displayName ?? '').slice(0, 160) } : {}),
    keys: Object.keys(parsed),
    hasMediaReference: Object.keys(parsed).some((key) => /url|path|source|media/i.test(key)),
  }
}

function nodeSummary(node: CanvasNode, selectedNodeId: string | null = null, overview = false): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    selected: selectedNodeId === node.id,
    data: safeNodeData(node, overview),
  }
}

function edgeSummary(edge: CanvasEdge): Record<string, unknown> {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? 'source',
    targetHandle: edge.targetHandle ?? 'target',
  }
}

export async function listCanvasProjectSummaries(): Promise<Record<string, unknown>[]> {
  return (await listCanvasDocumentSummaries()).map(projectSummary)
}

export async function readCanvasProjectSnapshot(projectId: string): Promise<Project> {
  return (await getCanvasProjectInstance(projectId)).snapshot()
}

/** 只读取已落盘的画布文件；后台任务终态不能用尚未确认的内存投影冒充持久结果。 */
export async function readPersistedCanvasProjectSnapshot(projectId: string): Promise<Project> {
  let read
  try {
    read = await canvasDocumentCommands().readDocument({ id: projectId })
  } catch (error) {
    if (error instanceof Error && error.name === 'DocumentNotFoundError') throw new Error('PROJECT_NOT_FOUND')
    throw error
  }
  const graph = canvasFromDocumentContent(read.content)
  return {
    id: read.meta.id, name: read.meta.name, createdAt: read.meta.createdAt, updatedAt: read.meta.updatedAt,
    nodeCount: graph.nodes.length, coverPath: null, ...graph,
    viewport: DEFAULT_CANVAS_VIEWPORT, history: { past: [], future: [] },
  }
}

export async function getCanvasProject(projectId: string): Promise<Record<string, unknown>> {
  const project = await readCanvasProjectSnapshot(projectId)
  const isCurrent = useProjectStore.getState().currentProject?.id === projectId
  const canvas = isCurrent ? useCanvasStore.getState() : null
  const nodes = canvas?.nodes ?? project.nodes
  const edges = canvas?.edges ?? project.edges
  const selectedNodeId = canvas?.selectedNodeId ?? null
  return {
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      viewport: canvas?.currentViewport ?? project.viewport,
      selectedNodeId,
    },
    nodes: nodes.slice(0, 100).map((node) => nodeSummary(node, selectedNodeId, true)),
    edges: edges.slice(0, 200).map(edgeSummary),
    truncated: nodes.length > 100 || edges.length > 200,
  }
}

export async function getCanvasNode(projectId: string, nodeId: string): Promise<Record<string, unknown>> {
  const project = await readCanvasProjectSnapshot(projectId)
  const isCurrent = useProjectStore.getState().currentProject?.id === projectId
  const canvas = isCurrent ? useCanvasStore.getState() : null
  const nodes = canvas?.nodes ?? project.nodes
  const edges = canvas?.edges ?? project.edges
  const node = nodes.find((item) => item.id === nodeId)
  if (!node) throw new Error('NOT_FOUND')
  const connectedEdges = edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map(edgeSummary)
  return { node: nodeSummary(node, canvas?.selectedNodeId ?? null), connectedEdges }
}

/**
 * 全部画布（含草稿与没打开的）的当前内容：打开着的取实例，其余读文件。
 * 用于跨画布查找引用（多图层文档回收、图片文档投影目标）；任一份读不懂就抛错，调用方按保守处理。
 */
export async function readAllCanvasProjects(): Promise<Project[]> {
  const documents = await canvasDocumentCommands().listDocuments({
    kind: 'canvas', container: { kind: 'any' }, includeDrafts: true, includeMissing: false,
  })
  const projects: Project[] = []
  for (const document of documents) {
    const instance = findCanvasProjectInstance(document.id)
    if (instance) {
      projects.push(instance.snapshot())
      continue
    }
    const project = await readPersistedCanvasProjectSnapshot(document.id)
    // 没打开的画布：撤销记录里引用到的资源也算在用（重新打开后还能撤销回来）；不核对版本，宁可多留。
    const stored = await canvasDocumentCommands().readSessionState({ docId: document.id, key: 'canvas.history' }).catch(() => null)
    const history = stored && typeof stored === 'object'
      ? canvasHistoryFromSessionState((stored as { history?: unknown }).history, project.imagePool ?? [])
      : null
    projects.push(history ? { ...project, history } : project)
  }
  return projects
}
