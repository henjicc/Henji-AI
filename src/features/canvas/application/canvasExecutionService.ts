import { createLogger } from '@/core/logging'
import { useCanvasStore } from '@/stores/canvasStore'
import {
  type CanvasNodeExecutionPhase,
  useCanvasExecutionStateStore,
} from '@/stores/canvasExecutionStateStore'
import { useProjectStore } from '@/stores/projectStore'

import type { CanvasNode } from '../domain/canvasNodes'
import { getNodeIndexById } from '../domain/connectionIndex'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import {
  type CanvasDependencyOutputMode,
  createCanvasExecutionValueSignature,
  readCanvasLatestExecution,
  resolveCanvasDependencyRunPolicy,
} from './canvasExecutionCache'
import type {
  CanvasNodeExecutionContext,
  CanvasNodeExecutionResult,
  CanvasRegisteredExecutor,
  CanvasRunResult,
} from './canvasExecutionContracts'
import {
  createCanvasExecutionLimiter,
  type CanvasExecutionLimiter,
} from './canvasExecutionLimiter'
import {
  createCanvasExecutionPlan,
  getCanvasExecutionAncestorIds,
  type CanvasDependencyMode,
  type CanvasExecutionPlan,
} from './canvasExecutionPlan'
import { assertCanvasExecutionPlanCurrent } from './canvasExecutionConsistency'
import { publishCanvasSuccessfulExecution } from './canvasExecutionPublication'
import { createCanvasNodeInputSignature } from './canvasExecutionSignature'
import { resetCanvasExecutionReachabilityForTests } from './canvasExecutionReachability'
import { isCanvasExecutionOutputRefValid } from './graphOutputResolver'

export { hasReachableNonDisplayConsumer } from './canvasExecutionReachability'
export type {
  CanvasExecutionTrigger,
  CanvasNodeExecutionContext,
  CanvasNodeExecutionResult,
  CanvasNodePreflightContext,
  CanvasRegisteredExecutor,
  CanvasRunResult,
} from './canvasExecutionContracts'

interface ActiveNodeRun {
  inputSignature: string
  promise: Promise<CanvasNodeExecutionResult>
}

interface NodeRunOutcome {
  result: CanvasNodeExecutionResult
  joined: boolean
  inputSignature: string
}

class CanvasInputChangedBeforeExecutionError extends Error {}
class CanvasRunCancelledBeforeExecutionError extends Error {
  constructor(readonly ownerRunId: string, readonly cause: unknown) {
    super('画布运行已在其他分支失败')
  }
}

interface CanvasRunControl {
  failure: unknown | null
}

const logger = createLogger('features.canvas.execution')
const executors = new Map<string, CanvasRegisteredExecutor>()
const activeNodeRuns = new Map<string, ActiveNodeRun>()
let processingLimiter = createCanvasExecutionLimiter(4)
let generationLimiter = createCanvasExecutionLimiter(2)

function getExecutionPhase(kind: CanvasRegisteredExecutor['kind']): CanvasNodeExecutionPhase {
  return kind === 'text-processing' ? 'processing' : 'generating'
}

function getExecutionLimiter(kind: CanvasRegisteredExecutor['kind']): CanvasExecutionLimiter {
  return kind === 'text-processing' ? processingLimiter : generationLimiter
}

function createRunId(): string {
  return `canvas-run-${crypto.randomUUID()}`
}

function activeNodeKey(projectId: string | null, nodeId: string): string {
  return `${projectId ?? 'detached'}:${nodeId}`
}

function assertProjectContext(projectId: string | null): void {
  if (projectId && useProjectStore.getState().currentProjectId !== projectId) {
    throw new Error('画布项目已切换，本次运行已停止')
  }
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

function getDependencyMode(nodeId: string): CanvasDependencyMode {
  const executor = executors.get(nodeId)
  if (!executor) return 'missing'
  return executor.dependency?.mode === 'auto' ? 'auto' : 'boundary'
}

function assertExecutorMatchesNode(node: CanvasNode, executor: CanvasRegisteredExecutor): void {
  const declaredKind = getCanvasNodeDefinition(node.type)?.executionKind
  if (declaredKind !== executor.kind) throw new Error(`节点执行器类型不匹配：${node.id}`)
}

function createExecutorInputSignature(
  nodeId: string,
  executor: CanvasRegisteredExecutor,
  nodes: CanvasNode[],
  edges: ReturnType<typeof useCanvasStore.getState>['edges'],
  extras: unknown,
): string {
  if (executor.inputSignatureScope === 'runtime') {
    const node = getNodeIndexById(nodes).get(nodeId)
    if (!node) throw new Error(`画布执行节点不存在：${nodeId}`)
    return createCanvasExecutionValueSignature({
      contractVersion: 1,
      nodeType: node.type,
      executionKind: executor.kind,
      runtime: extras ?? null,
    })
  }
  return createCanvasNodeInputSignature(nodeId, nodes, edges, extras)
}

async function resolveCurrentInputSignature(nodeId: string): Promise<string> {
  const executor = executors.get(nodeId)
  if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
  const extras = await executor.getInputSignatureExtras?.()
  const snapshot = useCanvasStore.getState()
  const node = getNodeIndexById(snapshot.nodes).get(nodeId)
  if (!node) throw new Error(`画布执行节点不存在：${nodeId}`)
  assertExecutorMatchesNode(node, executor)
  return createExecutorInputSignature(
    nodeId,
    executor,
    snapshot.nodes,
    snapshot.edges,
    extras,
  )
}

/**
 * 恢复跨进程任务前校验其启动快照是否仍代表来源节点的当前输入。
 *
 * 运行时签名可能包含执行器异步准备出的媒体与参数，调用方不能退化为只比较
 * 画布节点 data；执行器尚未挂载或节点已删除时会抛错，由恢复流程按“不发布”处理。
 */
export async function isCanvasNodeInputSignatureCurrent(
  nodeId: string,
  expectedInputSignature: string,
): Promise<boolean> {
  return await resolveCurrentInputSignature(nodeId) === expectedInputSignature
}

function cachedResult(
  node: CanvasNode,
  inputSignature: string,
  outputMode: CanvasDependencyOutputMode,
  nodeById: ReadonlyMap<string, CanvasNode>,
  executor: CanvasRegisteredExecutor,
): CanvasNodeExecutionResult | null {
  if (resolveCanvasDependencyRunPolicy(node.data) !== 'reuse-if-valid') return null
  const latest = readCanvasLatestExecution(node.data)
  if (!latest || latest.inputSignature !== inputSignature || latest.outputMode !== outputMode) return null
  if (outputMode === 'inline') {
    const lastExecutionStatus = (node.data as DynamicValueMap).lastExecutionStatus
    if (lastExecutionStatus !== undefined && lastExecutionStatus !== 'success') return null
    if (executor.isCachedOutputValid?.(node) === false) return null
    return { status: 'reused', resultNodeIds: [] }
  }
  if (latest.outputRefs.length === 0) return null
  const valid = latest.outputRefs.every((reference) => (
    isCanvasExecutionOutputRefValid(node, reference, nodeById.get(reference.resultNodeId))
  ))
  return valid
    ? { status: 'reused', resultNodeIds: latest.outputRefs.map((reference) => reference.resultNodeId) }
    : null
}

async function executeRegisteredNode(
  nodeId: string,
  baseContext: Omit<CanvasNodeExecutionContext, 'inputSignature' | 'assertCurrent'>,
  runControl: CanvasRunControl,
  assertDependenciesCurrent: () => Promise<void>,
): Promise<NodeRunOutcome> {
  for (;;) {
    if (runControl.failure !== null) throw runControl.failure
    assertProjectContext(baseContext.projectId)
    const canvas = useCanvasStore.getState()
    const node = getNodeIndexById(canvas.nodes).get(nodeId)
    if (!node) throw new Error(`画布执行节点不存在：${nodeId}`)
    const executor = executors.get(nodeId)
    if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
    assertExecutorMatchesNode(node, executor)
    const extras = await executor.getInputSignatureExtras?.()
    if (executors.get(nodeId) !== executor) continue
    const latestCanvas = useCanvasStore.getState()
    const latestNode = getNodeIndexById(latestCanvas.nodes).get(nodeId)
    if (!latestNode) throw new Error(`画布执行节点不存在：${nodeId}`)
    assertExecutorMatchesNode(latestNode, executor)
    const inputSignature = createExecutorInputSignature(
      nodeId,
      executor,
      latestCanvas.nodes,
      latestCanvas.edges,
      extras,
    )
    const key = activeNodeKey(baseContext.projectId, nodeId)
    const active = activeNodeRuns.get(key)
    if (active) {
      if (active.inputSignature === inputSignature) {
        try {
          return { result: await active.promise, joined: true, inputSignature }
        } catch (error) {
          if (error instanceof CanvasInputChangedBeforeExecutionError) continue
          if (error instanceof CanvasRunCancelledBeforeExecutionError) {
            if (error.ownerRunId !== baseContext.runId) continue
            throw error.cause
          }
          throw error
        }
      }
      await active.promise.catch(() => undefined)
      continue
    }

    const outputMode = executor.dependency?.outputMode ?? 'inline'
    if (baseContext.trigger === 'dependency') {
      const reused = cachedResult(
        latestNode,
        inputSignature,
        outputMode,
        getNodeIndexById(latestCanvas.nodes),
        executor,
      )
      if (reused) return { result: reused, joined: false, inputSignature }
    }

    const context: CanvasNodeExecutionContext = {
      ...baseContext,
      inputSignature,
      assertCurrent: async () => {
        assertProjectContext(baseContext.projectId)
        if (
          executors.get(nodeId) !== executor
          || await resolveCurrentInputSignature(nodeId) !== inputSignature
        ) throw new CanvasInputChangedBeforeExecutionError()
        await assertDependenciesCurrent()
      },
    }
    const promise = getExecutionLimiter(executor.kind).run(async () => {
      useCanvasExecutionStateStore.getState().beginNodeExecution(nodeId, {
        runId: context.runId,
        phase: getExecutionPhase(executor.kind),
      })
      try {
        if (runControl.failure !== null) {
          throw new CanvasRunCancelledBeforeExecutionError(context.runId, runControl.failure)
        }
        if (executors.get(nodeId) !== executor) {
          throw new CanvasInputChangedBeforeExecutionError()
        }
        await executor.preflight?.(context)
        if (runControl.failure !== null) {
          throw new CanvasRunCancelledBeforeExecutionError(context.runId, runControl.failure)
        }
        await context.assertCurrent()
        const result = await executor.run(context)
        assertProjectContext(baseContext.projectId)
        if (await resolveCurrentInputSignature(nodeId) !== inputSignature) {
          throw new Error('节点运行期间输入已变化；本次结果已保留，请重新运行后再继续下游')
        }
        await assertDependenciesCurrent()
        publishCanvasSuccessfulExecution({
          sourceNodeId: nodeId,
          inputSignature,
          outputMode,
          resultNodeIds: result.resultNodeIds,
        })
        return result
      } catch (error) {
        if (
          !(error instanceof CanvasInputChangedBeforeExecutionError)
          && !(error instanceof CanvasRunCancelledBeforeExecutionError)
          && runControl.failure === null
        ) runControl.failure = error
        throw error
      } finally {
        useCanvasExecutionStateStore.getState().endNodeExecution(nodeId, context.runId)
      }
    })
    activeNodeRuns.set(key, { inputSignature, promise })
    try {
      return { result: await promise, joined: false, inputSignature }
    } catch (error) {
      if (error instanceof CanvasInputChangedBeforeExecutionError) {
        // 限流等待期间输入变化，释放旧 owner 后按最新快照重试。
      } else if (error instanceof CanvasRunCancelledBeforeExecutionError) {
        if (error.ownerRunId !== baseContext.runId) continue
        throw error.cause
      } else throw error
    } finally {
      if (activeNodeRuns.get(key)?.promise === promise) activeNodeRuns.delete(key)
    }
  }
}

async function findGuaranteedReusableDependencies(
  plan: CanvasExecutionPlan,
  rootNodeId: string,
  projectId: string | null,
): Promise<Set<string>> {
  const reusable = new Set<string>()
  for (const nodeId of plan.orderedNodeIds) {
    if (nodeId === rootNodeId) continue
    const predecessors = plan.predecessorIdsByNode.get(nodeId) ?? []
    if (predecessors.some((predecessorId) => !reusable.has(predecessorId))) continue

    const beforeExtras = useCanvasStore.getState()
    const node = getNodeIndexById(beforeExtras.nodes).get(nodeId)
    const executor = executors.get(nodeId)
    if (
      !node
      || !executor
      || resolveCanvasDependencyRunPolicy(node.data) !== 'reuse-if-valid'
      || activeNodeRuns.has(activeNodeKey(projectId, nodeId))
    ) continue
    const extras = await executor.getInputSignatureExtras?.()
    if (executors.get(nodeId) !== executor) continue
    const snapshot = useCanvasStore.getState()
    const nodeById = getNodeIndexById(snapshot.nodes)
    const latestNode = nodeById.get(nodeId)
    if (!latestNode) continue
    const signature = createExecutorInputSignature(
      nodeId,
      executor,
      snapshot.nodes,
      snapshot.edges,
      extras,
    )
    if (cachedResult(
      latestNode,
      signature,
      executor.dependency?.outputMode ?? 'inline',
      nodeById,
      executor,
    )) reusable.add(nodeId)
  }
  return reusable
}

async function executeCanvasRun(rootNodeId: string): Promise<CanvasRunResult> {
  const runId = createRunId()
  const projectId = useProjectStore.getState().currentProjectId
  const startedAt = Date.now()
  logger.info('画布节点运行开始', {
    event: 'canvas.execution.started', requestId: runId, rootNodeId, projectId,
  })

  const outcomeByNodeId = new Map<string, NodeRunOutcome>()
  const runControl: CanvasRunControl = { failure: null }
  try {
    const initial = useCanvasStore.getState()
    if (!executors.has(rootNodeId)) throw new Error(`节点执行器尚未就绪：${rootNodeId}`)
    const plan = createCanvasExecutionPlan(
      rootNodeId,
      initial.nodes,
      initial.edges,
      getDependencyMode,
    )
    const rootExecutor = executors.get(rootNodeId)
    if (!rootExecutor) throw new Error(`节点执行器尚未就绪：${rootNodeId}`)
    await rootExecutor.preflightBeforeDependencies?.({
      runId,
      projectId,
      trigger: 'direct',
    })
    assertProjectContext(projectId)

    const guaranteedReusable = await findGuaranteedReusableDependencies(
      plan,
      rootNodeId,
      projectId,
    )
    for (const nodeId of plan.dependencyNodeIds) {
      const executor = executors.get(nodeId)
      if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
      if (!executor.preflightBeforeDependencies || guaranteedReusable.has(nodeId)) continue
      await executor.preflightBeforeDependencies({
        runId,
        projectId,
        trigger: 'dependency',
      })
      assertProjectContext(projectId)
    }
    const taskByNodeId = new Map<string, Promise<NodeRunOutcome>>()
    for (const nodeId of plan.orderedNodeIds) {
      const executor = executors.get(nodeId)
      if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
      const predecessorTasks = (plan.predecessorIdsByNode.get(nodeId) ?? [])
        .map((predecessorId) => taskByNodeId.get(predecessorId))
        .filter((task): task is Promise<NodeRunOutcome> => Boolean(task))
      const assertDependenciesCurrent = async (): Promise<void> => {
        assertCanvasExecutionPlanCurrent(rootNodeId, plan, getDependencyMode)
        for (const ancestorId of getCanvasExecutionAncestorIds(plan, nodeId)) {
          const outcome = outcomeByNodeId.get(ancestorId)
          if (
            !outcome
            || await resolveCurrentInputSignature(ancestorId) !== outcome.inputSignature
          ) throw new Error(`上游节点输入已变化，请重新运行：${ancestorId}`)
        }
      }
      const task = Promise.all(predecessorTasks)
        .then(assertDependenciesCurrent)
        .then(() => executeRegisteredNode(nodeId, {
          runId,
          projectId,
          trigger: nodeId === rootNodeId ? 'direct' : 'dependency',
        }, runControl, assertDependenciesCurrent))
        .then((outcome) => {
          outcomeByNodeId.set(nodeId, outcome)
          return outcome
        })
        .catch((error: unknown) => {
          if (runControl.failure === null) runControl.failure = error
          throw error
        })
      taskByNodeId.set(nodeId, task)
    }
    await taskByNodeId.get(rootNodeId)

    const executedNodeIds = plan.orderedNodeIds.filter((nodeId) => {
      const outcome = outcomeByNodeId.get(nodeId)
      return outcome && !outcome.joined && outcome.result.status === 'completed'
    })
    const reusedNodeIds = plan.orderedNodeIds.filter((nodeId) => {
      const outcome = outcomeByNodeId.get(nodeId)
      return outcome && !outcome.joined && outcome.result.status === 'reused'
    })
    const joinedNodeIds = plan.orderedNodeIds.filter((nodeId) => outcomeByNodeId.get(nodeId)?.joined)
    const resultNodeIds = plan.orderedNodeIds.flatMap((nodeId) => (
      outcomeByNodeId.get(nodeId)?.result.resultNodeIds ?? []
    ))
    logger.info('画布节点运行完成', {
      event: 'canvas.execution.completed', requestId: runId, rootNodeId, projectId,
      executedNodeIds, reusedNodeIds, joinedNodeIds, durationMs: Date.now() - startedAt,
    })
    return { runId, rootNodeId, executedNodeIds, reusedNodeIds, joinedNodeIds, resultNodeIds }
  } catch (error) {
    logger.error('画布节点运行失败', error, {
      event: 'canvas.execution.failed', requestId: runId, rootNodeId, projectId,
      completedNodeIds: [...outcomeByNodeId.keys()], durationMs: Date.now() - startedAt,
    })
    throw error
  }
}

export function runCanvasNode(rootNodeId: string): Promise<CanvasRunResult> {
  return executeCanvasRun(rootNodeId)
}

export function resetCanvasExecutionServiceForTests(): void {
  executors.clear()
  activeNodeRuns.clear()
  processingLimiter = createCanvasExecutionLimiter(4)
  generationLimiter = createCanvasExecutionLimiter(2)
  resetCanvasExecutionReachabilityForTests()
  useCanvasExecutionStateStore.getState().resetNodeExecutions()
}
