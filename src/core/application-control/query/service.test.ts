import { describe, expect, it } from 'vitest'

import { ApplicationReflectionRegistry } from '../registry'
import type { ApplicationEntityRegistration, ApplicationEntityProvider } from '../registry'
import type { JsonValue } from '../identifiers'
import { ApplicationObservationQueryService } from './service'

const catalogVersion = 'application-capabilities/v2'
const digest = `sha256:${'b'.repeat(64)}`

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion, kind, id, version: 1, digest } as const
}

function registration(
  entityType: string,
  domain: string,
  values: Record<string, JsonValue>,
  revisions: Record<string, number>
): ApplicationEntityRegistration {
  const propertyIds = Object.keys(values)
  const provider: ApplicationEntityProvider = {
    entityType,
    async listEntities() {
      return { refs: [{ kind: entityType, id: 'one' }], nextCursor: null, revisions }
    },
    async readEntity(ref, request) {
      const selected = new Set(request.propertyIds ?? propertyIds)
      return {
        ref,
        entityType,
        revisions,
        properties: Object.fromEntries(Object.entries(values).filter(([id]) => selected.has(id))),
        capturedAt: '2026-08-01T00:00:00.000Z',
      }
    },
    async getPropertyAvailability(_ref, ids) {
      return ids.map((propertyId) => ({
        propertyId,
        readable: true,
        writable: true,
        reasons: [],
        requiredPermissions: [`${domain}:read`],
        revisions,
      }))
    },
  }
  return {
    entity: {
      id: entityType,
      domain,
      version: 1,
      title: `${domain} 实体`,
      description: `${domain} 领域测试实体。`,
      refKind: entityType,
      dataClass: 'C1',
      exposures: ['assistant'],
      parentTypes: [],
      revisionScopes: Object.keys(revisions),
      queryCapabilityIds: [`get_${domain}_item`],
      schemaRef: schemaRef('entity', entityType),
    },
    properties: propertyIds.map((id) => ({
      id,
      entityType,
      version: 1,
      title: id,
      description: `${id} 属性。`,
      value: id.endsWith('link')
        ? { kind: 'ref' as const, refKinds: ['beta.item'] }
        : { kind: 'string' as const },
      nullable: false,
      dataClass: id.endsWith('secret') ? 'C2' : 'C1',
      exposures: ['assistant' as const],
      requiredPermissions: {
        read: [id.endsWith('secret') ? `${domain}:secret` : `${domain}:read`],
        write: [`${domain}:write`],
      },
      revisionScopes: Object.keys(revisions),
      schemaRef: schemaRef('property', id),
      ...(id.endsWith('link') ? {
        relation: { targetEntityTypes: ['beta.item'], cardinality: 'optional' as const },
      } : {}),
    })),
    provider,
  }
}

function createRegistry(betaRevision = 2): ApplicationReflectionRegistry {
  const registry = new ApplicationReflectionRegistry(catalogVersion)
  registry.register(registration('alpha.item', 'alpha', {
    'alpha.name': '甲',
    'alpha.secret': '不可见',
    'alpha.link': { kind: 'beta.item', id: 'one' },
  }, { 'alpha.items': 1 }))
  registry.register(registration('beta.item', 'beta', {
    'beta.name': '乙',
  }, { 'beta.items': betaRevision }))
  return registry
}

const context = {
  exposure: 'assistant' as const,
  permissions: new Set(['alpha:read', 'beta:read']),
  acceptedDataClasses: new Set(['C0', 'C1'] as const),
}

describe('ApplicationObservationQueryService', () => {
  it('一次查询返回多领域 schema、实体、关系和 revision', async () => {
    const service = new ApplicationObservationQueryService({ registry: createRegistry() })
    const result = await service.observe({
      contractVersion: 'application-control/v1',
      requestId: 'observe-multi',
      domains: ['alpha', 'beta'],
      refs: [{ kind: 'alpha.item', id: 'one' }],
      listEntityTypes: ['beta.item'],
      schemaRefs: [schemaRef('property', 'beta.name')],
      selection: {
        includeSchemas: true,
        includeValues: true,
        includeAvailability: false,
        includeOperations: false,
        relationDepth: 1,
      },
      page: { limit: 64 },
      budget: { maxItems: 100, maxBytes: 100_000, artifactThresholdBytes: 90_000 },
      consistency: { mode: 'snapshot' },
    }, context)
    expect(result.items.some((item) => item.kind === 'entity_schema')).toBe(true)
    expect(result.items.filter((item) => item.kind === 'entity_snapshot')).toHaveLength(2)
    expect(result.items.some((item) => item.kind === 'schema_document')).toBe(true)
    expect(result.revisions).toEqual({ 'alpha.items': 1, 'beta.items': 2 })
    expect(JSON.stringify(result)).not.toContain('不可见')
  })

  it('明确返回分页、字节预算和 Artifact 续读信息', async () => {
    const saved: JsonValue[] = []
    const service = new ApplicationObservationQueryService({
      registry: createRegistry(),
      artifactSink: {
        async save(input) {
          saved.push(input.payload)
          return 'artifact:observation-one'
        },
      },
    })
    const result = await service.observe({
      contractVersion: 'application-control/v1',
      requestId: 'observe-page',
      domains: ['alpha', 'beta'],
      refs: [{ kind: 'alpha.item', id: 'one' }],
      selection: { includeSchemas: true, includeValues: true, relationDepth: 0 },
      page: { limit: 1 },
      budget: { maxItems: 20, maxBytes: 2_000, artifactThresholdBytes: 1_024 },
    }, context)
    expect(result.page).toMatchObject({ returnedItems: 1, hasMore: true, nextCursor: 'v1:1' })
    expect(result.incomplete.truncated).toBe(true)
    expect(result.incomplete.reasons).toContain('artifact_offloaded')
    expect(result.artifact?.readCapabilityId).toBe('read_agent_artifact')
    expect(saved).toHaveLength(1)
  })

  it('revision 不一致与错误游标会被明确拒绝', async () => {
    const service = new ApplicationObservationQueryService({ registry: createRegistry(4) })
    await expect(service.observe({
      contractVersion: 'application-control/v1',
      requestId: 'observe-conflict',
      refs: [{ kind: 'beta.item', id: 'one' }],
      selection: { includeSchemas: false, includeValues: true },
      page: { cursor: 'v1:99' },
      consistency: { expectedRevisions: { 'beta.items': 3 } },
    }, context)).rejects.toThrow('REVISION_CONFLICT')
  })

  it('可注入语义操作摘要且不依赖助手运行时', async () => {
    const service = new ApplicationObservationQueryService({
      registry: createRegistry(),
      operationSummaryProvider: {
        async list(entityType) {
          return [{ id: `inspect_${entityType.replace('.', '_')}`, readOnly: true }]
        },
      },
    })
    const result = await service.observe({
      contractVersion: 'application-control/v1',
      requestId: 'observe-operations',
      entityTypes: ['alpha.item'],
      selection: { includeSchemas: false, includeValues: false, includeOperations: true },
    }, context)
    expect(result.items).toEqual([expect.objectContaining({ kind: 'operation_summary' })])
  })
})
