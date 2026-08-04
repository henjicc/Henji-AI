import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { CanvasBatchOperation } from '../../../../../src/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import type { CanvasNodePlacement } from '../../../../../src/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import type { AgentToolRegistry } from '../tools/registry'
import { digestJson } from '../tools/security'
import type { AgentTaskActionGroup } from '../../../../../src/core/assistant/taskGraph'

export const COMPILED_ACTION_GROUP_VERSION = 'compiled-action-group/v1' as const

export interface CompiledActionGroup {
  version: typeof COMPILED_ACTION_GROUP_VERSION
  actionGroupId: string
  digest: string
  mode: 'parallel_read' | 'atomic_batch' | 'ordered_write' | 'dependent'
  memberCalls: readonly ModelStepToolCall[]
  executableCalls: readonly ModelStepToolCall[]
  reversible: boolean
  atomic: boolean
  canvasBatch?: Readonly<{ projectId: string; operations: readonly CanvasBatchOperation[] }>
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}

function freezeCalls(calls: ModelStepToolCall[]): ModelStepToolCall[] {
  return calls.map((call) => deepFreeze(structuredClone(call)))
}

function canvasOperation(call: ModelStepToolCall): { projectId: string; operation: CanvasBatchOperation } | null {
  const input = asRecord(call.input)
  if (!input || typeof input.projectId !== 'string') return null
  switch (call.toolName) {
    case 'add_canvas_node':
      return { projectId: input.projectId, operation: {
        kind: 'add_node', nodeType: input.nodeType as string,
        placement: input.placement as CanvasNodePlacement,
        ...(input.data ? { data: input.data as Record<string, unknown> } : {}),
      } }
    case 'duplicate_canvas_node':
      return { projectId: input.projectId, operation: {
        kind: 'duplicate_node', nodeId: input.nodeId as string,
        placement: input.placement as CanvasNodePlacement,
      } }
    case 'update_canvas_node':
      return { projectId: input.projectId, operation: {
        kind: 'update_node', nodeId: input.nodeId as string, data: input.data as Record<string, unknown>,
      } }
    case 'delete_canvas_nodes':
      return { projectId: input.projectId, operation: {
        kind: 'delete_nodes', nodeIds: input.nodeIds as string[],
      } }
    case 'connect_canvas_nodes':
      return { projectId: input.projectId, operation: {
        kind: 'connect_nodes', sourceNodeId: input.sourceNodeId as string,
        targetNodeId: input.targetNodeId as string,
      } }
    case 'group_canvas_nodes':
      return { projectId: input.projectId, operation: {
        kind: 'group_nodes', nodeIds: input.nodeIds as string[],
      } }
    case 'select_canvas_node':
      return { projectId: input.projectId, operation: {
        kind: 'select_node', nodeId: input.nodeId as string | null,
      } }
    case 'disconnect_canvas_edge':
      return { projectId: input.projectId, operation: {
        kind: 'disconnect_edge', edgeId: input.edgeId as string,
      } }
    default:
      return null
  }
}

function compileCanvasBatch(
  calls: ModelStepToolCall[],
  expectedRevisions: Partial<HostScopeRevisions>,
  registry: AgentToolRegistry
): CompiledActionGroup | null {
  if (calls.length < 2) return null
  const parsed = calls.map((call) => {
    const definition = registry.get(call.toolName)
    if (!definition?.inputSchema.safeParse(call.input).success) return null
    return canvasOperation(call)
  })
  if (parsed.some((item) => !item)) return null
  const operations = parsed.flatMap((item) => item ? [item.operation] : [])
  const projectIds = new Set(parsed.flatMap((item) => item ? [item.projectId] : []))
  if (projectIds.size !== 1 || operations.length > 20) return null
  const projectId = parsed[0]?.projectId
  if (!projectId) return null
  const digest = digestJson({
    version: COMPILED_ACTION_GROUP_VERSION,
    projectId,
    operations,
    expectedRevisions,
  })
  return deepFreeze({
    version: COMPILED_ACTION_GROUP_VERSION,
    actionGroupId: `canvas_${digest.slice(-16)}`,
    digest,
    mode: 'atomic_batch',
    memberCalls: Object.freeze([...calls]),
    executableCalls: Object.freeze([]),
    reversible: true,
    atomic: true,
    canvasBatch: { projectId, operations },
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function compileReflectionTransaction(
  calls: ModelStepToolCall[],
  expectedRevisions: Partial<HostScopeRevisions>,
  registry: AgentToolRegistry
): CompiledActionGroup | null {
  if (calls.length < 2 || calls.some((call) => call.toolName !== 'change_application_entities')) return null
  const inputs = calls.flatMap((call) => {
    const definition = registry.get(call.toolName)
    const parsed = definition?.inputSchema.safeParse(call.input)
    return parsed?.success ? [parsed.data as Record<string, unknown>] : []
  })
  if (inputs.length !== calls.length) return null
  const changes = inputs.flatMap((input) => Array.isArray(input.changes) ? input.changes : [])
  if (changes.length < 2 || changes.length > 32) return null
  const compatibilityRevisions = inputs.flatMap((input) => (
    input.expectedRevisions === undefined ? [] : [input.expectedRevisions]
  ))
  if (
    compatibilityRevisions.length > 1
    && compatibilityRevisions.some((value) => JSON.stringify(value) !== JSON.stringify(compatibilityRevisions[0]))
  ) return null
  const mergedInput = {
    summary: inputs.map((input) => String(input.summary ?? '')).filter(Boolean).join('；').slice(0, 200),
    changes,
  }
  const executable = deepFreeze({
    ...calls[0],
    input: mergedInput,
  }) as ModelStepToolCall
  const digest = digestJson({
    version: COMPILED_ACTION_GROUP_VERSION,
    calls: calls.map((call) => ({ toolName: call.toolName, input: call.input })),
    expectedRevisions,
  })
  return deepFreeze({
    version: COMPILED_ACTION_GROUP_VERSION,
    actionGroupId: `reflection_${digest.slice(-16)}`,
    digest,
    mode: 'atomic_batch',
    memberCalls: Object.freeze([...calls]),
    executableCalls: Object.freeze([executable]),
    reversible: true,
    // 通用事务使用逐步补偿；只有领域原生事务才标记 atomic。
    atomic: false,
  })
}

type ActionGroupHint = Pick<AgentTaskActionGroup, 'actionGroupId' | 'mode'>

function compileCallSet(
  calls: ModelStepToolCall[],
  expectedRevisions: Partial<HostScopeRevisions>,
  registry: AgentToolRegistry,
  hint: ActionGroupHint | null
): CompiledActionGroup {
  const canvas = hint?.mode === 'atomic_batch' || !hint
    ? compileCanvasBatch(calls, expectedRevisions, registry)
    : null
  if (canvas) return hint
    ? deepFreeze({
        ...canvas,
        actionGroupId: hint.actionGroupId,
        digest: digestJson({ digest: canvas.digest, actionGroupId: hint.actionGroupId, mode: hint.mode }),
      })
    : canvas
  const reflection = hint?.mode === 'atomic_batch' || !hint
    ? compileReflectionTransaction(calls, expectedRevisions, registry)
    : null
  if (reflection) return hint
    ? deepFreeze({
        ...reflection,
        actionGroupId: hint.actionGroupId,
        digest: digestJson({ digest: reflection.digest, actionGroupId: hint.actionGroupId, mode: hint.mode }),
      })
    : reflection
  const metadata = calls.map((call) => registry.executionMetadata(call.toolName, call.input))
  const digest = digestJson({ calls: calls.map((call) => ({
    toolName: call.toolName, input: call.input,
  })), expectedRevisions })
  return deepFreeze({
    version: COMPILED_ACTION_GROUP_VERSION,
    actionGroupId: hint?.actionGroupId ?? `calls_${digest.slice(-16)}`,
    digest: digestJson({ digest, actionGroupId: hint?.actionGroupId ?? null, mode: hint?.mode ?? null }),
    mode: hint?.mode === 'dependent'
      ? 'dependent'
      : metadata.every((item) => item?.parallelSafe && item.risk === 'R0')
        ? 'parallel_read'
        : 'ordered_write',
    memberCalls: Object.freeze([...calls]),
    executableCalls: Object.freeze([...calls]),
    reversible: calls.every((call) => (
      registry.get(call.toolName)?.readOnly || registry.get(call.toolName)?.supportsUndo
    )),
    atomic: false,
  })
}

export function compileActionGroups(
  calls: ModelStepToolCall[],
  expectedRevisions: Partial<HostScopeRevisions>,
  registry: AgentToolRegistry,
  resolveActionGroup?: (call: ModelStepToolCall) => ActionGroupHint | null
): CompiledActionGroup[] {
  const immutableCalls = freezeCalls(calls)
  if (!resolveActionGroup) {
    return [compileCallSet(immutableCalls, expectedRevisions, registry, null)]
  }
  const groups: Array<{ hint: ActionGroupHint | null; calls: ModelStepToolCall[] }> = []
  const groupIndexes = new Map<string, number>()
  for (const [index, call] of immutableCalls.entries()) {
    const hint = resolveActionGroup(call)
    const key = hint?.actionGroupId ?? `unplanned_${index}`
    const existingIndex = groupIndexes.get(key)
    if (existingIndex === undefined) {
      groupIndexes.set(key, groups.length)
      groups.push({ hint, calls: [call] })
    } else {
      groups[existingIndex]?.calls.push(call)
    }
  }
  return groups.map((group) => (
    compileCallSet(group.calls, expectedRevisions, registry, group.hint)
  ))
}
