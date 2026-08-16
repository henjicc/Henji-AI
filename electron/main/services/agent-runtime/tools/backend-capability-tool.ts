import type {
  ApplicationCapabilityDefinition,
} from '../../../../../src/core/assistant/applicationCapabilities'
import type { AgentToolDefinition, AgentToolExecutionContext } from './types'
import { defineAgentTool } from './define-tool'

export interface BackendCapabilityExecution<TInput, TOutput> {
  execute: (input: TInput, context: AgentToolExecutionContext) => Promise<TOutput>
  preview?: AgentToolDefinition<TInput, TOutput>['preview']
  outputLimitProfile?: AgentToolDefinition<TInput, TOutput>['outputLimitProfile']
}

export function createBackendCapabilityTool<TInput, TOutput>(
  capability: ApplicationCapabilityDefinition<TInput, TOutput>,
  execution: BackendCapabilityExecution<TInput, TOutput>
): AgentToolDefinition<TInput, TOutput> {
  if (capability.side !== 'backend') {
    throw new Error(`后端能力适配器不能注册前端能力：${capability.id}`)
  }
  return defineAgentTool({
    capability,
    name: capability.id,
    version: capability.version,
    title: capability.title,
    description: capability.description,
    category: capability.domain,
    side: capability.side,
    risk: capability.risk,
    permission: capability.permission,
    readOnly: capability.readOnly,
    destructive: capability.destructive,
    openWorld: capability.openWorld ?? false,
    idempotent: capability.idempotent,
    timeoutMs: capability.timeoutMs,
    maxCallsPerRun: capability.maxCallsPerRun,
    countsTowardCallLimit: capability.countsTowardCallLimit,
    retryPolicy: capability.retryPolicy ?? {
      maxRetries: capability.readOnly ? 1 : 0,
      baseDelayMs: capability.readOnly ? 100 : 0,
    },
    supportsPreview: capability.supportsPreview,
    supportsUndo: capability.supportsUndo,
    requiredContext: capability.requiredScopes,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    outputLimitProfile: execution.outputLimitProfile,
    aiInputSchema: capability.aiInputSchema,
    semantics: {
      whenToUse: [capability.description, ...capability.aliases.slice(0, 4)],
      prerequisites: capability.prerequisites,
      outputs: capability.producesRefs.length > 0
        ? [`产生引用：${capability.producesRefs.join('、')}`]
        : ['返回经过 schema 校验的应用事实。'],
      successEvidence: capability.successEvidence,
      failureRecovery: capability.failureRecovery,
      completionKind: capability.completionKind
        ?? (capability.readOnly ? 'observed' : 'executed'),
      parallelSafe: capability.parallelSafe ?? capability.readOnly,
    },
    preview: execution.preview ?? (
      capability.preview
        ? (input) => capability.preview?.(input) as ReturnType<NonNullable<typeof capability.preview>>
        : undefined
    ),
    execute: execution.execute,
    concurrencyKey: (input) => capability.resolveConcurrencyKey?.(input)
      ?? capability.concurrencyKey,
    targetIds: (input) => capability.resolveTargetIds?.(input) ?? {},
    dataClasses: (output) => capability.resolveDataClasses?.(output)
      ?? capability.dataClasses,
    summarize: (output) => capability.summarize?.(output)
      ?? `${capability.title}已完成。`,
    resolveObservedEffects: capability.resolveObservedEffects
      ? (input, output) => capability.resolveObservedEffects?.(input, output) ?? []
      : undefined,
    projectForHistory: capability.projectForHistory
      ? (output) => capability.projectForHistory?.(output)
      : undefined,
    inputExamples: capability.inputExamples,
    undo: capability.supportsUndo
      ? (output) => capability.createUndo?.(output)
      : undefined,
  })
}
