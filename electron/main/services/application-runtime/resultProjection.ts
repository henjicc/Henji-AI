import type { ApplicationResult } from '../../../../src/core/application-control/invocation'
import { z } from 'zod'
import { commonToolInputSchema } from '../../../../src/core/application-control/inputValidation'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'

export interface ResultDetailOptions {
  /** 一起展开修订号、验证证据与完整元数据。 */
  includeDetails?: boolean
}

export const RESULT_DETAIL_FIELDS = z.toJSONSchema(commonToolInputSchema, { io: 'input' }).properties! as Record<keyof ResultDetailOptions, Record<string, unknown>>

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const empty = (value: unknown): boolean => value === undefined || value === null || value === ''
  || Array.isArray(value) && !value.length || typeof value === 'object' && value !== null && !Object.keys(value).length

/** 只处理模型的公开描述，不进入参数默认值、选项值或用户属性。 */
function modelMetadata(value: unknown, key = ''): unknown {
  if (['default', 'value', 'inputLimits', 'priceEstimate', 'nextCursor'].includes(key)) return value
  if (Array.isArray(value)) return value.map(item => modelMetadata(item))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([name, item]) => name !== 'digest' && (['default', 'value', 'nextCursor', 'models', 'params'].includes(name) || !empty(item)))
    .map(([name, item]) => [name, modelMetadata(item, name)]))
}

const sameRef = (left: unknown, right: unknown): boolean => object(left).kind === object(right).kind && object(left).id === object(right).id

/** 列表里只在为 true 时才有信息量的标记；按项目列出时项目名逐条重复。 */
const LIST_FLAGS: Record<string, { items: string; flags: string[]; projectFields?: string[] }> = {
  list_documents: { items: 'documents', flags: ['draft', 'missing', 'external'], projectFields: ['projectId', 'projectName'] },
  list_projects: { items: 'projects', flags: ['draft', 'external', 'missing'] },
}

/**
 * 写入回执只留下一步要用的事实：undoRef、Effect 与验证结论。事务号、写入后的修订号和核对时间是账本里的记录，
 * 模型拿它们做不了任何事；与 effects 里引用完全相同的 resultRefs 不再重复一遍。
 */
function compactReceipt(data: Record<string, unknown>): void {
  delete data.transactionRef
  delete data.resultingRevisions
  if (data.verification && typeof data.verification === 'object') {
    const { checkedAt: _checkedAt, ...verification } = object(data.verification)
    if (empty(verification.unmetConditions)) delete verification.unmetConditions
    data.verification = verification
  }
  if (Array.isArray(data.effects)) {
    const effects = (data.effects as unknown[]).map(effect => {
      const { origin, ...rest } = object(effect)
      return object(origin).kind === 'direct' && Object.keys(object(origin)).length === 1 ? rest : object(effect)
    })
    data.effects = effects
    const effectRefs = effects.flatMap(effect => Array.isArray(effect.refs) ? effect.refs as unknown[] : [])
    const resultRefs = data.resultRefs
    if (Array.isArray(resultRefs) && resultRefs.every(ref => effectRefs.some(item => sameRef(item, ref)))) delete data.resultRefs
  }
}

/** 整实体读取里单个属性超过这个字数就只报体积：转录稿、多次拍摄、关键帧这类数组一读就是几万 token，多数任务用不上。 */
const LARGE_PROPERTY_CHARS = 8000

/**
 * 不点名属性的整实体读取不列出值为空（null、空字符串、空数组、空对象）的属性，过大的属性只在 largeProperties 给条目数与字数，
 * 读取工具的说明里写明了这两点；点名的属性原样返回。采集时间与和引用重复的实体类型只在 includeDetails 时给。
 */
function compactEntityRead(data: Record<string, unknown>, input: Record<string, unknown>): void {
  delete data.capturedAt
  if (data.entityType === object(data.ref).kind) delete data.entityType
  if (input.propertyIds !== undefined || input.textPage !== undefined) return
  const properties = Object.entries(object(data.properties))
  const kept: Array<[string, unknown]> = []
  const large: Record<string, { chars: number; items?: number }> = {}
  for (const [id, value] of properties) {
    if (empty(value)) continue
    const chars = JSON.stringify(value).length
    if (chars > LARGE_PROPERTY_CHARS) large[id] = { chars, ...(Array.isArray(value) ? { items: value.length } : {}) }
    else kept.push([id, value])
  }
  if (kept.length === properties.length) return
  data.properties = Object.fromEntries(kept)
  const omitted = properties.length - kept.length - Object.keys(large).length
  if (omitted) data.omittedEmptyProperties = omitted
  if (Object.keys(large).length) data.largeProperties = large
}

/** 账本、基线、验证使用完整内部回执；此处只投影交给 Pi/MCP 的副本。 */
export function projectApplicationToolResult(name: string, input: Record<string, unknown>, raw: ApplicationResult, options: ResultDetailOptions = {}): ApplicationResult {
  const operationId = typeof raw.operationId === 'string' ? raw.operationId : undefined
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)
  let revision: unknown
  let revisions: Record<string, unknown> = {}
  const envelope = (source: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...source }
    const data = object(source.data)
    for (const container of [source, data]) {
      revision = container.resultingRevision ?? container.revision ?? revision
      revisions = { ...revisions, ...object(container.scopeRevisions), ...object(container.resultingScopeRevisions) }
    }
    for (const key of ['revision', 'scopeRevisions', 'resultingRevision', 'resultingScopeRevisions']) delete result[key]
    if (source.data && typeof source.data === 'object' && !Array.isArray(source.data)) {
      const projected = { ...data }
      for (const key of ['revision', 'scopeRevisions', 'resultingRevision', 'resultingScopeRevisions']) delete projected[key]
      if (!options.includeDetails) {
        for (const key of ['items', 'revisions', 'propertyAvailability', 'collectionAvailability']) if (empty(projected[key])) delete projected[key]
        if (name === 'list_application_entities' && Array.isArray(projected.items) && Array.isArray(projected.refs)) {
          const refs = projected.refs
          projected.items = projected.items.map((item, index) => {
            const record = object(item)
            if (JSON.stringify(record.ref) !== JSON.stringify(refs[index])) return item
            const { ref: _ref, ...properties } = record
            return properties
          })
        }
      }
      if (!options.includeDetails) {
        if (projected.transactionRef !== undefined || projected.resultingRevisions !== undefined) compactReceipt(projected)
        if (name === 'read_application_entity') compactEntityRead(projected, input)
        const list = LIST_FLAGS[name]
        if (list && Array.isArray(projected[list.items])) projected[list.items] = (projected[list.items] as unknown[]).map(item => Object.fromEntries(Object.entries(object(item))
          .filter(([key, value]) => !(list.flags.includes(key) && value === false) && !(input.projectId !== undefined && list.projectFields?.includes(key)))))
      }
      if (!options.includeDetails && projected.verification) {
        const { evidence: _evidence, checks: _checks, ...conclusion } = object(projected.verification)
        projected.verification = conclusion
        delete projected.evidence
        // 失败回执(error.details)原样保留；成功 Effect 的事实/引用仍可用于下一步。
        if (Array.isArray(projected.effects)) projected.effects = projected.effects.map(effect => {
          const { evidence: _evidence, ...fact } = object(effect)
          return fact
        })
      }
      if (operationId && definition?.pagedResultFields?.length) {
        const collections: Record<string, unknown> = {}
        for (const field of definition.pagedResultFields) {
          if (!Array.isArray(projected[field])) continue
          collections[field] = { total: projected[field].length, resultRef: { operationId, field }, nextCursor: projected[field].length ? '0' : null }
          delete projected[field]
        }
        projected.resultCollections = collections
      }
      result.data = !options.includeDetails && ['search_models', 'get_model_schema'].includes(name) ? modelMetadata(projected) : projected
    }
    for (const key of ['result', 'recoveryResult']) {
      if (source[key] && typeof source[key] === 'object') result[key] = envelope(object(source[key]))
      else if (empty(source[key])) delete result[key]
    }
    return result
  }
  const result = envelope(raw)
  // 修订号与宿主代次只用于并发核对，模型改用 baselineId；默认不交付，includeDetails 时给全。
  // 长文本分页续读靠“每页 revisions 与代次都不变”判断原文没变：宿主重启后修订号可能恰好相同，所以这类读取保留代次。
  if (!options.includeDetails) {
    if (!(name === 'read_application_entity' && input.textPage !== undefined)) delete result.revisionEpoch
    return result as ApplicationResult
  }
  if (revision !== undefined) result.revision = revision
  if (Object.keys(revisions).length) result.scopeRevisions = revisions
  return result as ApplicationResult
}

/** 单页读取不改内部结果；这里只声明投影后的摘要形状。 */
const resultCollectionsSchema = {
  type: 'object',
  additionalProperties: {
    type: 'object', additionalProperties: false, required: ['total', 'resultRef', 'nextCursor'],
    properties: {
      total: { type: 'integer', minimum: 0 }, nextCursor: { type: ['string', 'null'] },
      resultRef: {
        type: 'object', additionalProperties: false, required: ['operationId', 'field'],
        properties: { operationId: { type: 'string', format: 'uuid' }, field: { type: 'string' } },
      },
    },
  },
}

/** 公开输出允许裁剪元数据，领域输出校验与持久 schema 保持原样。 */
export function projectToolOutputSchema(schema: Record<string, unknown>, name: string): Record<string, unknown> {
  const pagedFields = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.pagedResultFields ?? [])
  const list = LIST_FLAGS[name]
  const optional = new Set(['revision', 'scopeRevisions', 'resultingRevision', 'resultingScopeRevisions', 'evidence',
    'checks', 'items', 'revisions', 'propertyAvailability', 'collectionAvailability',
    'transactionRef', 'resultingRevisions', 'resultRefs', 'checkedAt', 'unmetConditions', 'origin',
    ...(name === 'get_model_schema' ? ['digest'] : []), ...(name === 'read_application_entity' ? ['capturedAt', 'entityType'] : []),
    ...(list ? [...list.flags, ...list.projectFields ?? []] : [])])
  const visit = (value: unknown, dataEnvelope = false): unknown => {
    if (Array.isArray(value)) return value.map(item => visit(item))
    if (value === null || typeof value !== 'object') return value
    const record = object(value)
    const hasPagedFields = Object.keys(object(record.properties)).some(field => pagedFields.has(field))
    return Object.fromEntries(Object.entries(record).map(([key, item]) => {
      if (key === 'required' && Array.isArray(item)) {
        const required = item.filter(field => !pagedFields.has(String(field)) && !optional.has(String(field))
          && !(name === 'list_application_entities' && field === 'ref'))
        return [key, hasPagedFields ? [...required, 'resultCollections'] : required]
      }
      if (key === 'properties') {
        const properties = { ...object(item), ...(hasPagedFields ? { resultCollections: resultCollectionsSchema } : {}) }
        return [key, Object.fromEntries(Object.entries(properties)
          .filter(([field]) => !pagedFields.has(field) && (!dataEnvelope || !['revision', 'scopeRevisions', 'resultingRevision', 'resultingScopeRevisions'].includes(field)))
          .map(([field, description]) => [field, visit(description, field === 'data')]))]
      }
      return [key, visit(item)]
    }))
  }
  const projected = visit(schema) as Record<string, unknown>
  return { ...projected, properties: { ...object(projected.properties), revisionEpoch: {
    type: 'string', description: 'includeDetails 时给出的宿主代次；revision、scopeRevisions、实体 revisions 仅在此代次相同时可比较大小。代次变化后重新读取。截帧的新旧判断使用 documentVersion。',
  } } }
}
