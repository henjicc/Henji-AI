import type { z } from 'zod'

import type { AgentToolCompletionKind } from '../../../../../src/core/assistant/events'
import type { HostContextSnapshot, HostScope, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type {
  AgentDataClass,
  AgentToolCatalogEntry,
  AgentToolObservation,
  AgentToolPreview,
  AgentToolRisk,
  AgentToolSide,
} from '../../../../../src/core/assistant/toolContracts'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { ApplicationCapabilityDefinition } from '../../../../../src/core/assistant/applicationCapabilities'

export interface AgentToolRetryPolicy {
  maxRetries: number
  baseDelayMs: number
}

export interface AgentToolSemantics {
  whenToUse?: string[]
  avoidWhen?: string[]
  prerequisites?: string[]
  outputs?: string[]
  successEvidence?: string[]
  failureRecovery?: string[]
  completionKind?: AgentToolCompletionKind
  parallelSafe?: boolean
}

export interface AgentToolExecutionContext {
  runId: string
  threadId: string
  toolCallId: string
  signal: AbortSignal
  hostContext: HostContextSnapshot | null
}

export type AgentToolAuthorizationSource = 'direct' | 'approved_workflow' | 'approved_action_group'

export interface AgentToolDefinition<TInput = unknown, TOutput = unknown> {
  /** 应用宿主能力必须提供；运行时内部工具可以直接使用 Agent 工具契约。 */
  capability?: ApplicationCapabilityDefinition<TInput, TOutput>
  name: string
  version: number
  title: string
  description: string
  semantics?: AgentToolSemantics
  category: string
  side: AgentToolSide
  risk: AgentToolRisk
  permission: string
  readOnly: boolean
  destructive: boolean
  openWorld: boolean
  idempotent: boolean
  timeoutMs: number
  maxCallsPerRun?: number
  retryPolicy: AgentToolRetryPolicy
  supportsPreview: boolean
  supportsUndo: boolean
  requiredContext: HostScope[]
  resolveRequiredContext?: (input: TInput) => HostScope[]
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  aiInputSchema: Record<string, unknown>
  preview?: (input: TInput, context: AgentToolExecutionContext) => Promise<AgentToolPreview> | AgentToolPreview
  execute: (input: TInput, context: AgentToolExecutionContext) => Promise<TOutput>
  concurrencyKey: (input: TInput) => string
  targetIds: (input: TInput) => Record<string, string>
  dataClasses: (output: TOutput) => AgentDataClass[]
  summarize: (output: TOutput) => string
  /**
   * 结果写入对话历史时的投影；见 ApplicationCapabilityDefinition.projectForHistory。
   * 未声明时结果按原样内联。只影响 tool 消息，不影响 observation 本体与结算证据。
   */
  projectForHistory?: (output: TOutput) => unknown
  undo?: (output: TOutput) => AgentToolObservation['undo']
}

export interface AgentToolExecuteRequest {
  runId: string
  threadId: string
  toolCallId: string
  toolName: string
  input: unknown
  expectedRevisions?: Partial<HostScopeRevisions>
  approvalId?: string
  approvalMode: AgentApprovalMode
  explicitUserIntent: boolean
  authorizationSource?: AgentToolAuthorizationSource
  parentToolCallId?: string
  signal: AbortSignal
}

export interface AgentToolRegistration {
  catalog: AgentToolCatalogEntry
  modelTool: ModelStepTool
}
