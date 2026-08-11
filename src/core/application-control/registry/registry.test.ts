import { describe, expect, it } from 'vitest'

import type {
  ApplicationEntityProvider,
  ApplicationEntityRegistration,
} from './types'
import { ApplicationReflectionRegistry } from './registry'
import type { ApplicationPropertyDescriptor } from '../reflection'

const catalogVersion = 'application-capabilities/v2'
const digest = `sha256:${'a'.repeat(64)}`

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion, kind, id, version: 1, digest } as const
}

const properties: ApplicationPropertyDescriptor[] = [
  {
    id: 'sample.enabled',
    entityType: 'sample.item',
    version: 1,
    title: '启用',
    description: '是否启用。',
    value: { kind: 'boolean' },
    nullable: false,
    defaultValue: true,
    dataClass: 'C1',
    exposures: ['ui', 'assistant'],
    requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
    revisionScopes: ['sample.items'],
    schemaRef: schemaRef('property', 'sample.enabled'),
  },
  {
    id: 'sample.level',
    entityType: 'sample.item',
    version: 1,
    title: '等级',
    description: '受范围和步长约束的等级。',
    value: { kind: 'integer', hardRange: { min: 0, max: 10, step: 2 } },
    unit: '级',
    nullable: false,
    defaultValue: 0,
    dataClass: 'C1',
    exposures: ['ui', 'assistant'],
    requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
    revisionScopes: ['sample.items'],
    schemaRef: schemaRef('property', 'sample.level'),
  },
  {
    id: 'sample.mode',
    entityType: 'sample.item',
    version: 1,
    title: '模式',
    description: '运行模式。',
    value: { kind: 'enum', values: [{ value: 'safe', label: '安全' }, { value: 'fast', label: '快速' }] },
    nullable: false,
    defaultValue: 'safe',
    dataClass: 'C1',
    exposures: ['ui', 'assistant'],
    requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
    revisionScopes: ['sample.items'],
    schemaRef: schemaRef('property', 'sample.mode'),
  },
  {
    id: 'sample.owner',
    entityType: 'sample.item',
    version: 1,
    title: '所有者',
    description: '稳定所有者引用。',
    value: { kind: 'ref', refKinds: ['sample.owner'] },
    nullable: false,
    dataClass: 'C2',
    exposures: ['ui', 'assistant'],
    requiredPermissions: { read: ['sample:secret'], write: ['sample:secret'] },
    revisionScopes: ['sample.items'],
    schemaRef: schemaRef('property', 'sample.owner'),
  },
  {
    id: 'sample.created_at',
    entityType: 'sample.item',
    version: 1,
    title: '创建时间',
    description: '只读创建时间。',
    value: { kind: 'string' },
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant'],
    requiredPermissions: { read: ['sample:read'], write: [] },
    revisionScopes: ['sample.items'],
    readOnlyReason: '创建时间不可修改',
    schemaRef: schemaRef('property', 'sample.created_at'),
  },
]

const provider: ApplicationEntityProvider = {
  entityType: 'sample.item',
  async listEntities() {
    return {
      refs: [{ kind: 'sample.item', id: 'one', revision: 3 }],
      nextCursor: null,
      revisions: { 'sample.items': 3 },
    }
  },
  async readEntity(ref, request) {
    const values = {
      'sample.enabled': true,
      'sample.level': 4,
      'sample.mode': 'safe',
      'sample.owner': { kind: 'sample.owner', id: 'owner-one' },
      'sample.created_at': '2026-08-01T00:00:00.000Z',
    }
    const selected = new Set(request.propertyIds ?? Object.keys(values))
    return {
      ref,
      entityType: 'sample.item',
      revisions: { 'sample.items': 3 },
      properties: Object.fromEntries(Object.entries(values).filter(([id]) => selected.has(id))),
      capturedAt: '2026-08-01T00:00:00.000Z',
    }
  },
  async getPropertyAvailability(_ref, propertyIds) {
    return propertyIds.map((propertyId) => ({
      propertyId,
      readable: true,
      writable: propertyId !== 'sample.mode',
      reasons: propertyId === 'sample.mode' ? ['运行期间模式不可修改'] : [],
      requiredPermissions: propertyId === 'sample.owner' ? ['sample:secret'] : ['sample:read'],
      revisions: { 'sample.items': 3 },
    }))
  },
}

function registration(): ApplicationEntityRegistration {
  return {
    entity: {
      id: 'sample.item',
      domain: 'sample',
      version: 1,
      title: '样例实体',
      description: '用于验证注册表行为。',
      refKind: 'sample.item',
      dataClass: 'C1',
      exposures: ['ui', 'assistant'],
      parentTypes: [],
      revisionScopes: ['sample.items'],
      queryCapabilityIds: ['get_sample_item'],
      schemaRef: schemaRef('entity', 'sample.item'),
    },
    properties,
    provider,
  }
}

const assistantContext = {
  exposure: 'assistant' as const,
  permissions: new Set(['sample:read', 'sample:write']),
  acceptedDataClasses: new Set(['C0', 'C1'] as const),
}

describe('ApplicationReflectionRegistry', () => {
  it('按领域、实体和权限返回唯一属性元数据与 schemaRef', () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    const description = registry.describe({ domains: ['sample'] }, assistantContext)
    expect(description.entities.map((item) => item.id)).toEqual(['sample.item'])
    expect(description.properties.map((item) => item.id)).not.toContain('sample.owner')
    expect(registry.resolveSchema(schemaRef('property', 'sample.level'), assistantContext)).toMatchObject({
      id: 'sample.level',
      unit: '级',
    })
  })

  it('在领域写入前拒绝未知、只读、越界、步长和枚举错误', () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    expect(registry.normalizePropertyValue('sample.item', 'sample.level', 4, assistantContext)).toBe(4)
    expect(() => registry.normalizePropertyValue('sample.item', 'sample.level', 11, assistantContext))
      .toThrow('ABOVE_MAXIMUM')
    expect(() => registry.normalizePropertyValue('sample.item', 'sample.level', 3, assistantContext))
      .toThrow('INVALID_STEP')
    expect(() => registry.normalizePropertyValue('sample.item', 'sample.mode', 'unknown', assistantContext))
      .toThrow('UNKNOWN_ENUM_VALUE')
    expect(() => registry.normalizePropertyValue('sample.item', 'sample.created_at', 'later', assistantContext))
      .toThrow('PROPERTY_READ_ONLY')
    expect(() => registry.normalizePropertyValue('sample.item', 'store.internal', true, assistantContext))
      .toThrow('PROPERTY_NOT_FOUND')
  })

  it('委托领域提供者读取并应用动态只读与权限过滤', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    const snapshot = await registry.readEntity(
      { kind: 'sample.item', id: 'one' },
      ['sample.enabled', 'sample.owner'],
      assistantContext
    )
    expect(snapshot.properties).toEqual({ 'sample.enabled': true })
    const availability = await registry.getPropertyAvailability(
      { kind: 'sample.item', id: 'one' },
      ['sample.enabled', 'sample.mode'],
      assistantContext
    )
    expect(availability.find((item) => item.propertyId === 'sample.enabled')?.writable).toBe(true)
    expect(availability.find((item) => item.propertyId === 'sample.mode')?.writable).toBe(false)
  })

  /*
   * 拒绝必须能被自我修正——这是「不要给死胡同」在通用动词上的落点。
   *
   * 实测「让球上下浮动」那次，模型连撞七次通用写入：`PROPERTY_NOT_FOUND:transform.position.y`
   * （它按关键帧那套点分轴路径写，而属性层是整条 vector3）、两次 `NOT_FOUND`（id 要带工程
   * 前缀）、一次 `INVALID_REF`（ref_list 收对象不收字符串）。每条都只有一个错误码，模型只能
   * 靠猜，七次全花在拼格式上，一次都没花在用户的需求上。
   *
   * 校验器手里明明有可用属性清单、有 refKinds、有实际收到的东西——不说就是浪费。
   */
  it('属性名写错时报出这个实体真正有哪些属性', () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    let message = ''
    try {
      registry.normalizePropertyValue('sample.item', 'sample.levl', 4, assistantContext)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('PROPERTY_NOT_FOUND')
    // 只给错误码等于让模型继续猜；相近项必须点名
    expect(message).toContain('sample.level')
  })

  it('引用格式写错时报出正确形状、允许的 kind 和实际收到的东西', () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    // sample.owner 是 C2 + sample:secret，用有权限的上下文才走得到值校验那一步
    const privilegedContext = {
      exposure: 'assistant' as const,
      permissions: new Set(['sample:read', 'sample:write', 'sample:secret']),
      acceptedDataClasses: new Set(['C0', 'C1', 'C2'] as const),
    }
    let message = ''
    try {
      // 模型最容易犯的错：把 ref 当成裸字符串传
      registry.normalizePropertyValue('sample.item', 'sample.owner', 'owner-1', privilegedContext)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('EXPECTED_REF')
    expect(message).toContain('sample.owner')
    expect(message, '没告诉模型 ref 长什么样').toMatch(/kind.*id/)
    expect(message, '没回显实际收到的内容').toContain('owner-1')
  })

  it('实体读不到时说明引用从哪里取，不留一个光秃秃的 NOT_FOUND', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register({
      ...registration(),
      provider: {
        ...provider,
        async readEntity() {
          throw new Error('NOT_FOUND')
        },
      },
    })
    await expect(registry.readEntity(
      { kind: 'sample.item', id: '裸 id' },
      ['sample.enabled'],
      assistantContext,
    )).rejects.toThrow(/list_application_entities/)
  })

  it('拒绝重复实体、重复属性、非法路径和提供者类型不一致', () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    expect(() => registry.register(registration())).toThrow('重复 ID')
    expect(() => new ApplicationReflectionRegistry(catalogVersion).register({
      ...registration(),
      properties: [properties[0], properties[0]],
    })).toThrow('重复 ID')
    expect(() => new ApplicationReflectionRegistry(catalogVersion).register({
      ...registration(),
      properties: [{ ...properties[0], id: '__store.value' }],
    })).toThrow()
    expect(() => new ApplicationReflectionRegistry(catalogVersion).register({
      ...registration(),
      provider: { ...provider, entityType: 'sample.other' },
    })).toThrow('领域提供者实体类型不一致')
  })
})
