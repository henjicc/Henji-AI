import type { ApplicationResult } from '../../../../src/core/application-control/invocation'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'

export interface ResultDetailOptions {
  includeRevisions?: boolean
  includeEvidence?: boolean
  includeDetails?: boolean
}

export const RESULT_DETAIL_FIELDS = {
  includeRevisions: { type: 'boolean' },
  includeEvidence: { type: 'boolean', description: '验证证据明细。' },
  includeDetails: { type: 'boolean', description: '完整元数据。' },
} as const

export function resultDetailFields(name: string) {
  return { includeRevisions: RESULT_DETAIL_FIELDS.includeRevisions,
    includeEvidence: RESULT_DETAIL_FIELDS.includeEvidence,
    ...(['list_application_entities', 'describe_application_entities', 'search_models', 'get_model_schema'].includes(name)
      ? { includeDetails: RESULT_DETAIL_FIELDS.includeDetails } : {}) }
}

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

/** 账本、基线、验证使用完整内部回执；此处只投影交给 Pi/MCP 的副本。 */
export function projectApplicationToolResult(name: string, input: Record<string, unknown>, raw: ApplicationResult, options: ResultDetailOptions = {}): ApplicationResult {
  const scopes = new Set<string>()
  const operationId = typeof raw.operationId === 'string' ? raw.operationId : undefined
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)
  definition?.requiredScopes.forEach(scope => scopes.add(scope))
  definition?.control.impacts.forEach(impact => impact.revisionScopes.forEach(scope => scopes.add(scope)))
  const collectRefs = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collectRefs); return }
    const record = object(value)
    for (const key of ['kind', 'entityType']) if (typeof record[key] === 'string') scopes.add((record[key] as string).split('.')[0])
    // 只遍历已知引用容器，不扫描用户属性或任意媒体数据。
    for (const key of ['ref', 'refs', 'target', 'targets', 'parent', 'changes', 'resultRefs', 'effects']) if (record[key]) collectRefs(record[key])
  }
  collectRefs(input)
  for (const domain of Array.isArray(input.domains) ? input.domains : []) if (typeof domain === 'string') scopes.add(domain)
  let revision: unknown
  let revisions: Record<string, unknown> = {}
  const envelope = (source: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...source }
    const data = object(source.data)
    collectRefs(data)
    for (const key of [...Object.keys(object(data.revisions)), ...Object.keys(object(data.resultingRevisions))]) scopes.add(key.split(/[.:]/)[0])
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
      if (!options.includeEvidence && projected.verification) {
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
  if (revision !== undefined) result.revision = revision
  const relevant = options.includeRevisions ? revisions : Object.fromEntries(Object.entries(revisions).filter(([scope]) => scopes.has(scope)))
  if (Object.keys(relevant).length) result.scopeRevisions = relevant
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
  const optional = new Set(['revision', 'scopeRevisions', 'resultingRevision', 'resultingScopeRevisions', 'evidence',
    'checks', 'items', 'revisions', 'propertyAvailability', 'collectionAvailability', ...(name === 'get_model_schema' ? ['digest'] : [])])
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
    type: 'string', description: '读取结果所属宿主代次；revision、scopeRevisions、实体 revisions 仅在此代次相同时可比较大小。代次变化后重新读取。截帧的新旧判断使用 documentVersion。',
  } } }
}
