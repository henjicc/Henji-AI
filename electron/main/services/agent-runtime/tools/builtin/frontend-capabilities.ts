import {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY,
} from '../../../../../../src/core/assistant/builtinApplicationCapabilityRegistry'
import type {
  ApplicationCapabilityDefinition,
  ApplicationRef,
} from '../../../../../../src/core/assistant/applicationCapabilities'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import {
  eraseToolDefinition,
  requireFrontendSuccess,
  type FrontendToolInvoker,
} from './frontend-utils'

function targetIds(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const record = input as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const key of ['surfaceId', 'planRef', 'id'] as const) {
    if (typeof record[key] === 'string') result[key] = record[key]
  }
  for (const key of ['ref', 'sourceRef'] as const) {
    const value = record[key]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const ref = value as Partial<ApplicationRef>
    if (typeof ref.kind === 'string' && typeof ref.id === 'string') {
      result[`${key}Kind`] = ref.kind
      result[`${key}Id`] = ref.id
    }
  }
  return result
}

function concurrencyKey(definition: ApplicationCapabilityDefinition, input: unknown): string {
  if (definition.resolveConcurrencyKey) return definition.resolveConcurrencyKey(input)
  const targets = targetIds(input)
  const suffix = Object.values(targets).join(':')
  if (definition.domain === 'settings') return definition.concurrencyKey
  if (definition.domain === 'navigation') return definition.concurrencyKey
  return suffix ? `${definition.concurrencyKey}:${suffix}` : definition.concurrencyKey
}

function summarize(
  definition: ApplicationCapabilityDefinition,
  output: Record<string, unknown>
): string {
  if (definition.summarize) return definition.summarize(output)
  if (definition.id === 'search_application_settings') {
    const settings = output.settings
    return `已找到 ${Array.isArray(settings) ? settings.length : 0} 项相关设置。`
  }
  if (definition.id === 'list_generation_history') {
    const records = output.records
    return `已读取 ${Array.isArray(records) ? records.length : 0} 条生成记录。`
  }
  if (definition.id === 'apply_application_settings_change') {
    const applied = output.applied
    return `已应用 ${Array.isArray(applied) ? applied.length : 0} 项设置。`
  }
  return `${definition.title}已完成。`
}

function adaptCapability(
  definition: ApplicationCapabilityDefinition,
  invoke: FrontendToolInvoker
): AgentToolDefinition {
  return eraseToolDefinition(defineAgentTool({
    capability: definition,
    name: definition.id,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    category: definition.domain,
    side: definition.side,
    risk: definition.risk,
    permission: definition.permission,
    readOnly: definition.readOnly,
    destructive: definition.destructive,
    openWorld: definition.openWorld ?? false,
    idempotent: definition.idempotent,
    timeoutMs: definition.timeoutMs,
    maxCallsPerRun: definition.maxCallsPerRun,
    retryPolicy: definition.retryPolicy ?? {
      maxRetries: definition.readOnly ? 1 : 0,
      baseDelayMs: definition.readOnly ? 100 : 0,
    },
    supportsPreview: definition.supportsPreview,
    supportsUndo: definition.supportsUndo,
    requiredContext: definition.requiredScopes,
    resolveRequiredContext: definition.resolveRequiredScopes,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    aiInputSchema: definition.aiInputSchema,
    semantics: {
      whenToUse: [definition.description, ...definition.aliases.slice(0, 3)],
      prerequisites: definition.prerequisites,
      outputs: definition.producesRefs.length > 0
        ? [`产生引用：${definition.producesRefs.join('、')}`]
        : ['返回经过校验的应用状态。'],
      successEvidence: definition.successEvidence,
      failureRecovery: definition.failureRecovery,
      completionKind: definition.completionKind
        ?? (definition.readOnly ? 'observed' : 'executed'),
      parallelSafe: definition.parallelSafe ?? definition.readOnly,
    },
    execute: async (input, context) => {
      const requiredScopes = definition.resolveRequiredScopes?.(input) ?? definition.requiredScopes
      const expectedRevisions = context.hostContext
        ? Object.fromEntries(requiredScopes.flatMap((scope) => {
            const value = context.hostContext?.scopeRevisions[scope]
            return value === undefined ? [] : [[scope, value]]
          }))
        : undefined
      return requireFrontendSuccess(await invoke({
        kind: 'capability',
        capability: {
          id: definition.id,
          version: definition.version,
          input,
          expectedRevisions,
        },
      }, context))
    },
    preview: definition.preview
      ? (input) => definition.preview?.(input) as ReturnType<NonNullable<typeof definition.preview>>
      : undefined,
    concurrencyKey: (input) => concurrencyKey(definition, input),
    targetIds: (input) => definition.resolveTargetIds?.(input) ?? targetIds(input),
    dataClasses: (output) => definition.resolveDataClasses?.(output) ?? definition.dataClasses,
    summarize: (output) => summarize(
      definition,
      output && typeof output === 'object' && !Array.isArray(output)
        ? output as Record<string, unknown>
        : {}
    ),
    projectForHistory: definition.projectForHistory
      ? (output) => definition.projectForHistory?.(output)
      : undefined,
    undo: definition.supportsUndo
      ? (output) => {
          const declared = definition.createUndo?.(output)
          if (declared) return declared
          const record = output && typeof output === 'object' && !Array.isArray(output)
            ? output as Record<string, unknown>
            : {}
          const token = record.undoRef ?? record.previewRef
          return typeof token === 'string'
            ? { kind: `${definition.domain}_change`, token }
            : undefined
        }
      : undefined,
  }))
}

export function createFrontendApplicationCapabilityTools(
  invoke: FrontendToolInvoker
): AgentToolDefinition[] {
  return BUILTIN_APPLICATION_CAPABILITY_REGISTRY
    .list()
    .filter((definition) => definition.side === 'frontend')
    .map((definition) => adaptCapability(definition, invoke))
}
