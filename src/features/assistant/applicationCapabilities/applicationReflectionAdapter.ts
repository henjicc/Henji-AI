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

const TRUNCATED_REF_PATTERN = /(?:\u2026|\.\.\.)/

const STABLE_REF_SESSION_LIMIT = 64
const STABLE_REF_LIMIT_PER_KIND = 512
const stableRefCache = new Map<string, Map<string, Map<string, { kind: string; id: string }>>>()

function rememberRefs(sessionKey: string, refs: Array<{ kind: string; id: string }>): void {
  const session = stableRefCache.get(sessionKey) ?? new Map()
  for (const ref of refs) {
    const byId = session.get(ref.kind) ?? new Map()
    byId.set(ref.id, ref)
    while (byId.size > STABLE_REF_LIMIT_PER_KIND) byId.delete(byId.keys().next().value as string)
    session.set(ref.kind, byId)
  }
  stableRefCache.delete(sessionKey)
  stableRefCache.set(sessionKey, session)
  while (stableRefCache.size > STABLE_REF_SESSION_LIMIT) {
    stableRefCache.delete(stableRefCache.keys().next().value as string)
  }
}

function normalizeCachedRef(
  sessionKey: string,
  ref: { kind: string; id: string },
  entityType?: string,
): { kind: string; id: string } {
  const kind = entityType ?? ref.kind
  if (!TRUNCATED_REF_PATTERN.test(ref.id)) return { kind, id: ref.id }
  const prefix = ref.id.split(/\u2026|\.\.\./, 1)[0] ?? ''
  const candidates = [...(stableRefCache.get(sessionKey)?.get(kind)?.values() ?? [])]
    .filter((candidate) => candidate.id.startsWith(prefix))
  if (candidates.length === 1) return candidates[0]
  throw new Error(`REFRESH_REQUIRED:引用 ${kind}:${ref.id} 不是完整稳定引用，请重新列出实体后使用原值。`)
}

function assertCompleteRef(ref: { kind: string; id: string }): void {
  if (!ref.kind.trim() || !ref.id.trim() || TRUNCATED_REF_PATTERN.test(ref.id)) {
    throw new Error(`REFRESH_REQUIRED:引用 ${ref.kind}:${ref.id} 不是完整稳定引用，请重新列出实体后使用原值。`)
  }
}

function normalizeChangeRefs(
  sessionKey: string,
  change: ChangeInput['changes'][number],
): ChangeInput['changes'][number] {
  if (change.kind === 'set_properties' || change.kind === 'mutate_properties') {
    return { ...change, target: normalizeCachedRef(sessionKey, change.target, change.entityType) }
  }
  if (change.kind === 'create_items') return { ...change, parent: normalizeCachedRef(sessionKey, change.parent) }
  return {
    ...change,
    parent: normalizeCachedRef(sessionKey, change.parent),
    targets: change.targets.map((target) => normalizeCachedRef(sessionKey, target, change.entityType)),
  }
}

type MutationBaseline = {
  ref: { kind: string; id: string }
  propertyIds: string[]
  properties: Record<string, JsonValue>
}

async function captureMutationBaselines(
  changes: ChangeInput['changes'],
  context: ReturnType<typeof executionContext>,
): Promise<MutationBaseline[]> {
  const registry = getApplicationReflectionRegistry()
  return Promise.all(changes.flatMap((change) => {
    if (change.kind !== 'set_properties' && change.kind !== 'mutate_properties') return []
    const propertyIds = change.kind === 'set_properties'
      ? Object.keys(change.properties).map((key) => resolvePropertyId(change.entityType, key))
      : change.mutations.map((mutation) => resolvePropertyId(change.entityType, mutation.propertyId))
    return [registry.readEntity(change.target, propertyIds, context).then((snapshot) => ({
      ref: snapshot.ref,
      propertyIds,
      properties: snapshot.properties,
    }))]
  }))
}

async function refreshedRevisionsIfTargetsUnchanged(
  baselines: MutationBaseline[],
  changes: ChangeInput['changes'],
  context: ReturnType<typeof executionContext>,
): Promise<Record<string, number> | null> {
  const registry = getApplicationReflectionRegistry()
  const revisions: Record<string, number> = {}
  for (const baseline of baselines) {
    const current = await registry.readEntity(baseline.ref, baseline.propertyIds, context)
    if (JSON.stringify(current.properties) !== JSON.stringify(baseline.properties)) return null
    Object.assign(revisions, current.revisions)
  }
  for (const change of changes) {
    if (change.kind === 'set_properties' || change.kind === 'mutate_properties') continue
    const availability = await registry.getCollectionAvailability(
      change.parent,
      change.entityType,
      context,
    )
    Object.assign(revisions, availability.revisions)
  }
  return Object.keys(revisions).length > 0 ? revisions : null
}

function toPlannedStep(
  change: ChangeInput['changes'][number],
  expectedRevisions: Record<string, number>
): ApplicationPlannedStep {
  if (change.kind === 'set_properties') {
    assertCompleteRef(change.target)
    return {
      kind: 'mutation',
      // mutation 的实体类型已经是必填且决定写入执行器；ref.kind 是同一事实的冗余副本。
      // 模型实测会把 playback 的 projectId 正确保留、却把 kind 沿用成 project，导致规划器
      // 在错误实体上查属性。这里收敛为唯一事实源，id 仍交给 provider 校验/规范化。
      target: { ...change.target, kind: change.entityType },
      entityType: change.entityType,
      expectedRevisions,
      mutations: toMutations(change.entityType, change.properties),
    }
  }
  if (change.kind === 'mutate_properties') {
    assertCompleteRef(change.target)
    return {
      kind: 'mutation',
      target: { ...change.target, kind: change.entityType },
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
    assertCompleteRef(change.parent)
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
  assertCompleteRef(change.parent)
  change.targets.forEach(assertCompleteRef)
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
  if (result.status === 'failed') {
    throw new Error(result.code === 'CONFLICT' ? `CONFLICT:${result.message}` : result.message)
  }
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
  const writable = (permissions?.write?.length ?? 0) > 0
  const operations = writable
    ? getApplicationControlExecutionEngine().getAcceptedPropertyOperations(
        property.entityType as string,
        property.id as string,
      )
    : []
  return {
    id: property.id,
    entityType: property.entityType,
    title: property.title,
    description: property.description,
    // 取值类型与范围是模型填参数的唯一依据。
    value: property.value,
    ...(property.nullable === true ? { nullable: true } : {}),
    ...(property.defaultValue !== undefined ? { defaultValue: property.defaultValue } : {}),
    // 权限名对模型没有用，它只需要知道这一条能不能写；能不能通过由网关判定。
    writable,
    ...(operations.length > 0 ? { writeOperations: operations } : {}),
    ...(operations.includes('set')
      && (property.value as { kind?: string } | undefined)?.kind === 'ref_list'
      ? { setBehavior: 'replace_collection' }
      : {}),
  }
}

export const applicationReflectionHandlers = {
  async describeEntities(
    input: { domains: string[]; entityTypes: string[]; refs?: Array<{ kind: string; id: string; label?: string }> },
    context: CapabilityExecutionContext,
  ) {
    const registry = getApplicationReflectionRegistry()
    const accessContext = executionContext(context)
    const description = registry.describe({
      ...(input.domains.length > 0 ? { domains: input.domains } : {}),
      ...(input.entityTypes.length > 0 ? { entityTypes: input.entityTypes } : {}),
    }, accessContext)
    const entities = description.entities as unknown as Array<Record<string, unknown>>
    const refs = input.refs ?? []
    const propertyAvailability = await Promise.all(refs.map(async (ref) => {
      const propertyIds = registry.listProperties(ref.kind).map((property) => property.id)
      const availability = await registry.getPropertyAvailability(ref, propertyIds, accessContext)
      return {
        ref,
        properties: availability.map((item) => ({
          propertyId: item.propertyId,
          readable: item.readable,
          writable: item.writable,
          reasons: item.reasons,
          recoveries: item.recoveries ?? [],
        })),
      }
    }))
    const collectionAvailability = (await Promise.all(refs.flatMap((parent) => entities
      .filter((entity) => Boolean(entity.collectionWrite)
        && (entity.parentTypes as string[] | undefined)?.includes(parent.kind))
      .map(async (entity) => {
        const availability = await registry.getCollectionAvailability(parent, entity.id as string, accessContext)
        const operation = (value: typeof availability.create) => ({
          available: value.available,
          reasons: value.reasons,
          recoveries: value.recoveries,
        })
        return {
          parent,
          entityType: availability.entityType,
          create: operation(availability.create),
          remove: operation(availability.remove),
        }
      })))).flat()
    return {
      entities: entities.map(describedEntity),
      properties: (description.properties as unknown as Array<Record<string, unknown>>).map(describedProperty),
      propertyAvailability,
      collectionAvailability,
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
    rememberRefs(context.requestId ?? 'renderer', result.refs)
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
    rememberRefs(context.requestId ?? 'renderer', [snapshot.ref])
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
    const sessionKey = context.requestId ?? 'renderer'
    const changes = input.changes.map((change) => normalizeChangeRefs(sessionKey, change))
    changes.forEach((change) => {
      if (change.kind === 'set_properties' || change.kind === 'mutate_properties') assertCompleteRef(change.target)
      else {
        assertCompleteRef(change.parent)
        if (change.kind === 'remove_items') change.targets.forEach(assertCompleteRef)
      }
    })
    const baselines = await captureMutationBaselines(changes, appContext)
    const execute = async (revisions: Record<string, number>, attempt: number) => {
      const plan = await engine.plan({
        summary: input.summary,
        // compensatable：多步时任一步失败都逐步回滚。atomic 只对同实体类型的属性组写入有意义，
        // 而这里的 changes 是跨实体、跨动词的组合。
        transactionMode: 'compensatable',
        steps: changes.map((change) => toPlannedStep(change, revisions)),
      }, appContext)
      return engine.commit({
        planRef: plan.planRef,
        expectedRevisions: revisions,
        idempotencyKey: `change:${context.taskId ?? context.requestId ?? 'renderer'}:${attempt}:${JSON.stringify(revisions)}`
          .padEnd(16, '0').slice(0, 256),
      }, appContext)
    }
    let rawResult: ApplicationTransactionResult
    try {
      rawResult = await execute(expected, 0)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('REVISION_CONFLICT')) throw error
      const refreshed = await refreshedRevisionsIfTargetsUnchanged(baselines, changes, appContext)
      if (!refreshed) throw new Error('CONFLICT:目标属性已在刷新期间变化，请重新读取并规划。')
      rawResult = await execute(refreshed, 1)
    }
    if (rawResult.status === 'failed' && rawResult.code === 'CONFLICT'
      && (!rawResult.partial || rawResult.partial.completedStepIndexes.length === 0)) {
      const refreshed = await refreshedRevisionsIfTargetsUnchanged(baselines, changes, appContext)
      if (!refreshed) throw new Error('CONFLICT:目标属性已在刷新期间变化，请重新读取并规划。')
      rawResult = await execute(refreshed, 1)
    }
    const result = completedTransaction(rawResult)
    return {
      status: 'completed' as const,
      transactionRef: result.transactionRef,
      resultingRevisions: result.resultingRevisions,
      resultRefs: result.resultRefs as unknown as Array<Record<string, unknown>>,
      effects: result.effects as unknown as Array<Record<string, unknown>>,
      evidence: result.evidence as unknown as Array<Record<string, unknown>>,
    }
  },
}
