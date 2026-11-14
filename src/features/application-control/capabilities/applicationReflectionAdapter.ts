import { forgetExplanationUndoAccess, rememberExplanationUndoAccess } from '../creativeIntentAuthorization'
import { applicationPropertyValueText, isWritableApplicationProperty, readApplicationSnapshot } from '@/core/application-control/registry/snapshot'
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
import { applicationCallerAccess } from '@/core/application-control/callerContext'

/** 应用记录过、还没用过的撤销回执。不按连接区分：任何助手（内置或外部）都可以撤销应用里记录过的修改，走的仍是同一撤销栈。 */
const publicUndos = new Map<string, { revisions: Record<string, number> }>()

/**
 * 反射层通用能力的执行适配器。
 *
 * 它不含任何业务逻辑：把助手的请求翻译成事务引擎的计划步骤，业务仍然由各领域的执行器完成。
 * 这样新增一个领域的可写状态时，只要注册实体、属性和执行器，助手立刻就能用，不需要再写
 * 一个专用能力——这正是"每个功能都要手写适配"的解法。
 */

function executionContext(context: CapabilityExecutionContext) {
  if (context.callerGrant) {
    if (!context.requestId) throw new Error('INVALID_INPUT:宿主必须提供操作请求标识。')
    return applicationCallerAccess(context.callerGrant, context.requestId, context.signal)
  }
  return {
    exposure: 'assistant' as const,
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
    if (change.kind === 'remove_items') for (const target of change.targets) {
      Object.assign(revisions, (await registry.readEntity(target, [], context)).revisions)
    }
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

import { ApplicationTransactionFailure, ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

function completedTransaction(
  result: ApplicationTransactionResult
): Extract<ApplicationTransactionResult, { status: 'completed' }> {
  if (result.status === 'completed') return result
  // 失败信息原样上抛：引擎已经把原始错误拼进 message，这里再包一层只会把它盖掉。
  if (result.status === 'failed') {
    throw new ApplicationTransactionFailure(result)
  }
  throw new Error('CAPABILITY_REJECTED')
}

/*
 * 结构描述只投影模型真正要用的字段。
 *
 * 注册表的完整描述服务于门禁、UI 与本地适配器，里面大半对模型毫无意义：每条属性都带一个
 * 64 字符的 sha256 digest、一份权限名清单、exposures 与 revisionScopes——这些既不影响它怎么
 * 写参数，也不构成它能做的判断（可写性来自正式执行器、revision 由信封填、digest 只用于版本比对）。
 * 实测一次 4 实体 81 属性的描述回了 62KB（≈3.1 万 token），占整轮输入的近一半。
 *
 * 保留原则只有一条：**模型据此决定"能不能写、写什么、值怎么填"的字段才留**。
 */
function describedEntity(entity: Record<string, unknown>, ownDescription: boolean): Record<string, unknown> {
  const id = entity.id as string
  return {
    id,
    title: entity.title,
    // 多个实体类型共用的那句套话不带
    ...(ownDescription ? { description: entity.description } : {}),
    // 建集合成员时要用父实体引用，必须留。
    parentTypes: entity.parentTypes,
    // refKind 绝大多数等于 id，只有不同才有信息量。
    ...(entity.refKind !== id ? { refKind: entity.refKind } : {}),
    // 通用读取人人都有，只有专用查询入口才值得列
    ...((entity.queryCapabilityIds as string[] | undefined)?.some((id) => id !== 'read_application_entity') ? { queryCapabilityIds: entity.queryCapabilityIds } : {}),
    // 能不能增删、建的时候至少要给哪些属性——写入前的关键约束。
    ...(entity.collectionWrite ? { collectionWrite: entity.collectionWrite } : {}),
    // 有意只读时把原因给模型，让它知道该改用哪条路径而不是反复试。
    ...(entity.writeExclusion
      ? { readOnlyReason: (entity.writeExclusion as { reason: string }).reason }
      : {}),
  }
}

/** 一页目录里各条属性的说明合计（按页，不按实体类型）不超过这个字数时随目录给出。 */
const CATALOG_DESCRIPTION_CHARS = 3000

/**
 * 说明只是“领域名 + 标题 + 。”时不给：注册时为每条属性自动补的这类说明占了近四成，与 title 重复，模型从中得不到新信息。
 */
function informativeDescription(property: Record<string, unknown>): string | undefined {
  const description = typeof property.description === 'string' ? property.description : undefined
  const title = typeof property.title === 'string' ? property.title : ''
  if (!description || !title) return description
  const body = description.replace(/[。.]$/, '')
  return body.endsWith(title) && body.length - title.length <= 10 ? undefined : description
}

function describedProperty(property: Record<string, unknown>, _context?: CapabilityExecutionContext): Record<string, unknown> {
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
    ...(informativeDescription(property) ? { description: informativeDescription(property) } : {}),
    // 取值类型与范围是模型填参数的唯一依据。
    value: property.value,
    ...(property.valueComparison ? { valueComparison: property.valueComparison } : {}),
    ...(property.requiresReadBaseline ? { requiresReadBaseline: true } : {}),
    ...(property.omitFromDefaultRead ? { omitFromDefaultRead: true } : {}),
    ...(property.nullable === true ? { nullable: true } : {}),
    ...(property.defaultValue !== undefined ? { defaultValue: property.defaultValue } : {}),
    // 模型只需要知道属性是否具备正式写入实现。
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
    input: { domains: string[]; entityTypes: string[]; entityType?: string; propertyIds?: string[]; text?: string; detail?: 'compact' | 'full'; cursor?: string; limit?: number; refs?: Array<{ kind: string; id: string; label?: string }> },
    context: CapabilityExecutionContext,
  ) {
    const registry = getApplicationReflectionRegistry()
    const accessContext = executionContext(context)
    // 整份读回与写入都用实体类型之后的短键；只查一类实体时这里同样接受
    const onlyType = input.entityType ?? (input.entityTypes.length === 1 ? input.entityTypes[0] : undefined)
    if (onlyType && input.propertyIds?.length) input = { ...input, propertyIds: input.propertyIds.map((id) => resolvePropertyId(onlyType, id)) }
    const description = registry.describe({
      ...(input.domains.length > 0 ? { domains: input.domains } : {}),
      ...(input.entityType ? { entityTypes: [input.entityType] } : input.entityTypes.length > 0 ? { entityTypes: input.entityTypes } : {}),
      ...(input.propertyIds?.length ? { propertyIds: input.propertyIds } : {}),
      ...(input.text ? { text: input.text } : {}),
    }, accessContext)
    const entities = description.entities as unknown as Array<Record<string, unknown>>
    const refs = input.refs ?? []
    if (context.callerGrant) refs.forEach(assertCompleteRef)
    const propertyAvailability = await Promise.all(refs.map(async (ref) => {
      const propertyIds = registry.listProperties(ref.kind).filter(property => !input.propertyIds?.length || input.propertyIds.includes(property.id)).map((property) => property.id)
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
    const offset = Number(input.cursor ?? 0)
    if (!Number.isSafeInteger(offset)) throw new Error('INVALID_INPUT:cursor 必须是有效分页位置。')
    // 整类列出时每条属性只占一行，一页放得下一整类；点名或按文字找时每条带说明，一页少给
    const listing = !input.propertyIds?.length && !input.text
    // 没点实体类型的整域列出只给实体目录：一个领域几百条属性混在一起，模型用不上，也挑不出要的那一类
    const entitiesOnly = listing && !input.entityType && input.entityTypes.length === 0
    const limit = input.limit ?? (listing ? 200 : 40)
    const page = description.properties.slice(offset, offset + limit)
    const schemaOf = (property: typeof page[number]) => property.value.kind === 'json' ? registry.resolveSchema(property.value.schemaRef, accessContext) : undefined
    const shortKey = (entityType: string, propertyId: string) => propertyId.startsWith(`${entityType}.`) ? propertyId.slice(entityType.length + 1) : propertyId
    // 完整值 schema 只给点名的属性：不点名时整类实体的 schema 全部展开，剪辑片段一类就有三十多万 token，单条结果超过半个窗口，这次调用等于白做。
    const fullProperties = input.detail === 'full' && Boolean(input.propertyIds?.length)
    const singleEntityType = entities.length === 1
    const seenSchemas = new Map<string, string>()
    const catalog: Record<string, Record<string, string>> = {}
    // 属性不多时说明随目录一起给，模型不必为了看一句限制再查一次；整类上百条属性时说明合计上万字，只给目录
    const descriptionOf = (property: typeof page[number]) => informativeDescription(property as unknown as Record<string, unknown>)
    const withDescriptions = listing && !entitiesOnly && page.reduce((sum, property) => sum + (descriptionOf(property)?.length ?? 0), 0) <= CATALOG_DESCRIPTION_CHARS
    if (listing && !entitiesOnly) {
      // 新建时必填的属性多半建好后不可改：只标“只读”会让模型以为新建时也给不了
      const requiredAtCreate = new Set(entities.flatMap((entity) => (entity.collectionWrite as { requiredPropertyIds?: string[] } | undefined)?.requiredPropertyIds ?? []))
      for (const property of page) {
        (catalog[property.entityType] ??= {})[shortKey(property.entityType, property.id)] = `${property.title}｜${applicationPropertyValueText(property, schemaOf(property))}${isWritableApplicationProperty(property) ? '' : requiredAtCreate.has(property.id) ? '｜新建时给定，之后只读' : '｜只读'}${property.requiresReadBaseline ? '｜先读基线' : ''}${property.omitFromDefaultRead ? '｜点名才读' : ''}${withDescriptions && descriptionOf(property) ? `｜说明：${descriptionOf(property)}` : ''}`
      }
    }
    const propertyCounts = new Map<string, number>()
    if (entitiesOnly) for (const property of description.properties) propertyCounts.set(property.entityType, (propertyCounts.get(property.entityType) ?? 0) + 1)
    const properties = listing ? [] : page.map(property => {
      const full = describedProperty(property as unknown as Record<string, unknown>, context)
      const schema = schemaOf(property)
      if (fullProperties) {
        if (!schema) return full
        // json 属性的取值以 valueSchema 为准；value 里只有内部的 schema 引用与摘要，模型用不上
        const { value: _value, ...rest } = full
        // 同一次返回里结构相同的值 schema 只展开一次（例如十几条关键帧属性共用一份），其余指向第一次出现的属性。
        const key = JSON.stringify(schema)
        const first = seenSchemas.get(key)
        if (first) return { ...rest, valueSchemaSameAs: first }
        seenSchemas.set(key, property.id)
        const { $schema: _dialect, ...valueSchema } = schema as Record<string, JsonValue>
        return { ...rest, valueSchema }
      }
      return { id: property.id, ...(singleEntityType ? {} : { entityType: property.entityType }), title: property.title, writable: full.writable,
        value: applicationPropertyValueText(property, schema),
        ...(property.requiresReadBaseline ? { requiresReadBaseline: true } : {}),
        ...(property.omitFromDefaultRead ? { omitFromDefaultRead: true } : {}),
        ...(informativeDescription(property as unknown as Record<string, unknown>) ? { description: property.description } : {}) }
    })
    return {
      ...(entitiesOnly ? { hint: '这里只列实体类型。用 entityType / entityTypes 点名要看的类型取属性表；不知道属性在哪一类时用 text 按文字找。' }
        : listing ? { hint: `catalog 按实体类型列出属性，每行是“属性键: 标题｜取值”，后面可能跟“只读”“新建时给定，之后只读”“先读基线”（写前先 read_application_entity 取 baselineId）“点名才读”（整实体读取不带，点名才返回）${withDescriptions ? '和说明' : ''}，键可直接用于读写。${withDescriptions ? '' : '这次说明合计较长，没有随目录给出：要某几条属性的说明与写法，带 propertyIds 再查。'}复杂值带 propertyIds 加 detail="full" 取完整值结构。` } : {}),
      entities: entities.map(entity => {
        const id = entity.id as string
        const own = registry.hasOwnDescription(id)
        if (input.detail === 'full' && !entitiesOnly) return describedEntity(entity, own)
        const collection = entity.collectionWrite as { creatable: boolean; removable: boolean; requiredPropertyIds?: string[] } | undefined
        return { id, title: entity.title,
          ...(entitiesOnly ? { propertyCount: propertyCounts.get(id) ?? 0 } : {}),
          ...(own ? { description: entity.description } : {}),
          ...(collection?.creatable ? { create: { under: entity.parentTypes, required: (collection.requiredPropertyIds ?? []).map((propertyId) => shortKey(id, propertyId)) } } : {}),
          ...(collection?.removable ? { removable: true } : {}),
          ...(entity.writeExclusion ? { readOnly: (entity.writeExclusion as { reason: string }).reason } : {}) }
      }),
      ...(listing && !entitiesOnly ? { catalog } : {}),
      properties,
      nextCursor: !entitiesOnly && offset + limit < description.properties.length ? String(offset + limit) : null,
      propertyAvailability,
      collectionAvailability,
    }
  },

  async listEntities(
    input: {
      entityType: string; cursor?: string; limit: number; parent?: { kind: string; id: string }
      propertyIds?: string[]; where?: Record<string, JsonValue>; text?: string
      overlap?: { start: string; end?: string; duration?: string; from: number; to: number }
      orderBy?: Array<{ property: string; direction?: 'asc' | 'desc' }>
    },
    context: CapabilityExecutionContext
  ) {
    if (input.parent && context.callerGrant) assertCompleteRef(input.parent)
    const result = await getApplicationReflectionRegistry().listEntities(
      input.entityType,
      { ...(input.cursor ? { cursor: input.cursor } : {}), limit: input.limit, ...(input.parent ? { parent: { kind: input.parent.kind, id: input.parent.id } } : {}) },
      executionContext(context),
      { propertyIds: input.propertyIds, where: input.where, ...(input.overlap ? { overlap: input.overlap } : {}),
        ...(input.orderBy?.length ? { orderBy: input.orderBy } : {}), ...(input.text ? { text: input.text } : {}) },
    )
    rememberRefs(context.requestId ?? 'renderer', result.refs)
    return {
      refs: result.refs, items: result.items ?? [],
      nextCursor: result.nextCursor, revisions: result.revisions,
    }
  },

  async readEntity(
    input: { ref: { kind: string; id: string }; propertyIds?: string[]; textPage?: { propertyId: string; offset: number; limit: number } },
    context: CapabilityExecutionContext
  ) {
    if (context.callerGrant) assertCompleteRef(input.ref)
    // 属性键与列表、写入同一套写法：完整 ID 或实体类型之后的那一段；结果仍按完整 ID 返回，写错的键由注册表报出该实体真正有哪些属性
    const resolve = (propertyId: string): string => resolvePropertyId(input.ref.kind, propertyId)
    if (input.textPage) input = { ...input, textPage: { ...input.textPage, propertyId: resolve(input.textPage.propertyId) } }
    const snapshot = await getApplicationReflectionRegistry().readEntity(
      input.ref,
      input.textPage ? [input.textPage.propertyId] : input.propertyIds?.map(resolve),
      executionContext(context),
    )
    rememberRefs(context.requestId ?? 'renderer', [snapshot.ref])
    let properties = snapshot.properties as Record<string, unknown>
    let textPage: { propertyId: string; offset: number; total: number; nextOffset: number | null } | undefined
    if (input.textPage) {
      const { propertyId, offset, limit } = input.textPage
      const value = properties[propertyId]
      if (typeof value !== 'string') throw new Error(`INVALID_INPUT:textPage.propertyId ${propertyId} 必须是可读的文本属性。`)
      if (offset > value.length) throw new Error('INVALID_INPUT:textPage.offset 超出文本长度。')
      // 偏移以 UTF-16 单位计；页边界落在代理对中间时向后取完整字符，拼接后仍是原文。
      let end = Math.min(value.length, offset + limit)
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end++
      properties = { [propertyId]: value.slice(offset, end) }
      textPage = { propertyId, offset, total: value.length, nextOffset: end < value.length ? end : null }
    }
    return {
      ref: snapshot.ref,
      entityType: snapshot.entityType,
      properties,
      revisions: snapshot.revisions,
      capturedAt: snapshot.capturedAt,
      ...(textPage ? { textPage } : {}),
    }
  },

  async readSnapshot(
    input: { root: { kind: string; id: string }; depth?: number; entityTypes?: string[]; properties?: Record<string, string[]>; limit: number; cursor?: string },
    context: CapabilityExecutionContext
  ) {
    if (context.callerGrant) assertCompleteRef(input.root)
    const { refs, ...snapshot } = await readApplicationSnapshot(getApplicationReflectionRegistry(), {
      root: { kind: input.root.kind, id: input.root.id }, limit: input.limit,
      ...(input.depth !== undefined ? { depth: input.depth } : {}),
      ...(input.entityTypes?.length ? { entityTypes: input.entityTypes } : {}),
      ...(input.properties && Object.keys(input.properties).length ? { properties: input.properties } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    }, executionContext(context))
    rememberRefs(context.requestId ?? 'renderer', refs)
    return snapshot
  },

  async changeEntities(input: ChangeInput, context: CapabilityExecutionContext) {
    const engine = getApplicationControlExecutionEngine()
    const appContext = executionContext(context)
    let expected = context.expectedRevisions ?? {}
    const sessionKey = context.requestId ?? 'renderer'
    const changes = (() => {
      try {
        const changes = context.callerGrant ? input.changes : input.changes.map((change) => normalizeChangeRefs(sessionKey, change))
        changes.forEach((change) => {
          if (change.kind === 'set_properties' || change.kind === 'mutate_properties') assertCompleteRef(change.target)
          else {
            assertCompleteRef(change.parent)
            if (change.kind === 'remove_items') change.targets.forEach(assertCompleteRef)
          }
        })
        return changes
      } catch (error) { throw new ApplicationPreflightFailure(error) }
    })()
    const strictProperties = changes.flatMap(change => {
      if (change.kind !== 'set_properties' && change.kind !== 'mutate_properties') return []
      const ids = new Set((change.kind === 'set_properties' ? Object.keys(change.properties) : change.mutations.map(item => item.propertyId))
        .map(id => resolvePropertyId(change.entityType, id)))
      return getApplicationReflectionRegistry().listProperties(change.entityType)
        .filter(property => ids.has(property.id) && property.requiresReadBaseline)
    })
    if (strictProperties.some(property => property.revisionScopes.some(scope => expected[scope] === undefined))) {
      throw new ApplicationPreflightFailure(new Error('BASELINE_REQUIRED:请先用 read_application_entity 读取目标，合并内容后携带该次读取的 baselineIds。'))
    }
    const requiresReadBaseline = strictProperties.length > 0
    const baselines = await captureMutationBaselines(changes, appContext).catch((error) => { throw new ApplicationPreflightFailure(error) })
    // 空基线与省略基线一致，需要自动读取集合可用性。
    if (context.callerGrant && Object.keys(expected).length === 0) {
      const current = await refreshedRevisionsIfTargetsUnchanged(baselines, changes, appContext).catch(error => { throw new ApplicationPreflightFailure(error) })
      if (!current) throw new ApplicationPreflightFailure(new Error('CONFLICT:目标正在变化，请稍后重试。'))
      expected = current
    } else if (context.callerGrant) {
      // 父实体的基线不一定包含子集合的作用域；追加可自动补缺，已有版本仍由引擎核对，绝不覆盖。
      expected = { ...expected }
      for (const change of changes) if (change.kind === 'create_items') {
        const availability = await getApplicationReflectionRegistry().getCollectionAvailability(change.parent, change.entityType, appContext)
          .catch(error => { throw new ApplicationPreflightFailure(error) })
        for (const [scope, revision] of Object.entries(availability.revisions)) if (expected[scope] === undefined) expected[scope] = revision
      }
    }
    if (context.callerGrant && Object.keys(expected).length > 0) {
      // 读取父实体所得的无关作用域不属于本次计划；只保留实际目标/集合的基线，数值不刷新。
      const relevant = await refreshedRevisionsIfTargetsUnchanged(baselines, changes, appContext)
        .catch(error => { throw new ApplicationPreflightFailure(error) })
      if (!relevant) throw new ApplicationPreflightFailure(new Error('CONFLICT:目标正在变化，请重新读取。'))
      expected = Object.fromEntries(Object.entries(expected).filter(([scope]) => relevant[scope] !== undefined))
    }
    const execute = async (revisions: Record<string, number>, attempt: number) => {
      const plan = await engine.plan({
        summary: input.summary,
        // compensatable：多步时任一步失败都逐步回滚。atomic 只对同实体类型的属性组写入有意义，
        // 而这里的 changes 是跨实体、跨动词的组合。
        transactionMode: 'compensatable',
        steps: changes.map((change) => toPlannedStep(change, revisions)),
      }, appContext).catch((error) => { throw new ApplicationPreflightFailure(error) })
      return engine.commit({
        planRef: plan.planRef,
        expectedRevisions: revisions,
        idempotencyKey: `change:${plan.planRef}:${attempt}:${context.taskId ?? context.requestId ?? 'renderer'}`
          .padEnd(16, '0').slice(0, 256),
      }, appContext)
    }
    let rawResult: ApplicationTransactionResult
    try {
      rawResult = await execute(expected, 0)
    } catch (error) {
      if (context.callerGrant || requiresReadBaseline) throw error
      if (!(error instanceof Error) || !error.message.includes('REVISION_CONFLICT')) throw error
      const refreshed = await refreshedRevisionsIfTargetsUnchanged(baselines, changes, appContext)
      if (!refreshed) throw new Error('CONFLICT:目标属性已在刷新期间变化，请重新读取并规划。')
      rawResult = await execute(refreshed, 1)
    }
    if (!context.callerGrant && !requiresReadBaseline && rawResult.status === 'failed' && rawResult.code === 'CONFLICT'
      && (!rawResult.partial || rawResult.partial.completedStepIndexes.length === 0)) {
      const refreshed = await refreshedRevisionsIfTargetsUnchanged(baselines, changes, appContext)
      if (!refreshed) throw new Error('CONFLICT:目标属性已在刷新期间变化，请重新读取并规划。')
      rawResult = await execute(refreshed, 1)
    }
    if ((rawResult.status === 'completed' || rawResult.status === 'failed') && rawResult.undoRef) {
      const undoRef = rawResult.undoRef
      rememberExplanationUndoAccess(undoRef, changes.flatMap(change => 'target' in change ? [change.target] : []), () => { publicUndos.delete(undoRef) })
      publicUndos.set(rawResult.undoRef, {
        revisions: rawResult.status === 'completed' ? rawResult.resultingRevisions : rawResult.currentRevisions ?? {} })
      while (publicUndos.size > 256) {
        const oldest = publicUndos.keys().next().value
        if (oldest === undefined) break
        publicUndos.delete(oldest)
        forgetExplanationUndoAccess(oldest)
      }
    }
    const result = completedTransaction(rawResult)
    return {
      status: 'completed' as const,
      transactionRef: result.transactionRef,
      undoRef: result.undoRef,
      verification: result.verification,
      resultingRevisions: result.resultingRevisions,
      resultRefs: result.resultRefs as unknown as Array<Record<string, unknown>>,
      effects: result.effects as unknown as Array<Record<string, unknown>>,
      evidence: result.evidence as unknown as Array<Record<string, unknown>>,
      ...(result.receiptTruncation ? { receiptTruncation: result.receiptTruncation } : {}),
    }
  },
  async undoEntities(input: { undoRef: string }, context: CapabilityExecutionContext) {
    const record = publicUndos.get(input.undoRef)
    // 用过的回执不能再撤，避免同一组修改被撤两次
    if (!record) throw new Error('NOT_FOUND:这份撤销回执不存在或已经用过；undoRef 取自 change_application_entities 的结果，一份回执只能撤销一次。')
    const raw = await getApplicationControlExecutionEngine().undo({ undoRef: input.undoRef,
      expectedRevisions: record.revisions, idempotencyKey: `undo:${input.undoRef}:${crypto.randomUUID()}` }, executionContext(context))
    if (raw.status === 'completed' || raw.status === 'failed' && raw.persistence) {
      publicUndos.delete(input.undoRef)
      forgetExplanationUndoAccess(input.undoRef)
    }
    const result = completedTransaction(raw)
    return { status: 'completed' as const, transactionRef: result.transactionRef, verification: result.verification,
      resultingRevisions: result.resultingRevisions, resultRefs: result.resultRefs as unknown as Array<Record<string, unknown>>,
      effects: result.effects as unknown as Array<Record<string, unknown>>, evidence: result.evidence as unknown as Array<Record<string, unknown>>,
      ...(result.receiptTruncation ? { receiptTruncation: result.receiptTruncation } : {}) }
  },
}
