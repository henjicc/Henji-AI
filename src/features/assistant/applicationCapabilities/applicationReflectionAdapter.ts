import type {
  ApplicationPlannedStep,
  ApplicationTransactionResult,
  JsonValue,
} from '@/core/application-control'

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

function executionContext(context: CapabilityExecutionContext) {
  const registry = getApplicationReflectionRegistry()
  return {
    exposure: 'assistant' as const,
    permissions: new Set([
      'application:read',
      'application:write',
      ...registry.listDeclaredPropertyPermissions(),
    ]),
    acceptedDataClasses: new Set(['C0', 'C1'] as const),
    requestId: context.requestId ?? `application-reflection-${Date.now()}`,
    signal: context.signal,
  }
}

/**
 * 属性键补全为完整属性 ID。
 *
 * 每个 change 都已经声明了 entityType，再要求把它当前缀重写进每一个属性键纯属冗余——而这份
 * 冗余既没写在工具 schema（那里是 `record(string, unknown)`，什么键都收）也没写在描述里，
 * 只在内部计划层用 applicationPropertyIdSchema 拦截。实测助手按 describe 给的字段名写
 * `object_ref` / `time` / `value`，提交后收到一整屏 "Invalid key in record"，两个物体的漂浮
 * 关键帧全军覆没。
 *
 * 这里以注册表声明的属性 ID 为准做解析：原样命中就用原样，补上 entityType 前缀能命中就补，
 * 都不命中则保持原样交给注册表报"未知属性"，不做任何猜测。
 */
function resolvePropertyId(entityType: string, key: string): string {
  const declared = new Set(
    getApplicationReflectionRegistry().listProperties(entityType).map((property) => property.id)
  )
  if (declared.has(key)) return key
  const qualified = `${entityType}.${key}`
  return declared.has(qualified) ? qualified : key
}

function toMutations(entityType: string, properties: Record<string, unknown>): Array<{
  propertyId: string
  operation: 'set'
  value: JsonValue
}> {
  return Object.entries(properties).map(([propertyId, value]) => ({
    propertyId: resolvePropertyId(entityType, propertyId),
    operation: 'set' as const,
    value: value as JsonValue,
  }))
}

function resolveItemProperties(
  entityType: string,
  properties: Record<string, unknown>
): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => (
    [resolvePropertyId(entityType, key), value as JsonValue]
  )))
}

type PropertyMutationInput = {
  propertyId: string
  operation: 'set' | 'clear' | 'append' | 'remove'
  value?: unknown
}

type ChangeInput = {
  summary: string
  expectedRevisions?: Record<string, number>
  changes: Array<
    | { kind: 'set_properties'; target: { kind: string; id: string }; entityType: string; properties: Record<string, unknown> }
    | { kind: 'mutate_properties'; target: { kind: string; id: string }; entityType: string; mutations: PropertyMutationInput[] }
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
      mutations: toMutations(change.entityType, change.properties),
    }
  }
  if (change.kind === 'mutate_properties') {
    return {
      kind: 'mutation',
      target: change.target,
      entityType: change.entityType,
      expectedRevisions,
      mutations: change.mutations.map((mutation) => ({
        propertyId: resolvePropertyId(change.entityType, mutation.propertyId),
        operation: mutation.operation,
        ...(mutation.value !== undefined ? { value: mutation.value as JsonValue } : {}),
      })),
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
        items: change.items.map((item) => ({
          properties: resolveItemProperties(change.entityType, item.properties),
        })),
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

/*
 * 结构描述只投影模型真正要用的字段。
 *
 * 注册表的完整描述服务于门禁、UI 与本地适配器，里面大半对模型毫无意义：每条属性都带一个
 * 64 字符的 sha256 digest、一份权限名清单、exposures 与 revisionScopes——这些既不影响它怎么
 * 写参数，也不构成它能做的判断（权限由网关强制、revision 由信封填、digest 只用于版本比对）。
 * 实测一次 4 实体 81 属性的描述回了 62KB（≈3.1 万 token），占整轮输入的近一半。
 *
 * 保留原则只有一条：**模型据此决定"能不能写、写什么、值怎么填"的字段才留**。
 */
function describedEntity(entity: Record<string, unknown>): Record<string, unknown> {
  const id = entity.id as string
  return {
    id,
    title: entity.title,
    description: entity.description,
    // 建集合成员时要用父实体引用，必须留。
    parentTypes: entity.parentTypes,
    // refKind 绝大多数等于 id，只有不同才有信息量。
    ...(entity.refKind !== id ? { refKind: entity.refKind } : {}),
    ...(entity.queryCapabilityIds ? { queryCapabilityIds: entity.queryCapabilityIds } : {}),
    // 能不能增删、建的时候至少要给哪些属性、一次最多几个——写入前的关键约束。
    ...(entity.collectionWrite ? { collectionWrite: entity.collectionWrite } : {}),
    // 有意只读时把原因给模型，让它知道该改用哪条路径而不是反复试。
    ...(entity.writeExclusion
      ? { readOnlyReason: (entity.writeExclusion as { reason: string }).reason }
      : {}),
  }
}

function describedProperty(property: Record<string, unknown>): Record<string, unknown> {
  const permissions = property.requiredPermissions as { write?: string[] } | undefined
  return {
    id: property.id,
    title: property.title,
    description: property.description,
    // 取值类型与范围是模型填参数的唯一依据。
    value: property.value,
    ...(property.nullable === true ? { nullable: true } : {}),
    // 权限名对模型没有用，它只需要知道这一条能不能写；能不能通过由网关判定。
    writable: (permissions?.write?.length ?? 0) > 0,
  }
}

export const applicationReflectionHandlers = {
  async describeEntities(input: { domains: string[]; entityTypes: string[] }, context: CapabilityExecutionContext) {
    const description = getApplicationReflectionRegistry().describe({
      ...(input.domains.length > 0 ? { domains: input.domains } : {}),
      ...(input.entityTypes.length > 0 ? { entityTypes: input.entityTypes } : {}),
    }, executionContext(context))
    return {
      entities: (description.entities as unknown as Array<Record<string, unknown>>).map(describedEntity),
      properties: (description.properties as unknown as Array<Record<string, unknown>>).map(describedProperty),
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
    const expected = context.expectedRevisions ?? {}
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
