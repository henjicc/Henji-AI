import type { CanvasTransactionRuntime } from './canvasPersistenceService'
import type { CanvasNode } from '../domain/canvasNodes'
import type { CanvasNodeExecutionKind } from '../domain/nodeRegistry'
import type { CanvasDependencyOutputMode } from './canvasExecutionCache'
import type { useCanvasStore } from '@/stores/canvasStore'

export type CanvasExecutionTrigger = 'direct' | 'dependency'

export interface CanvasNodePreflightContext {
  signal?: AbortSignal
  runtime?: CanvasTransactionRuntime
  store?: typeof useCanvasStore
  runId: string
  projectId: string | null
  trigger: CanvasExecutionTrigger
}

export interface CanvasNodeExecutionContext extends CanvasNodePreflightContext {
  inputSignature: string
  /** 异步准备完成后、真正发起付费请求前必须调用。 */
  assertCurrent: (store?: typeof useCanvasStore) => Promise<void>
}

export interface CanvasNodeExecutionResult {
  status: 'completed' | 'reused'
  resultNodeIds: string[]
}

export type CanvasNodeExecutionScheduler = (
  operation: () => Promise<CanvasNodeExecutionResult>, signal?: AbortSignal,
) => Promise<CanvasNodeExecutionResult>

export interface CanvasRegisteredExecutor {
  kind: Exclude<CanvasNodeExecutionKind, 'text-display'>
  dependency?: {
    mode: 'auto' | 'manual'
    outputMode: CanvasDependencyOutputMode
  }
  /** 只检查不依赖上游结果的配置，避免目标必然失败时先消耗上游额度。 */
  preflightBeforeDependencies?: (context: CanvasNodePreflightContext) => Promise<void> | void
  preflight?: (context: CanvasNodeExecutionContext) => Promise<void> | void
  inputSignatureScope?: 'graph' | 'runtime'
  getInputSignatureExtras?: (store?: typeof useCanvasStore) => Promise<unknown> | unknown
  isCachedOutputValid?: (node: CanvasNode) => boolean
  /** 在等待执行名额之前持有任务；实际业务仍必须通过 schedule 进入共用执行队列。 */
  runQueued?: (context: CanvasNodeExecutionContext, schedule: CanvasNodeExecutionScheduler) => Promise<CanvasNodeExecutionResult>
  run: (context: CanvasNodeExecutionContext) => Promise<CanvasNodeExecutionResult>
}

export interface CanvasRunResult {
  runId: string
  rootNodeId: string
  executedNodeIds: string[]
  reusedNodeIds: string[]
  joinedNodeIds: string[]
  resultNodeIds: string[]
}
