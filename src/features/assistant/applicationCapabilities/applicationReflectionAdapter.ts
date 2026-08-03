import type {
  ApplicationPlannedStep,
  ApplicationTransactionResult,
  JsonValue,
} from '@/core/application-control'

import { getHostScopeRevisions } from '../hostContext/hostContext'
import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from './applicationControlRegistry'
import type { CapabilityExecutionContext } from './handlerTypes'

/**
 * 反射层通用能力的执行适配器。
 *
 * 它不含任何业务逻辑：把助手的请求翻译成事务引擎的计划步骤，业务仍然由各领域的执行器完成。
 * 这样新增一个领域的可写状态时，只要注册实体、属性和执行器，助手立刻就能用，不需要再写
 * 一个专用能力——这正是"每个功能都要手写适配"的解法。
 */

const permissions = new Set([
  'application:read', 'application:write',
  'camera_stage:read', 'camera_stage:write',
  'canvas:read', 'canvas:write',
  'settings:read', 'settings:write',
])

function executionContext(context: CapabilityExecutionContext) {
  return {
    exposure: 'assistant' as const,
    permissions,
    acceptedDataClasses: new Set(['C0', 'C1'] as const),
    requestId: context.requestId ?? `application-reflection-${Date.now()}`,
    signal: context.signal,
  }
}

function toMutations(properties: Record<string, unknown>): Array<{
  propertyId: string
  operation: 'set'
  value: JsonValue
}> {
  return Object.entries(properties).map(([propertyId, value]) => ({
    propertyId,
    operation: 'set' as const,
    value: value as JsonValue,
  }))
}

type ChangeInput = {
  summary: string
  expectedRevisions: Record<string, number>
  changes: Array<
    | { kind: 'set_properties'; target: { kind: string; id: string }; entityType: string; properties: Record<string, unknown> }
    | { kind: 'create_items'; parent: { kind: string; id: string }; entityType: string; items: Array<{ properties: Record<string, unknown> }> }
    | { kind: 'remove_items'; parent: { kind: string; id: string }; entityType: string; targets: Array<{ kind: string; id: string }> }
  >
}

function toPlannedStep(
  change: ChangeInput['changes'][number],
  expectedRevisions: Record<string, number>
): ApplicationPlannedStep {
  if (change.kind === 'set_properties') {
    return {
      kind: 'mutation',
      target: change.target,
      entityType: change.entityType,
      expectedRevisions,
      mutations: toMutations(change.properties),
    }
  }
  if (change.kind === 'create_items') {
    return {
      kind: 'collection',
      parent: change.parent,
      entityType: change.entityType,
      expectedRevisions,
      operation: {
        kind: 'create',
        items: change.items.map((item) => ({ properties: item.properties as Record<string, JsonValue> })),
      },
    }
  }
  return {
    kind: 'collection',
    parent: change.parent,
    entityType: change.entityType,
    expectedRevisions,
    operation: { kind: 'remove', targets: change.targets },
  }
}

function completedTransaction(
  result: ApplicationTransactionResult
): Extract<ApplicationTransactionResult, { status: 'completed' }> {
  if (result.status === 'completed') return result
  // 失败信息原样上抛：引擎已经把原始错误拼进 message，这里再包一层只会把它盖掉。
  if (result.status === 'failed') throw new Error(result.code === 'CONFLICT' ? 'CONFLICT' : result.message)
  throw new Error('CAPABILITY_REJECTED')
}

export const applicationReflectionHandlers = {
  async describeEntities(input: { domains: string[]; entityTypes: string[] }, context: CapabilityExecutionContext) {
    const description = getApplicationReflectionRegistry().describe({
      ...(input.domains.length > 0 ? { domains: input.domains } : {}),
      ...(input.entityTypes.length > 0 ? { entityTypes: input.entityTypes } : {}),
    }, executionContext(context))
    return {
      entities: description.entities as unknown as Array<Record<string, unknown>>,
      properties: description.properties as unknown as Array<Record<string, unknown>>,
    }
  },

  async listEntities(
    input: { entityType: string; cursor?: string; limit: number },
    context: CapabilityExecutionContext
  ) {
    const result = await getApplicationReflectionRegistry().listEntities(
      input.entityType,
      { ...(input.cursor ? { cursor: input.cursor } : {}), limit: input.limit },
      executionContext(context),
    )
    return { refs: result.refs, nextCursor: result.nextCursor, revisions: result.revisions }
  },

  async readEntity(
    input: { ref: { kind: string; id: string }; propertyIds: string[] },
    context: CapabilityExecutionContext
  ) {
    const snapshot = await getApplicationReflectionRegistry().readEntity(
      input.ref,
      input.propertyIds,
      executionContext(context),
    )
    return {
      ref: snapshot.ref,
      entityType: snapshot.entityType,
      properties: snapshot.properties as Record<string, unknown>,
      revisions: snapshot.revisions,
      capturedAt: snapshot.capturedAt,
    }
  },

  async changeEntities(input: ChangeInput, context: CapabilityExecutionContext) {
    const engine = getApplicationControlExecutionEngine()
    const appContext = executionContext(context)
    const expected = Object.keys(input.expectedRevisions).length > 0
      ? input.expectedRevisions
      : { toolbox: getHostScopeRevisions().toolbox }
    const plan = await engine.plan({
      summary: input.summary,
      // compensatable：多步时任一步失败都逐步回滚。atomic 只对同实体类型的属性组写入有意义，
      // 而这里的 changes 是跨实体、跨动词的组合。
      transactionMode: 'compensatable',
      steps: input.changes.map((change) => toPlannedStep(change, expected)),
    }, appContext)
    const result = completedTransaction(await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: expected,
      idempotencyKey: `change:${context.requestId ?? context.taskId ?? 'renderer'}:${JSON.stringify(expected)}`
        .padEnd(16, '0').slice(0, 256),
    }, appContext))
    return {
      status: 'completed' as const,
      transactionRef: result.transactionRef,
      resultingRevisions: result.resultingRevisions,
      producedRefs: result.producedRefs as unknown as Array<Record<string, unknown>>,
      evidence: result.evidence as unknown as Array<Record<string, unknown>>,
    }
  },
}
