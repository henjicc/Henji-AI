
import type { ApplicationEntityProvider, ApplicationEntityRegistration } from '../registry'
import { ApplicationReflectionRegistry } from '../registry'
import { unrestrictedCollectionAvailability } from '../reflection'
import type { ApplicationPlannedStep } from '../transactions'
import {
  ApplicationControlExecutionEngine,
  type ApplicationExecutionContext,
  type ApplicationMutationOperation,
  type ApplicationMutationExecutor,
} from './index'

const catalogVersion = 'application-capabilities/v2'
const digest = `sha256:${'c'.repeat(64)}`

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion, kind, id, version: 1, digest } as const
}

interface Fixture {
  registry: ApplicationReflectionRegistry
  values: Map<string, number>
  links: Map<string, Array<{ kind: string; id: string }>>
  revisions: { value: number }
  writable: { value: boolean }
  dynamicallyBlockedId: { value: string | null }
  collectionAvailable: { value: boolean }
}

export function createFixture(): Fixture {
  const values = new Map([['one', 2], ['two', 4]])
  const links = new Map([
    ['one', [{ kind: 'sample.link', id: 'link-1' }, { kind: 'sample.link', id: 'link-2' }]],
    ['two', []],
  ])
  const revisions = { value: 0 }
  const writable = { value: true }
  const dynamicallyBlockedId = { value: null as string | null }
  const collectionAvailable = { value: true }
  const provider: ApplicationEntityProvider = {
    entityType: 'sample.item',
    async listEntities() {
      return {
        refs: [...values.keys()].map((id) => ({ kind: 'sample.item', id })),
        nextCursor: null,
        revisions: { 'sample.scope': revisions.value },
      }
    },
    async readEntity(ref) {
      const value = values.get(ref.id)
      if (value === undefined) throw new Error('NOT_FOUND')
      return {
        ref,
        entityType: 'sample.item',
        revisions: { 'sample.scope': revisions.value },
        properties: { 'sample.value': value, 'sample.links': links.get(ref.id) ?? [] },
        capturedAt: new Date().toISOString(),
      }
    },
    async getPropertyAvailability(ref, propertyIds) {
      const available = writable.value && dynamicallyBlockedId.value !== ref.id
      return propertyIds.map((propertyId) => ({
        propertyId,
        readable: true,
        writable: available,
        reasons: available ? [] : ['当前状态只读'],
        blocks: available ? [] : [{
          kind: 'state' as const,
          requirementId: 'sample.unlocked',
          affectedEntityTypes: ['sample.item'],
          revisionScopes: ['sample.scope'],
        }],
        requiredPermissions: ['sample:read'],
        revisions: { 'sample.scope': revisions.value },
      }))
    },
    async getCollectionAvailability(parent) {
      const availability = unrestrictedCollectionAvailability('sample.item', parent, { 'sample.scope': revisions.value })
      return collectionAvailable.value ? availability : {
        ...availability,
        create: { ...availability.create, available: false, reasons: ['当前模式不允许创建'] },
      }
    },
  }
  const registration: ApplicationEntityRegistration = {
    entity: {
      id: 'sample.item',
      domain: 'sample',
      version: 1,
      title: '样例',
      description: '事务测试实体。',
      refKind: 'sample.item',
      dataClass: 'C1',
      exposures: ['assistant'],
      parentTypes: ['sample.parent'],
      revisionScopes: ['sample.scope'],
      queryCapabilityIds: ['get_sample_item'],
      schemaRef: schemaRef('entity', 'sample.item'),
      collectionWrite: {
        creatable: true, removable: true, requiredPropertyIds: ['sample.value'], maxItemsPerChange: 8,
      },
    },
    properties: [{
      id: 'sample.value',
      entityType: 'sample.item',
      version: 1,
      title: '数值',
      description: '0 到 10 的偶数。',
      value: { kind: 'integer', hardRange: { min: 0, max: 10, step: 2 } },
      nullable: false,
      dataClass: 'C1',
      exposures: ['assistant'],
      requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
      revisionScopes: ['sample.scope'],
      schemaRef: schemaRef('property', 'sample.value'),
    }, {
      id: 'sample.links',
      entityType: 'sample.item',
      version: 1,
      title: '关联项',
      description: '样例关联引用。',
      value: { kind: 'ref_list', refKinds: ['sample.link'] },
      nullable: false,
      dataClass: 'C1',
      exposures: ['assistant'],
      requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
      revisionScopes: ['sample.scope'],
      schemaRef: schemaRef('property', 'sample.links'),
    }],
    provider,
  }
  const registry = new ApplicationReflectionRegistry(catalogVersion)
  registry.register(registration)
  return { registry, values, links, revisions, writable, dynamicallyBlockedId, collectionAvailable }
}

export class FixtureMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = 'sample.item'
  readonly writableProperties = new Set(['sample.value', 'sample.links'])
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>> = new Map<string, ReadonlySet<ApplicationMutationOperation>>([
    ['sample.value', new Set(['set' as const])],
    ['sample.links', new Set(['append' as const, 'remove' as const])],
  ])
  readonly undoValues = new Map<string, { id: string; value: number }>()
  failOnId?: string
  applyCount = 0
  atomicCount = 0
  reportUndeclaredCascade = false

  constructor(private readonly fixture: Fixture) {}

  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>) {
    this.applyCount += 1
    if (step.target.id === this.failOnId) throw new Error('EXPECTED_FAILURE')
    const before = this.fixture.values.get(step.target.id)
    if (before === undefined) throw new Error('NOT_FOUND')
    if (step.mutations.every((mutation) => mutation.propertyId === 'sample.links')) {
      let next = [...(this.fixture.links.get(step.target.id) ?? [])]
      for (const mutation of step.mutations) {
        const value = mutation.value as { kind: string; id: string }
        if (mutation.operation === 'append') next.push(value)
        else next = next.filter((item) => JSON.stringify(item) !== JSON.stringify(value))
      }
      this.fixture.links.set(step.target.id, next)
      this.fixture.revisions.value += 1
      return {
        status: 'completed' as const,
        resultingRevisions: { 'sample.scope': this.fixture.revisions.value },
        directRefs: [{ kind: 'sample.item', id: step.target.id, revision: this.fixture.revisions.value }],
        cascadeEffects: [],
        evidence: [{
          kind: 'property_value' as const,
          target: { kind: 'sample.item', id: step.target.id },
          fact: '关联引用已更新。',
          data: next,
          capturedAt: new Date().toISOString(),
        }],
      }
    }
    const value = step.mutations[0].value
    if (typeof value !== 'number') throw new Error('INVALID_INPUT')
    this.fixture.values.set(step.target.id, value)
    if (step.target.id === 'one') this.fixture.dynamicallyBlockedId.value = null
    this.fixture.revisions.value += 1
    const undoToken = `token:${step.target.id}:${this.applyCount}`
    this.undoValues.set(undoToken, { id: step.target.id, value: before })
    return {
      status: 'completed' as const,
      resultingRevisions: { 'sample.scope': this.fixture.revisions.value },
      directRefs: [{ kind: 'sample.item', id: step.target.id, revision: this.fixture.revisions.value }],
      cascadeEffects: this.reportUndeclaredCascade ? [{
        effect: 'create' as const, entityType: 'sample.child', refs: [{ kind: 'sample.child', id: 'unknown-child' }],
        propertyIds: [], origin: { kind: 'cascade' as const, declarationId: 'sample.undeclared' },
      }] : [],
      evidence: [{
        kind: 'property_value' as const,
        target: { kind: 'sample.item', id: step.target.id },
        fact: `实体 ${step.target.id} 已更新。`,
        data: value,
        capturedAt: new Date().toISOString(),
      }],
      undoToken,
    }
  }

  async applyAtomic(steps: Array<Extract<ApplicationPlannedStep, { kind: 'mutation' }>>) {
    this.atomicCount += 1
    const before = new Map(this.fixture.values)
    try {
      return await Promise.all(steps.map((step) => this.apply(step)))
    } catch (error) {
      this.fixture.values = before
      throw error
    }
  }

  async compensate(
    _step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>,
    result: Awaited<ReturnType<FixtureMutationExecutor['apply']>>
  ) {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string) {
    const entry = this.undoValues.get(undoToken)
    if (!entry) throw new Error('NOT_FOUND')
    this.fixture.values.set(entry.id, entry.value)
    this.fixture.revisions.value += 1
    this.undoValues.delete(undoToken)
    return {
      status: 'completed' as const,
      resultingRevisions: { 'sample.scope': this.fixture.revisions.value },
      directRefs: [{ kind: 'sample.item', id: entry.id, revision: this.fixture.revisions.value }],
      evidence: [{
        kind: 'property_value' as const,
        target: { kind: 'sample.item', id: entry.id },
        fact: `实体 ${entry.id} 已撤销。`,
        data: entry.value,
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}

export function context(permissions = ['sample:read', 'sample:write']): ApplicationExecutionContext {
  return {
    requestId: 'request-one',
    exposure: 'assistant',
    permissions: new Set(permissions),
    acceptedDataClasses: new Set(['C0', 'C1']),
  }
}

export function mutationStep(id: string, value: number, revision = 0): ApplicationPlannedStep {
  return {
    kind: 'mutation',
    target: { kind: 'sample.item', id },
    entityType: 'sample.item',
    expectedRevisions: { 'sample.scope': revision },
    mutations: [{ propertyId: 'sample.value', operation: 'set', value }],
  }
}

export function collectionStep(): ApplicationPlannedStep {
  return {
    kind: 'collection',
    parent: { kind: 'sample.parent', id: 'parent-1' },
    entityType: 'sample.item',
    expectedRevisions: { 'sample.scope': 0 },
    operation: { kind: 'create', items: [{ properties: { 'sample.value': 2 } }] },
  }
}

export function removalStep(id: string, revision = 0): ApplicationPlannedStep {
  return {
    kind: 'collection',
    parent: { kind: 'sample.parent', id: 'parent-1' },
    entityType: 'sample.item',
    expectedRevisions: { 'sample.scope': revision },
    operation: { kind: 'remove', targets: [{ kind: 'sample.item', id }] },
  }
}

export function createEngine(fixture: Fixture) {
  let sequence = 0
  const engine = new ApplicationControlExecutionEngine(fixture.registry, {
    now: () => new Date('2026-08-01T00:00:00.000Z'),
    createOpaqueRef: (kind) => `${kind}:${String(++sequence).padStart(20, '0')}`,
  })
  const executor = new FixtureMutationExecutor(fixture)
  engine.registerMutationExecutor(executor)
  return { engine, executor }
}
