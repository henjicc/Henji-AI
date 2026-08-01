import { v4 as uuidv4 } from 'uuid'

import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { createLogger } from '@/core/logging'

import type { CanvasNodePlacement } from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import type { HostErrorCode } from '@/core/assistant/hostContracts'
import {
  DEFAULT_NODE_WIDTH,
  type CanvasEdge,
  type CanvasNode,
} from '../domain/canvasNodes'
import { parseCanvasNodeData } from '../domain/nodeControlRegistry'
import {
  getCanvasNodeDefinition,
  isConnectionCompatible,
} from '../domain/nodeRegistry'
import { getSourcePortMediaKind } from '../domain/nodePorts'
import {
  isParamPortId,
  resolveMediaTargetHandle,
  type RowMediaKind,
} from '../domain/socketTypes'
import { validateParamConnection } from './graphValueResolver'
import { undoCanvasBatch } from './canvasBatchService'

const MAX_UNDO_RECORDS = 100
const FOCUS_HANDLER_WAIT_MS = 2_000
const logger = createLogger('features.canvas.application')

interface UndoRecord {
  token: string
  projectId: string
  operation: string
  historyDepth: number
}

export class CanvasApplicationError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
    readonly recoverable = true,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CanvasApplicationError'
  }
}

type CanvasNodeFocusHandler = (nodeId: string) => Promise<void> | void

const undoRecords = new Map<string, UndoRecord>()
const focusHandlerListeners = new Set<() => void>()
let focusHandler: CanvasNodeFocusHandler | null = null

export function requireCurrentCanvasProject(projectId: string): void {
  const project = useProjectStore.getState()
  if (project.currentProjectId !== projectId || project.currentProject?.id !== projectId) {
    throw new CanvasApplicationError('STALE_CONTEXT', '当前画布项目与命令目标不一致', true, {
      expectedProjectId: projectId,
      currentProjectId: project.currentProjectId,
    })
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CanvasApplicationError('ABORTED', '画布操作已取消')
}

export async function openCanvasProject(
  projectId: string,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  logger.info('画布项目打开开始', { event: 'canvas.project.open.start', projectId })
  const projectStore = useProjectStore.getState()
  if (!projectStore.isHydrated) await projectStore.hydrate()
  throwIfAborted(signal)
  if (!useProjectStore.getState().projects.some((project) => project.id === projectId)) {
    throw new CanvasApplicationError('PROJECT_NOT_FOUND', '画布项目不存在', true, { projectId })
  }
  if (useProjectStore.getState().currentProjectId !== projectId) {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        unsubscribe()
        signal.removeEventListener('abort', onAbort)
        clearTimeout(timer)
        callback()
      }
      const onAbort = (): void => settle(() => reject(
        new CanvasApplicationError('ABORTED', '打开画布项目已取消')
      ))
      const unsubscribe = useProjectStore.subscribe((state) => {
        if (state.currentProjectId === projectId) settle(resolve)
        else if (!state.isOpeningProject) settle(() => reject(
          new CanvasApplicationError('PROJECT_NOT_FOUND', '画布项目无法打开', true, { projectId })
        ))
      })
      const timer = setTimeout(() => settle(() => reject(
        new CanvasApplicationError('DEADLINE_EXCEEDED', '打开画布项目超时', true, { projectId })
      )), 10_000)
      signal.addEventListener('abort', onAbort, { once: true })
      useProjectStore.getState().openProject(projectId)
    })
  }
  const project = useProjectStore.getState().currentProject
  if (!project || project.id !== projectId) {
    throw new CanvasApplicationError('PROJECT_NOT_FOUND', '画布项目无法打开', true, { projectId })
  }
  const canvas = useCanvasStore.getState()
  canvas.setCanvasData(project.nodes, project.edges, project.history)
  canvas.setViewportState(project.viewport)
  logger.info('画布项目打开完成', { event: 'canvas.project.open.completed', projectId })
  return { projectId }
}

export function persistCanvasState(): void {
  const canvas = useCanvasStore.getState()
  useProjectStore.getState().saveCurrentProject(
    canvas.nodes,
    canvas.edges,
    canvas.currentViewport,
    canvas.history
  )
}

export function rememberCanvasUndo(projectId: string, operation: string): string {
  const token = `canvas-undo:${uuidv4()}`
  undoRecords.set(token, {
    token,
    projectId,
    operation,
    historyDepth: useCanvasStore.getState().history.past.length,
  })
  while (undoRecords.size > MAX_UNDO_RECORDS) {
    const oldest = undoRecords.keys().next().value
    if (typeof oldest === 'string') undoRecords.delete(oldest)
  }
  return token
}

function resolveNodePosition(placement: CanvasNodePlacement): { x: number; y: number } {
  const canvas = useCanvasStore.getState()
  if (placement.mode === 'right_of_node') {
    if (!canvas.nodes.some((node) => node.id === placement.anchorNodeId)) {
      throw new CanvasApplicationError('NOT_FOUND', '布局锚点节点不存在', true, {
        anchorNodeId: placement.anchorNodeId,
      })
    }
    return canvas.findNodePosition(placement.anchorNodeId, DEFAULT_NODE_WIDTH, 240)
  }
  const zoom = Math.max(0.01, canvas.currentViewport.zoom || 1)
  const width = canvas.canvasViewportSize.width || 1_200
  const height = canvas.canvasViewportSize.height || 800
  return {
    x: (width / 2 - canvas.currentViewport.x) / zoom - DEFAULT_NODE_WIDTH / 2,
    y: (height / 2 - canvas.currentViewport.y) / zoom - 120,
  }
}

function createsCycle(sourceNodeId: string, targetNodeId: string, edges: CanvasEdge[]): boolean {
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) ?? []
    targets.push(edge.target)
    outgoing.set(edge.source, targets)
  }
  const pending = [targetNodeId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    if (current === sourceNodeId) return true
    visited.add(current)
    pending.push(...(outgoing.get(current) ?? []))
  }
  return false
}

function resolveConnectionHandles(sourceNode: CanvasNode, targetNode: CanvasNode): {
  sourceHandle: string
  targetHandle: string
} {
  const sourceHandle = 'source'
  const definition = getCanvasNodeDefinition(sourceNode.type)
  const mediaKind = getSourcePortMediaKind(definition?.ports, sourceHandle)
  const targetHandle = mediaKind && ['image', 'video', 'audio'].includes(mediaKind)
    ? resolveMediaTargetHandle(targetNode.type, mediaKind as RowMediaKind)
    : 'target'
  return { sourceHandle, targetHandle }
}

function isMatchingEdge(
  edge: CanvasEdge,
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle: string,
  targetHandle: string
): boolean {
  return edge.source === sourceNodeId
    && edge.target === targetNodeId
    && (edge.sourceHandle ?? 'source') === sourceHandle
    && (edge.targetHandle ?? 'target') === targetHandle
}

export function addCanvasNode(input: {
  projectId: string
  nodeType: string
  placement: CanvasNodePlacement
  data?: Record<string, unknown>
}): Record<string, unknown> {
  requireCurrentCanvasProject(input.projectId)
  const parsed = parseCanvasNodeData(input.nodeType, input.data)
  const position = resolveNodePosition(input.placement)
  const nodeId = useCanvasStore.getState().addNode(parsed.nodeType, position, parsed.data)
  const undoRef = rememberCanvasUndo(input.projectId, 'add_node')
  persistCanvasState()
  return { projectId: input.projectId, nodeId, nodeType: parsed.nodeType, position, undoRef }
}

export function connectCanvasNodes(input: {
  projectId: string
  sourceNodeId: string
  targetNodeId: string
}): Record<string, unknown> {
  requireCurrentCanvasProject(input.projectId)
  if (input.sourceNodeId === input.targetNodeId) {
    throw new CanvasApplicationError('INVALID_INPUT', '画布节点不能连接到自身')
  }
  const canvas = useCanvasStore.getState()
  const sourceNode = canvas.nodes.find((node) => node.id === input.sourceNodeId)
  const targetNode = canvas.nodes.find((node) => node.id === input.targetNodeId)
  if (!sourceNode || !targetNode) {
    throw new CanvasApplicationError('NOT_FOUND', '连接所需的画布节点不存在', true, {
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
    })
  }
  if (createsCycle(input.sourceNodeId, input.targetNodeId, canvas.edges)) {
    throw new CanvasApplicationError('CONFLICT', '该连接会形成画布循环依赖')
  }
  const handles = resolveConnectionHandles(sourceNode, targetNode)
  const paramValidation = isParamPortId(handles.targetHandle)
    ? validateParamConnection(
        sourceNode,
        targetNode,
        handles.targetHandle,
        canvas.nodes,
        canvas.edges,
        handles.sourceHandle
      )
    : null
  const compatible = paramValidation
    ? paramValidation.compatible
    : isConnectionCompatible(sourceNode.type, targetNode.type, handles.sourceHandle)
  if (!compatible) {
    throw new CanvasApplicationError('INVALID_INPUT', '节点端口类型不兼容', true, {
      sourceType: sourceNode.type,
      targetType: targetNode.type,
      reason: paramValidation?.reason ?? 'type-mismatch',
    })
  }
  const existing = canvas.edges.find((edge) => isMatchingEdge(
    edge,
    input.sourceNodeId,
    input.targetNodeId,
    handles.sourceHandle,
    handles.targetHandle
  ))
  if (existing) {
    throw new CanvasApplicationError('CONFLICT', '节点连接已存在', true, { edgeId: existing.id })
  }

  canvas.onConnect({
    source: input.sourceNodeId,
    target: input.targetNodeId,
    sourceHandle: handles.sourceHandle,
    targetHandle: handles.targetHandle,
  })
  const edge = useCanvasStore.getState().edges.find((item) => isMatchingEdge(
    item,
    input.sourceNodeId,
    input.targetNodeId,
    handles.sourceHandle,
    handles.targetHandle
  ))
  if (!edge) throw new CanvasApplicationError('CAPABILITY_REJECTED', '画布连接未能创建')
  const undoRef = rememberCanvasUndo(input.projectId, 'connect_nodes')
  persistCanvasState()
  return {
    projectId: input.projectId,
    edgeId: edge.id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    ...handles,
    undoRef,
  }
}

export function undoCanvasChange(projectId: string, undoRef: string): Record<string, unknown> {
  if (undoRef.startsWith('canvas-batch-undo:')) {
    const result = undoCanvasBatch(projectId, undoRef)
    if (result) return result
  }
  requireCurrentCanvasProject(projectId)
  const record = undoRecords.get(undoRef)
  if (!record || record.projectId !== projectId) {
    throw new CanvasApplicationError('NOT_FOUND', '画布撤销引用不存在或不属于当前项目')
  }
  const canvas = useCanvasStore.getState()
  if (canvas.history.past.length !== record.historyDepth) {
    throw new CanvasApplicationError('STALE_CONTEXT', '画布在该操作后已发生其它变化，旧撤销引用失效')
  }
  if (!canvas.undo()) throw new CanvasApplicationError('CONFLICT', '当前画布没有可撤销操作')
  undoRecords.delete(undoRef)
  persistCanvasState()
  return { projectId, undoRef, operation: record.operation, status: 'undone' }
}


export function registerCanvasNodeFocusHandler(handler: CanvasNodeFocusHandler): () => void {
  focusHandler = handler
  for (const listener of focusHandlerListeners) listener()
  return () => {
    if (focusHandler === handler) focusHandler = null
  }
}

async function waitForFocusHandler(signal: AbortSignal): Promise<CanvasNodeFocusHandler> {
  if (focusHandler) return focusHandler
  return await new Promise<CanvasNodeFocusHandler>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      focusHandlerListeners.delete(onReady)
    }
    const onReady = (): void => {
      if (!focusHandler) return
      const handler = focusHandler
      cleanup()
      resolve(handler)
    }
    const onAbort = (): void => {
      cleanup()
      reject(new CanvasApplicationError('ABORTED', '定位画布节点已取消'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new CanvasApplicationError('CAPABILITY_NOT_READY', '画布界面尚未准备好定位节点'))
    }, FOCUS_HANDLER_WAIT_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    focusHandlerListeners.add(onReady)
  })
}

export async function focusCanvasNode(
  projectId: string,
  nodeId: string,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  requireCurrentCanvasProject(projectId)
  if (!useCanvasStore.getState().nodes.some((node) => node.id === nodeId)) {
    throw new CanvasApplicationError('NOT_FOUND', '需要定位的画布节点不存在', true, { nodeId })
  }
  const handler = await waitForFocusHandler(signal)
  await handler(nodeId)
  return { projectId, nodeId, focused: true }
}

export function resetCanvasApplicationStateForTests(): void {
  undoRecords.clear()
  focusHandler = null
  focusHandlerListeners.clear()
}
