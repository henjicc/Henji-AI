import { useCanvasStore } from '@/stores/canvasStore'
import { decodeProjectRecord, useProjectStore, type Project, type ProjectSummary } from '@/stores/projectStore'
import { getProjectRecord } from '@/commands/projectState'

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

function safeNodeData(node: CanvasNode): Record<string, unknown> {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = extractCanvasNodeData(node.type, node.data as Record<string, unknown>) as Record<string, unknown>
  } catch {
    parsed = {}
  }
  const safe = Object.fromEntries(Object.entries(parsed).filter(([key]) => {
    const normalized = key.toLowerCase()
    return !normalized.includes('url')
      && !normalized.includes('path')
      && !normalized.includes('base64')
      && !normalized.includes('source')
  }))
  return {
    ...safe,
    keys: Object.keys(parsed),
    hasMediaReference: Object.keys(parsed).some((key) => /url|path|source|media/i.test(key)),
  }
}

function nodeSummary(node: CanvasNode, selectedNodeId: string | null = null): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    selected: selectedNodeId === node.id,
    data: safeNodeData(node),
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
  const store = useProjectStore.getState()
  if (!store.isHydrated) await store.hydrate()
  return store.projects.map(projectSummary)
}

export async function readCanvasProjectSnapshot(projectId: string): Promise<Project> {
  const projectStore = useProjectStore.getState()
  if (!projectStore.isHydrated) await projectStore.hydrate()
  if (projectStore.currentProject?.id === projectId) {
    const canvas = useCanvasStore.getState()
    return {
      ...projectStore.currentProject,
      nodes: canvas.nodes,
      edges: canvas.edges,
      viewport: canvas.currentViewport,
      history: canvas.history,
      nodeCount: canvas.nodes.length,
    }
  }
  const record = await getProjectRecord(projectId)
  if (!record) throw new Error('PROJECT_NOT_FOUND')
  return decodeProjectRecord(record)
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
    nodes: nodes.slice(0, 100).map((node) => nodeSummary(node, selectedNodeId)),
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
