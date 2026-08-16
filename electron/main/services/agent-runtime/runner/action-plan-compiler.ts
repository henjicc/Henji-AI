import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { CanvasBatchOperation } from '../../../../../src/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import type { CanvasNodePlacement } from '../../../../../src/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import type { AgentToolRegistry } from '../tools/registry'
import { digestJson } from '../tools/security'

export const COMPILED_ACTION_GROUP_VERSION = 'compiled-action-group/v1' as const

export interface CompiledActionGroup {
  version: typeof COMPILED_ACTION_GROUP_VERSION
  actionGroupId: string
  digest: string
  mode: 'parallel_read' | 'atomic_batch' | 'ordered_write'
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

/**
 * 把本轮的一组调用编译成一个可执行组。
 *
 * 这里曾经接受一个 `resolveActionGroup` 提示，按任务图声明的 Action Group 把调用分桶，并让
 * 任务图声明的 mode 覆盖真实推导——分桶依据是运行前的猜测，猜错就把本该合成一次事务的调用
 * 拆开，或者反过来。现在分组只看**本轮实际发来的调用**：能合成画布批次就合，能合成一次反射
 * 事务就合，都不能就按元数据判并行读还是顺序写。
 */
function compileCallSet(
  calls: ModelStepToolCall[],
  expectedRevisions: Partial<HostScopeRevisions>,
  registry: AgentToolRegistry
): CompiledActionGroup {
  const canvas = compileCanvasBatch(calls, expectedRevisions, registry)
  if (canvas) return canvas
  const reflection = compileReflectionTransaction(calls, expectedRevisions, registry)
  if (reflection) return reflection
  const metadata = calls.map((call) => registry.executionMetadata(call.toolName, call.input))
  const digest = digestJson({ calls: calls.map((call) => ({
    toolName: call.toolName, input: call.input,
  })), expectedRevisions })
  return deepFreeze({
    version: COMPILED_ACTION_GROUP_VERSION,
    actionGroupId: `calls_${digest.slice(-16)}`,
    digest: digestJson({ digest, actionGroupId: null, mode: null }),
    mode: metadata.every((item) => item?.parallelSafe && item.risk === 'R0')
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
  registry: AgentToolRegistry
): CompiledActionGroup[] {
  return [compileCallSet(freezeCalls(calls), expectedRevisions, registry)]
}
