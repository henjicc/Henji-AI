import { describe, expect, it, vi } from 'vitest'

import type {
  ApplicationEntityProvider,
  ApplicationEntityRegistration,
} from './types'
import { ApplicationReflectionRegistry } from './registry'
import { unrestrictedCollectionAvailability, type ApplicationPropertyDescriptor } from '../reflection'
import type { JsonValue } from '../identifiers'
import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from '../domains/shared/applicationReflectionApplicationCapabilities'

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
  async getCollectionAvailability(parent) {
    return unrestrictedCollectionAvailability('sample.item', parent, { 'sample.items': 3 })
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
      parentTypes: ['sample.parent'],
      revisionScopes: ['sample.items'],
      queryCapabilityIds: ['get_sample_item'],
      schemaRef: schemaRef('entity', 'sample.item'),
      collectionWrite: {
        creatable: true,
        removable: false,
        requiredPropertyIds: ['sample.enabled'],
        maxItemsPerChange: 8,
      },
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

const multiValues: Record<string, Record<string, JsonValue>> = {
  one: { 'sample.enabled': true, 'sample.level': 4, 'sample.mode': 'safe', 'sample.created_at': 'a' },
  two: { 'sample.enabled': true, 'sample.level': 9, 'sample.mode': 'fast', 'sample.created_at': 'b' },
  three: { 'sample.enabled': false, 'sample.level': 4, 'sample.mode': 'safe', 'sample.created_at': 'c' },
}

const multiProvider: ApplicationEntityProvider = {
  ...provider,
  async listEntities() {
    return {
      refs: ['one', 'two', 'three'].map((id) => ({ kind: 'sample.item', id, revision: 3 })),
      nextCursor: null,
      revisions: { 'sample.items': 3 },
    }
  },
  async readEntity(ref, request) {
    const values = multiValues[ref.id] ?? {}
    const selected = new Set(request.propertyIds ?? Object.keys(values))
    return {
      ref,
      entityType: 'sample.item',
      revisions: { 'sample.items': 3 },
      properties: Object.fromEntries(Object.entries(values).filter(([id]) => selected.has(id))),
      capturedAt: '2026-08-01T00:00:00.000Z',
    }
  },
}

describe('ApplicationReflectionRegistry', () => {
  it('提供者只在通过授权后收到注册表的可信读取上下文', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    const read = vi.fn(provider.readEntity)
    registry.register({ ...registration(), provider: { ...provider, readEntity: read } })
    const target = { kind: 'sample.item', id: 'one' }
    await registry.readEntity(target, [], assistantContext)
    expect(read).toHaveBeenCalledWith(target, { propertyIds: [] }, assistantContext)
  })
  it('不可见实体在读取和动态可用性之前拒绝，不调用私有提供者', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    const read = vi.fn(provider.readEntity)
    const availability = vi.fn(provider.getPropertyAvailability)
    const collection = vi.fn(provider.getCollectionAvailability)
    registry.register({ ...registration(), provider: { ...provider, readEntity: read, getPropertyAvailability: availability, getCollectionAvailability: collection } })
    const access = { ...assistantContext, exposure: 'local_adapter' as const }
    const target = { kind: 'sample.item', id: 'one' }
    await expect(registry.readEntity(target, [], access)).rejects.toThrow('PERMISSION_DENIED')
    await expect(registry.getPropertyAvailability(target, [], access)).rejects.toThrow('PERMISSION_DENIED')
    await expect(registry.getCollectionAvailability({ kind: 'sample.parent', id: 'root' }, 'sample.item', access)).rejects.toThrow('PERMISSION_DENIED')
    expect(read).not.toHaveBeenCalled(); expect(availability).not.toHaveBeenCalled(); expect(collection).not.toHaveBeenCalled()
    await expect(registry.readEntity(target, [], { ...assistantContext, acceptedDataClasses: new Set(['C0'] as const) })).resolves.toMatchObject({ ref: target })
  })
  it('按领域、实体和权限返回唯一属性元数据与 schemaRef', () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    const description = registry.describe({ domains: ['sample'] }, assistantContext)
    expect(description.entities.map((item) => item.id)).toEqual(['sample.item'])
    expect(description.properties.map((item) => item.id)).toContain('sample.owner')
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
      .toThrow('应在 0 到 10 级 之间')
    expect(() => registry.normalizePropertyValue('sample.item', 'sample.level', 3, assistantContext))
      .toThrow('递增')
    expect(() => registry.normalizePropertyValue('sample.item', 'sample.mode', 'unknown', assistantContext))
      .toThrow('只能取')
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
    expect(snapshot.properties).toEqual({ 'sample.enabled': true, 'sample.owner': { kind: 'sample.owner', id: 'owner-one' } })
    const availability = await registry.getPropertyAvailability(
      { kind: 'sample.item', id: 'one' },
      ['sample.enabled', 'sample.mode'],
      assistantContext
    )
    expect(availability.find((item) => item.propertyId === 'sample.enabled')?.writable).toBe(true)
    expect(availability.find((item) => item.propertyId === 'sample.mode')?.writable).toBe(false)
  })

  it('通用读取省略 propertyIds 后返回全部授权可读属性，显式空数组仍只读基线', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    const capability = APPLICATION_REFLECTION_APPLICATION_CAPABILITIES.find(item => item.id === 'read_application_entity')!
    const input = capability.inputSchema.parse({ ref: { kind: 'sample.item', id: 'one' } }) as {
      ref: { kind: string; id: string }; propertyIds?: string[]
    }
    expect(input).not.toHaveProperty('propertyIds')
    const snapshot = await registry.readEntity(input.ref, input.propertyIds, assistantContext)
    expect(snapshot.properties).toEqual({ 'sample.enabled': true, 'sample.level': 4, 'sample.mode': 'safe', 'sample.created_at': '2026-08-01T00:00:00.000Z', 'sample.owner': { kind: 'sample.owner', id: 'owner-one' } })
    expect((await registry.readEntity(input.ref, [], assistantContext)).properties).toEqual({})
  })

  it('集合可用性同时合并静态声明、provider 当前状态与调用方权限', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register({
      ...registration(),
      provider: {
        ...provider,
        async getCollectionAvailability(parent) {
          return {
            entityType: 'sample.item', parent, revisions: { 'sample.items': 3 },
            create: {
              available: false, reasons: ['当前模式不允许创建'],
              requiredPermissions: ['sample:write'], recoveries: [],
            },
            remove: {
              available: true, reasons: [],
              requiredPermissions: ['sample:write'], recoveries: [],
            },
          }
        },
      },
    })
    const availability = await registry.getCollectionAvailability(
      { kind: 'sample.parent', id: 'parent-1' }, 'sample.item', assistantContext,
    )
    expect(availability.create).toMatchObject({ available: false, reasons: ['当前模式不允许创建'] })
    expect(availability.remove.available).toBe(false)
    expect(availability.remove.reasons).toContain('删除未在静态集合声明中开放')


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

  /*
   * 同一条道理往上挪一层：实体类型是脚本里第一个要写对的东西，写错就一步都走不了。
   *
   * 实测助手为了改一个设置值连着猜了 settings.preference / settings.value / application.setting
   * 三个不存在的类型，中间四次重新发现能力都没能纠正——因为 `ENTITY_TYPE_NOT_FOUND:settings.value`
   * 这句话里根本没有"那到底叫什么"。整次运行 17 回合、24.9 万 token，最终一个写入都没做成。
   */
  it('实体类型写错时报出真正注册了哪些实体', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register(registration())
    let message = ''
    try {
      await registry.listEntities('sample.itm', { limit: 10 }, assistantContext)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('ENTITY_TYPE_NOT_FOUND')
    expect(message).toContain('sample.item')
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
    expect(message).toContain('应为实体引用对象')
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

  it('provider 把超长正文当 label 时截到契约上限，不拒掉整页', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    const longText = `批注${'很长的内容 \n'.repeat(100)}`
    registry.register({
      ...registration(),
      provider: {
        ...provider,
        async listEntities() {
          return {
            refs: [{ kind: 'sample.item', id: 'one', label: longText }, { kind: 'sample.item', id: 'two', label: '短' }],
            nextCursor: null,
            revisions: { 'sample.items': 3 },
          }
        },
        async readEntity(ref, request) {
          return { ...(await provider.readEntity(ref, request)), ref: { ...ref, label: longText } }
        },
      },
    })
    const page = await registry.listEntities('sample.item', { limit: 10 }, assistantContext)
    const label = page.refs[0].label!
    expect(label.length).toBe(200)
    expect(label.endsWith('…')).toBe(true)
    expect(label).not.toMatch(/\n|\s{2}/)
    expect(page.refs[1].label).toBe('短')
    const snapshot = await registry.readEntity({ kind: 'sample.item', id: 'one' }, ['sample.enabled'], assistantContext)
    expect(snapshot.ref.label?.length).toBe(200)
  })

  it('provider 给出空白 label 时省略 label，而不是让整页校验失败', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register({
      ...registration(),
      provider: {
        ...provider,
        async listEntities() {
          return { refs: [{ kind: 'sample.item', id: 'one', label: '' }, { kind: 'sample.item', id: 'two', label: '  \n ' }], nextCursor: null, revisions: { 'sample.items': 3 } }
        },
        async readEntity(ref, request) {
          return { ...(await provider.readEntity(ref, request)), ref: { ...ref, label: '' } }
        },
      },
    })
    const page = await registry.listEntities('sample.item', { limit: 10 }, assistantContext)
    expect(page.refs).toEqual([{ kind: 'sample.item', id: 'one' }, { kind: 'sample.item', id: 'two' }])
    const snapshot = await registry.readEntity({ kind: 'sample.item', id: 'one' }, ['sample.enabled'], assistantContext)
    expect(snapshot.ref).toEqual({ kind: 'sample.item', id: 'one' })
  })

  /*
   * 「按名字找到那一个」是用户会原样说出口的话，以前脚本里写不出来。
   *
   * list 只返回 kind/id，模型看不见名称；受限脚本语言又不允许遍历读取结果去逐个比对。
   * 两条合起来把"确认改名成功了""把叫 X 的那个删掉"变成死路——实测素材库场景因此被打挂
   * （8 回合 6 次工具失败 0 个 Effect），画布与生成场景也各撞过一次。
   *
   * 筛选下沉到注册表统一做：providers 一行不用改，所有实体类型自动受益。
   */
  it('按属性等值过滤，只返回命中的实例并带上请求的属性值', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register({ ...registration(), provider: multiProvider })

    const hit = await registry.listEntities(
      'sample.item', { limit: 10 }, assistantContext,
      { where: { 'sample.mode': 'safe' }, propertyIds: ['sample.level'] },
    )
    expect(hit.refs.map((ref) => ref.id)).toEqual(['one', 'three'])
    expect(hit.items?.[0]?.properties).toEqual({ 'sample.level': 4 })

    const miss = await registry.listEntities(
      'sample.item', { limit: 10 }, assistantContext,
      { where: { 'sample.mode': '不存在的模式' } },
    )
    expect(miss.refs).toEqual([])
  })

  it('带过滤时一页不满就接着读下一页，读完返回空游标，不让调用方空翻', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    const ids = ['one', 'two', 'three', 'x1', 'x2', 'x3', 'x4']
    const pages: string[] = []
    registry.register({ ...registration(), provider: { ...multiProvider, async listEntities(request) {
      const offset = Number(request.cursor ?? 0)
      pages.push(`${offset}+${request.limit}`)
      const next = offset + request.limit
      return { refs: ids.slice(offset, next).map((id) => ({ kind: 'sample.item', id })), nextCursor: next < ids.length ? String(next) : null, revisions: { 'sample.items': 3 } }
    } } })
    const first = await registry.listEntities('sample.item', { limit: 2 }, assistantContext, { where: { 'sample.mode': 'safe' } })
    expect(first.refs.map((ref) => ref.id)).toEqual(['one', 'three'])
    expect(first.nextCursor).toBe('3')
    const rest = await registry.listEntities('sample.item', { cursor: first.nextCursor!, limit: 2 }, assistantContext, { where: { 'sample.mode': 'safe' } })
    expect(rest).toMatchObject({ refs: [], nextCursor: null })
    expect(pages).toEqual(['0+2', '2+1', '3+2', '5+2'])
  })

  /*
   * 属性键的解析约定与写入路径逐字相同（applicationReflectionAdapter 的 resolvePropertyId）：
   * 原样命中就用原样，补上 entityType 前缀能命中就补，都不命中就报错——不做任何猜测。
   * 读写两条路径必须是同一套约定，否则模型得记两种写法。
   */
  it('过滤属性名解析不出来时，报出这个实体真正有哪些属性', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    registry.register({ ...registration(), provider: multiProvider })
    let message = ''
    try {
      await registry.listEntities(
        'sample.item', { limit: 10 }, assistantContext, { where: { level: 9 } },
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('PROPERTY_NOT_FOUND')
    expect(message).toContain('sample.level')
  })

  it('不请求投影时行为与过去逐字一致，不做任何额外读取', async () => {
    const registry = new ApplicationReflectionRegistry(catalogVersion)
    let reads = 0
    registry.register({
      ...registration(),
      provider: { ...multiProvider, async readEntity(ref, request) {
        reads += 1
        return multiProvider.readEntity(ref, request)
      } },
    })
    const result = await registry.listEntities('sample.item', { limit: 10 }, assistantContext)
    expect(result.refs).toHaveLength(3)
    expect(result.items).toBeUndefined()
    expect(reads).toBe(0)
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
