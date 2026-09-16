import { readGenerationConcurrency, subscribeGenerationConcurrency } from '@/core/settings/generationConcurrency'
import { isCanvasNodeUnavailable } from '../domain/nodeAvailability'
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
  CanvasNodeExecutionScheduler,
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
import type { CanvasTransactionRuntime } from './canvasPersistenceService'
import { getCanvasDomainExecutor } from './canvasDomainExecutors'
import { requireCanvasProjectInstance } from './canvasProjectInstances'
import { withCanvasProjectRuntime } from './canvasProjectRuntime'

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
  assertCurrent?: (store?: typeof useCanvasStore) => void
}

const logger = createLogger('features.canvas.execution')
const executors = new Map<string, CanvasRegisteredExecutor>()
const taskExecutors = new Map<string, CanvasRegisteredExecutor>()
const activeNodeRuns = new Map<string, ActiveNodeRun>()
let processingLimiter = createCanvasExecutionLimiter(4)
let generationLimiter = createCanvasExecutionLimiter(readGenerationConcurrency())
subscribeGenerationConcurrency(value => generationLimiter.setMaxConcurrency(value))

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

export function registerCanvasNodeExecutor(
  nodeId: string,
  executor: CanvasRegisteredExecutor,
  projectId = useProjectStore.getState().currentProjectId,
): () => void {
  if (!projectId) throw new Error('当前没有可执行的画布项目')
  const key = activeNodeKey(projectId, nodeId)
  executors.set(key, executor)
  return () => {
    if (executors.get(key) === executor) executors.delete(key)
  }
}

/** 任务持有执行器直到业务结束，页面挂载/卸载不能替换在途执行器。 */
export function retainCanvasTaskExecutor(projectId: string, nodeId: string, executor: CanvasRegisteredExecutor): () => void {
  const key = activeNodeKey(projectId, nodeId)
  if (taskExecutors.has(key)) throw new Error('此节点已有任务执行器，不能重复接管')
  taskExecutors.set(key, executor)
  return () => { if (taskExecutors.get(key) === executor) taskExecutors.delete(key) }
}

function getExecutor(nodeId: string, projectId = useProjectStore.getState().currentProjectId): CanvasRegisteredExecutor | undefined {
  return taskExecutors.get(activeNodeKey(projectId, nodeId))
    ?? executors.get(activeNodeKey(projectId, nodeId))
    ?? (projectId ? getCanvasDomainExecutor(projectId, nodeId) : undefined)
}
function hasExecutor(nodeId: string): boolean { return getExecutor(nodeId) !== undefined }

function getDependencyMode(nodeId: string, projectId = useProjectStore.getState().currentProjectId): CanvasDependencyMode {
  const executor = getExecutor(nodeId, projectId)
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

async function resolveCurrentInputSignature(nodeId: string, projectId: string): Promise<string> {
  const store = requireCanvasProjectInstance(projectId).store
  const executor = getExecutor(nodeId, projectId)
  if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
  const extras = await executor.getInputSignatureExtras?.(store)
  const snapshot = store.getState()
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
  projectId = useProjectStore.getState().currentProjectId,
): Promise<boolean> {
  if (!projectId) throw new Error('当前没有可执行的画布项目')
  return await resolveCurrentInputSignature(nodeId, projectId) === expectedInputSignature
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
  baseContext: Omit<CanvasNodeExecutionContext, 'inputSignature' | 'assertCurrent'> & { runtime: CanvasTransactionRuntime },
  runControl: CanvasRunControl,
  assertDependenciesCurrent: (store?: typeof useCanvasStore) => Promise<void>,
): Promise<NodeRunOutcome> {
  for (;;) {
    if (runControl.failure !== null) throw runControl.failure
    const prepared = await (async (store: typeof useCanvasStore) => {
      const canvas = store.getState()
      const node = getNodeIndexById(canvas.nodes).get(nodeId)
      if (!node) throw new Error(`画布执行节点不存在：${nodeId}`)
      const executor = getExecutor(nodeId, baseContext.projectId)
      if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
      assertExecutorMatchesNode(node, executor)
      const extras = await executor.getInputSignatureExtras?.(store)
      if (getExecutor(nodeId, baseContext.projectId) !== executor) return null
      const latestCanvas = store.getState()
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
      return { executor, latestCanvas, latestNode, inputSignature }
    })(baseContext.runtime.store)
    if (!prepared) continue
    const { executor, latestCanvas, latestNode, inputSignature } = prepared
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
      assertCurrent: async (store) => {
        baseContext.signal?.throwIfAborted()
        const assertInStore = async (targetStore: typeof useCanvasStore) => {
          runControl.assertCurrent?.(targetStore)
          const extras = await executor.getInputSignatureExtras?.(targetStore)
          const state = targetStore.getState()
          if (createExecutorInputSignature(nodeId, executor, state.nodes, state.edges, extras) !== inputSignature) {
            throw new CanvasInputChangedBeforeExecutionError()
          }
          await assertDependenciesCurrent(targetStore)
        }
        if (!baseContext.runtime.isCurrent()) throw new Error('原项目实例已变化，请重新核对任务。')
        return assertInStore(store ?? baseContext.runtime.store)
      },
    }
    const schedule: CanvasNodeExecutionScheduler = (operation, signal) => getExecutionLimiter(executor.kind).run(async () => {
      useCanvasExecutionStateStore.getState().beginNodeExecution(nodeId, {
        runId: context.runId,
        phase: getExecutionPhase(executor.kind),
      })
      try {
        if (runControl.failure !== null) {
          throw new CanvasRunCancelledBeforeExecutionError(context.runId, runControl.failure)
        }
        await executor.preflight?.(context)
        if (runControl.failure !== null) {
          throw new CanvasRunCancelledBeforeExecutionError(context.runId, runControl.failure)
        }
        await context.assertCurrent()
        const result = await operation()
        const runtime = baseContext.runtime
        const extras = await executor.getInputSignatureExtras?.(runtime.store)
        const state = runtime.store.getState()
        if (createExecutorInputSignature(nodeId, executor, state.nodes, state.edges, extras) !== inputSignature) {
          throw new Error('节点运行期间输入已变化；本次结果已保留，请重新运行后再继续下游')
        }
        await assertDependenciesCurrent(runtime.store)
        if (!runtime.isCurrent()) throw new Error('原项目实例在发布结果时发生变化，请查询已保存结果。')
        publishCanvasSuccessfulExecution({ sourceNodeId: nodeId, inputSignature, outputMode, resultNodeIds: result.resultNodeIds }, runtime.store)
        await runtime.persist()
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
    }, signal ?? baseContext.signal)
    const promise = executor.runQueued ? executor.runQueued(context, schedule) : schedule(() => executor.run(context))
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
  projectId: string,
  store: typeof useCanvasStore,
): Promise<Set<string>> {
  const reusable = new Set<string>()
  for (const nodeId of plan.orderedNodeIds) {
    if (nodeId === rootNodeId) continue
    const predecessors = plan.predecessorIdsByNode.get(nodeId) ?? []
    if (predecessors.some((predecessorId) => !reusable.has(predecessorId))) continue

    const beforeExtras = store.getState()
    const node = getNodeIndexById(beforeExtras.nodes).get(nodeId)
    const executor = getExecutor(nodeId, projectId)
    if (
      !node
      || !executor
      || resolveCanvasDependencyRunPolicy(node.data) !== 'reuse-if-valid'
      || activeNodeRuns.has(activeNodeKey(projectId, nodeId))
    ) continue
    const extras = await executor.getInputSignatureExtras?.(store)
    if (getExecutor(nodeId, projectId) !== executor) continue
    const snapshot = store.getState()
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

async function executeCanvasRun(rootNodeId: string, projectId: string, runtime: CanvasTransactionRuntime,
  assertCurrent?: (store?: typeof useCanvasStore) => void, signal?: AbortSignal): Promise<CanvasRunResult> {
  const runId = createRunId()
  const startedAt = Date.now()
  logger.info('画布节点运行开始', {
    event: 'canvas.execution.started', requestId: runId, rootNodeId, projectId,
  })

  const outcomeByNodeId = new Map<string, NodeRunOutcome>()
  const runControl: CanvasRunControl = { failure: null, assertCurrent }
  try {
    signal?.throwIfAborted()
    const store = runtime.store
    const plan = await (async () => {
      assertCurrent?.(store)
      const initial = store.getState()
      const root = initial.nodes.find((node) => node.id === rootNodeId)
      if (root && isCanvasNodeUnavailable(root)) throw new Error('节点的功能或模型已缺失，请删除或替换此节点')
      const plan = createCanvasExecutionPlan(
        rootNodeId,
        initial.nodes,
        initial.edges,
        id => getDependencyMode(id, projectId),
      )
      const rootExecutor = getExecutor(rootNodeId, projectId)
      if (!rootExecutor) throw new Error(`节点执行器尚未就绪：${rootNodeId}`)
      await rootExecutor.preflightBeforeDependencies?.({
        runId,
        projectId,
        trigger: 'direct',
        signal,
        runtime,
        store,
      })
      return plan
    })()

    const guaranteedReusable = await findGuaranteedReusableDependencies(
      plan,
      rootNodeId,
      projectId,
      store,
    )
    for (const nodeId of plan.dependencyNodeIds) {
      const executor = getExecutor(nodeId, projectId)
      if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
      if (!executor.preflightBeforeDependencies || guaranteedReusable.has(nodeId)) continue
      await executor.preflightBeforeDependencies({
        runId,
        projectId,
        trigger: 'dependency',
        signal,
        store,
        runtime,
      })
    }
    const taskByNodeId = new Map<string, Promise<NodeRunOutcome>>()
    const planExecutors = new Map(plan.orderedNodeIds.map(id => [id, getExecutor(id, projectId)]))
    for (const nodeId of plan.orderedNodeIds) {
      const executor = getExecutor(nodeId, projectId)
      if (!executor) throw new Error(`节点执行器尚未就绪：${nodeId}`)
      const predecessorTasks = (plan.predecessorIdsByNode.get(nodeId) ?? [])
        .map((predecessorId) => taskByNodeId.get(predecessorId))
        .filter((task): task is Promise<NodeRunOutcome> => Boolean(task))
      const assertDependenciesCurrent = async (store = runtime.store): Promise<void> => {
        const mode = (id: string): CanvasDependencyMode => {
          const entry = planExecutors.get(id)
          return entry ? entry.dependency?.mode === 'auto' ? 'auto' : 'boundary' : 'missing'
        }
        assertCanvasExecutionPlanCurrent(rootNodeId, plan, mode, store)
        for (const ancestorId of getCanvasExecutionAncestorIds(plan, nodeId)) {
          const outcome = outcomeByNodeId.get(ancestorId)
          const ancestor = planExecutors.get(ancestorId)
          const extras = await ancestor?.getInputSignatureExtras?.(store)
          const snapshot = store.getState()
          if (
            !outcome || !ancestor
            || createExecutorInputSignature(ancestorId, ancestor, snapshot.nodes, snapshot.edges, extras) !== outcome.inputSignature
          ) throw new Error(`上游节点输入已变化，请重新运行：${ancestorId}`)
        }
      }
      const task = Promise.all(predecessorTasks)
        .then(() => assertDependenciesCurrent(store))
        .then(() => executeRegisteredNode(nodeId, {
          runId,
          projectId,
          signal,
          store,
          runtime,
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
    const settled = await Promise.allSettled(taskByNodeId.values())
    const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
    if (rejected) throw rejected.reason

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

export function runCanvasNode(rootNodeId: string, assertCurrent?: (store?: typeof useCanvasStore) => void,
  projectId = useProjectStore.getState().currentProjectId, signal?: AbortSignal): Promise<CanvasRunResult> {
  if (!projectId) return Promise.reject(new Error('当前没有可执行的画布项目'))
  return withCanvasProjectRuntime(projectId, runtime => executeCanvasRun(rootNodeId, projectId, runtime, assertCurrent, signal))
}

export function isCanvasNodeRunActive(projectId: string, nodeId: string): boolean {
  return activeNodeRuns.has(activeNodeKey(projectId, nodeId))
}

/** 新节点完成 React 挂载前，调用方可等待正式执行器就绪。 */
export function isCanvasNodeExecutorReady(nodeId: string): boolean { return hasExecutor(nodeId) }

export function resetCanvasExecutionServiceForTests(): void {
  executors.clear()
  taskExecutors.clear()
  activeNodeRuns.clear()
  processingLimiter = createCanvasExecutionLimiter(4)
  generationLimiter = createCanvasExecutionLimiter(readGenerationConcurrency())
  resetCanvasExecutionReachabilityForTests()
  useCanvasExecutionStateStore.getState().resetNodeExecutions()
}
