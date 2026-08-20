import { createLogger } from '@/core/logging'
import { useCanvasStore } from '@/stores/canvasStore'
import {
  type CanvasNodeExecutionPhase,
  useCanvasExecutionStateStore,
} from '@/stores/canvasExecutionStateStore'

import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import { getCanvasNodeDefinition, type CanvasNodeExecutionKind } from '../domain/nodeRegistry'
import { getEdgesBySource, getEdgesByTarget, getNodeIndexById } from '../domain/connectionIndex'

export type CanvasExecutionTrigger = 'direct' | 'dependency'

export interface CanvasNodeExecutionContext {
  runId: string
  trigger: CanvasExecutionTrigger
}

export interface CanvasNodeExecutionResult {
  status?: 'completed' | 'reused' | 'skipped'
  resultNodeIds?: string[]
}

export interface CanvasRegisteredExecutor {
  kind: Exclude<CanvasNodeExecutionKind, 'text-display'>
  preflight?: (context: CanvasNodeExecutionContext) => Promise<void> | void
  run: (context: CanvasNodeExecutionContext) => Promise<CanvasNodeExecutionResult | void>
}

export interface CanvasRunResult {
  runId: string
  rootNodeId: string
  executedNodeIds: string[]
  reusedNodeIds: string[]
  resultNodeIds: string[]
}

const logger = createLogger('features.canvas.execution')
const executors = new Map<string, CanvasRegisteredExecutor>()
const activeNodeRuns = new Map<string, Promise<CanvasNodeExecutionResult>>()
const activeRootRuns = new Map<string, Promise<CanvasRunResult>>()

function getExecutionPhase(kind: CanvasRegisteredExecutor['kind']): CanvasNodeExecutionPhase {
  return kind === 'text-processing' ? 'processing' : 'generating'
}

function createRunId(): string {
  return `canvas-run-${crypto.randomUUID()}`
}

export function registerCanvasNodeExecutor(
  nodeId: string,
  executor: CanvasRegisteredExecutor,
): () => void {
  executors.set(nodeId, executor)
  return () => {
    if (executors.get(nodeId) === executor) executors.delete(nodeId)
  }
}

function collectRunnableDependencies(
  rootNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): string[] {
  const nodeById = getNodeIndexById(nodes)
  const edgesByTarget = getEdgesByTarget(edges)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: string[] = []

  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      throw new Error(`画布存在循环依赖，无法运行节点：${nodeId}`)
    }
    if (visited.has(nodeId)) return
    const node = nodeById.get(nodeId)
    if (!node) throw new Error(`画布依赖节点不存在：${nodeId}`)

    visiting.add(nodeId)
    for (const edge of edgesByTarget.get(nodeId) ?? []) visit(edge.source)
    visiting.delete(nodeId)
    visited.add(nodeId)

    if (
      nodeId !== rootNodeId
      && getCanvasNodeDefinition(node.type)?.executionKind === 'text-processing'
    ) {
      ordered.push(nodeId)
    }
  }

  visit(rootNodeId)
  return ordered
}

export function hasReachableNonDisplayConsumer(
  sourceNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): boolean {
  const nodeById = getNodeIndexById(nodes)
  const outgoing = getEdgesBySource(edges)
  const pending = [sourceNodeId]
  const visited = new Set<string>([sourceNodeId])
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    for (const edge of outgoing.get(current) ?? []) {
      const target = nodeById.get(edge.target)
      if (!target) continue
      if (getCanvasNodeDefinition(target.type)?.executionKind !== 'text-display') return true
      if (!visited.has(target.id)) {
        visited.add(target.id)
        pending.push(target.id)
      }
    }
  }
  return false
}

async function executeRegisteredNode(
  nodeId: string,
  context: CanvasNodeExecutionContext,
): Promise<{ result: CanvasNodeExecutionResult; shared: boolean }> {
  const active = activeNodeRuns.get(nodeId)
  if (active) return { result: await active, shared: true }

  const executor = executors.get(nodeId)
  if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
  const expectedKind = useCanvasStore.getState().nodes
    .find((node) => node.id === nodeId)
  const declaredKind = expectedKind
    ? getCanvasNodeDefinition(expectedKind.type)?.executionKind
    : undefined
  if (declaredKind !== executor.kind) {
    throw new Error(`节点执行器类型不匹配：${nodeId}`)
  }

  useCanvasExecutionStateStore.getState().beginNodeExecution(nodeId, {
    runId: context.runId,
    phase: getExecutionPhase(executor.kind),
  })
  const promise = Promise.resolve()
    .then(() => executor.run(context))
    .then((result) => result ?? {})
  activeNodeRuns.set(nodeId, promise)
  try {
    return { result: await promise, shared: false }
  } finally {
    if (activeNodeRuns.get(nodeId) === promise) activeNodeRuns.delete(nodeId)
    useCanvasExecutionStateStore.getState().endNodeExecution(nodeId, context.runId)
  }
}

async function executeCanvasRun(rootNodeId: string): Promise<CanvasRunResult> {
  const runId = createRunId()
  const startedAt = Date.now()
  logger.info('画布节点运行开始', {
    event: 'canvas.execution.started',
    requestId: runId,
    rootNodeId,
  })

  const executedNodeIds: string[] = []
  const reusedNodeIds: string[] = []
  const resultNodeIds: string[] = []

  try {
    const initial = useCanvasStore.getState()
    const dependencies = collectRunnableDependencies(rootNodeId, initial.nodes, initial.edges)
    const rootExecutor = executors.get(rootNodeId)
    if (!rootExecutor) throw new Error(`节点执行器尚未就绪：${rootNodeId}`)

    await rootExecutor.preflight?.({ runId, trigger: 'direct' })
    for (const dependencyNodeId of dependencies) {
      const execution = await executeRegisteredNode(dependencyNodeId, {
        runId,
        trigger: 'dependency',
      })
      if (execution.shared || execution.result.status === 'reused') reusedNodeIds.push(dependencyNodeId)
      else executedNodeIds.push(dependencyNodeId)
      resultNodeIds.push(...(execution.result.resultNodeIds ?? []))
    }

    const rootExecution = await executeRegisteredNode(rootNodeId, { runId, trigger: 'direct' })
    if (rootExecution.shared || rootExecution.result.status === 'reused') reusedNodeIds.push(rootNodeId)
    else executedNodeIds.push(rootNodeId)
    resultNodeIds.push(...(rootExecution.result.resultNodeIds ?? []))

    logger.info('画布节点运行完成', {
      event: 'canvas.execution.completed',
      requestId: runId,
      rootNodeId,
      executedNodeIds,
      reusedNodeIds,
      durationMs: Date.now() - startedAt,
    })
    return { runId, rootNodeId, executedNodeIds, reusedNodeIds, resultNodeIds }
  } catch (error) {
    logger.error('画布节点运行失败', error, {
      event: 'canvas.execution.failed',
      requestId: runId,
      rootNodeId,
      executedNodeIds,
      reusedNodeIds,
      durationMs: Date.now() - startedAt,
    })
    throw error
  }
}

export function runCanvasNode(rootNodeId: string): Promise<CanvasRunResult> {
  const active = activeRootRuns.get(rootNodeId)
  if (active) return active
  const promise = executeCanvasRun(rootNodeId)
  activeRootRuns.set(rootNodeId, promise)
  void promise.finally(() => {
    if (activeRootRuns.get(rootNodeId) === promise) activeRootRuns.delete(rootNodeId)
  }).catch(() => undefined)
  return promise
}

export function resetCanvasExecutionServiceForTests(): void {
  executors.clear()
  activeNodeRuns.clear()
  activeRootRuns.clear()
  useCanvasExecutionStateStore.getState().resetNodeExecutions()
}
