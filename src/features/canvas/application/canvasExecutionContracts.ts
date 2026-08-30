import type { CanvasNode } from '../domain/canvasNodes'
import type { CanvasNodeExecutionKind } from '../domain/nodeRegistry'
import type { CanvasDependencyOutputMode } from './canvasExecutionCache'

export type CanvasExecutionTrigger = 'direct' | 'dependency'

export interface CanvasNodePreflightContext {
  runId: string
  projectId: string | null
  trigger: CanvasExecutionTrigger
}

export interface CanvasNodeExecutionContext extends CanvasNodePreflightContext {
  inputSignature: string
  /** 异步准备完成后、真正发起付费请求前必须调用。 */
  assertCurrent: () => Promise<void>
}

export interface CanvasNodeExecutionResult {
  status: 'completed' | 'reused'
  resultNodeIds: string[]
}

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
  getInputSignatureExtras?: () => Promise<unknown> | unknown
  isCachedOutputValid?: (node: CanvasNode) => boolean
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
