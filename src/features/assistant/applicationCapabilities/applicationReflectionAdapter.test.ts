import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  describe: vi.fn(),
  listDeclaredPropertyPermissions: vi.fn(() => ['assets:read', 'assets:write', 'storyboard:read']),
  listProperties: vi.fn((entityType: string) => (
    entityType === 'camera_stage.keyframe'
      ? [
          { id: 'camera_stage.keyframe.object_ref' },
          { id: 'camera_stage.keyframe.property_path' },
          { id: 'camera_stage.keyframe.time' },
          { id: 'camera_stage.keyframe.value' },
          { id: 'camera_stage.keyframe.easing' },
        ]
      : [{ id: 'asset.library_refs' }]
  )),
  plan: vi.fn(),
  commit: vi.fn(),
}))

vi.mock('./applicationControlRegistry', () => ({
  getApplicationReflectionRegistry: () => ({
    describe: mocks.describe,
    listDeclaredPropertyPermissions: mocks.listDeclaredPropertyPermissions,
    listProperties: mocks.listProperties,
  }),
  getApplicationControlExecutionEngine: () => ({
    plan: mocks.plan,
    commit: mocks.commit,
  }),
}))

import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/applicationReflectionApplicationCapabilities'

import { applicationReflectionHandlers } from './applicationReflectionAdapter'

const context = { signal: new AbortController().signal, requestId: 'reflection-adapter-test' }

describe('应用反射通用能力适配器', () => {
  it('内部领域权限完全从反射注册源派生', async () => {
    mocks.describe.mockReturnValueOnce({ catalogVersion: 'application-capabilities/v2', entities: [], properties: [] })
    await applicationReflectionHandlers.describeEntities({ domains: [], entityTypes: [] }, context)

    const accessContext = mocks.describe.mock.calls[0]?.[1] as { permissions: Set<string> }
    expect([...accessContext.permissions]).toEqual(expect.arrayContaining([
      'application:read', 'application:write', 'assets:read', 'assets:write', 'storyboard:read',
    ]))
  })

  /*
   * 回归：结构描述把大量对模型无意义的字段一起发过去。
   *
   * 权限名、exposures、revisionScopes、64 字符的 sha256 digest 都不影响模型怎么写参数——
   * 权限由网关强制、revision 由信封填、digest 只用于版本比对。实测一次 4 实体 81 属性的描述
   * 回了 62KB（≈3.1 万 token），占整轮输入近一半。
   */
  it('结构描述只投影模型据以决策的字段，剔除 digest 与权限等噪音', async () => {
    mocks.describe.mockReturnValueOnce({
      catalogVersion: 'application-capabilities/v2',
      entities: [{
        id: 'camera_stage.keyframe', domain: 'camera_stage', version: 1,
        title: '关键帧', description: '对象属性关键帧。', refKind: 'camera_stage.keyframe',
        dataClass: 'C1', exposures: ['ui', 'assistant'], parentTypes: ['camera_stage.scene'],
        revisionScopes: ['toolbox'], queryCapabilityIds: ['observe_camera_stage_scene'],
        collectionWrite: { creatable: true, removable: true, requiredPropertyIds: ['camera_stage.keyframe.time'], maxItemsPerChange: 128 },
        schemaRef: { catalogVersion: 'application-capabilities/v2', kind: 'entity', id: 'camera_stage.keyframe', version: 1, digest: `sha256:${'a'.repeat(64)}` },
      }],
      properties: [{
        id: 'camera_stage.keyframe.time', entityType: 'camera_stage.keyframe', version: 1,
        title: '时间', description: '关键帧时间。', value: { kind: 'number', minimum: 0 },
        nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant'],
        requiredPermissions: { read: ['camera_stage:read'], write: ['camera_stage:write'] },
        revisionScopes: ['toolbox'],
        schemaRef: { catalogVersion: 'application-capabilities/v2', kind: 'property', id: 'camera_stage.keyframe.time', version: 1, digest: `sha256:${'b'.repeat(64)}` },
      }],
    })

    const result = await applicationReflectionHandlers.describeEntities(
      { domains: [], entityTypes: ['camera_stage.keyframe'] },
      context,
    )
    const serialized = JSON.stringify(result)
    for (const noise of ['sha256:', 'requiredPermissions', 'exposures', 'revisionScopes', 'dataClass']) {
      expect(serialized, `${noise} 不应发给模型`).not.toContain(noise)
    }
    // refKind 与 id 相同时不重复给。
    expect(serialized).not.toContain('refKind')
    // 决策所需的字段一个都不能少。
    expect(result.entities[0]).toMatchObject({
      id: 'camera_stage.keyframe',
      parentTypes: ['camera_stage.scene'],
      collectionWrite: { creatable: true, requiredPropertyIds: ['camera_stage.keyframe.time'] },
    })
    expect(result.properties[0]).toEqual({
      id: 'camera_stage.keyframe.time',
      title: '时间',
      description: '关键帧时间。',
      value: { kind: 'number', minimum: 0 },
      writable: true,
    })
  })

  it('mutate_properties 原样传递 append/remove 等属性操作', async () => {
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-1' })
    mocks.commit.mockResolvedValueOnce({
      status: 'completed',
      transactionRef: 'transaction-1',
      resultingRevisions: { assets: 2 },
      producedRefs: [],
      evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '调整素材集合归属',
      expectedRevisions: { assets: 1 },
      changes: [{
        kind: 'mutate_properties',
        target: { kind: 'asset', id: 'asset-1' },
        entityType: 'asset',
        mutations: [
          { propertyId: 'asset.library_refs', operation: 'append', value: { kind: 'asset.library', id: 'lib-1' } },
          { propertyId: 'asset.library_refs', operation: 'remove', value: { kind: 'asset.library', id: 'lib-2' } },
        ],
      }],
    }, context)

    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({
        kind: 'mutation',
        mutations: [
          { propertyId: 'asset.library_refs', operation: 'append', value: { kind: 'asset.library', id: 'lib-1' } },
          { propertyId: 'asset.library_refs', operation: 'remove', value: { kind: 'asset.library', id: 'lib-2' } },
        ],
      })],
    }), expect.any(Object))
  })

  /*
   * 回归：集合成员创建时属性键必须写成完整属性 ID。
   *
   * 每个 change 都已经带了 entityType，再要求把它当前缀重写进每个键纯属冗余，而这份冗余既不在
   * 工具 schema 里（那里是 record(string, unknown)）也不在描述里，只在内部计划层拦截。实测助手
   * 按 describe 给的字段名写 object_ref/time/value，收到一整屏 "Invalid key in record"，
   * 两个物体的漂浮关键帧全部写不进去。
   */
  it('集合创建的属性键按 entityType 自动补全为完整属性 ID', async () => {
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-keyframe' })
    mocks.commit.mockResolvedValueOnce({
      status: 'completed',
      transactionRef: 'transaction-keyframe',
      resultingRevisions: { toolbox: 3 },
      producedRefs: [],
      evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '写入漂浮关键帧',
      changes: [{
        kind: 'create_items',
        parent: { kind: 'camera_stage.scene', id: 'project-1' },
        entityType: 'camera_stage.keyframe',
        items: [{
          properties: {
            // 短名要被补全
            object_ref: 'object-1',
            time: 0,
            // 已经是完整 ID 的原样保留
            'camera_stage.keyframe.value': '1.0',
          },
        }],
      }],
    }, context)

    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({
        kind: 'collection',
        operation: {
          kind: 'create',
          items: [{
            properties: {
              'camera_stage.keyframe.object_ref': 'object-1',
              'camera_stage.keyframe.time': 0,
              'camera_stage.keyframe.value': '1.0',
            },
          }],
        },
      })],
    }), expect.any(Object))
  })

  it('未声明的属性键保持原样，交给注册表报未知属性而不是猜测', async () => {
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-unknown' })
    mocks.commit.mockResolvedValueOnce({
      status: 'completed', transactionRef: 'transaction-unknown',
      resultingRevisions: {}, producedRefs: [], evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '写入未知属性',
      changes: [{
        kind: 'set_properties',
        target: { kind: 'camera_stage.keyframe', id: 'keyframe-1' },
        entityType: 'camera_stage.keyframe',
        properties: { not_declared: 1 },
      }],
    }, context)

    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({
        mutations: [{ propertyId: 'not_declared', operation: 'set', value: 1 }],
      })],
    }), expect.any(Object))
  })

  it('公开能力 schema 接受 mutate_properties，拒绝缺失 value 的 append', () => {
    const capability = APPLICATION_REFLECTION_APPLICATION_CAPABILITIES
      .find((item) => item.id === 'change_application_entities')
    if (!capability) throw new Error('CHANGE_APPLICATION_ENTITIES_MISSING')
    const base = {
      summary: '修改素材', expectedRevisions: { assets: 1 },
      changes: [{
        kind: 'mutate_properties', target: { kind: 'asset', id: 'asset-1' }, entityType: 'asset',
        mutations: [{ propertyId: 'asset.library_refs', operation: 'append', value: 'lib-1' }],
      }],
    }
    expect(capability.inputSchema.safeParse(base).success).toBe(true)
    expect(capability.inputSchema.safeParse({
      ...base,
      changes: [{
        kind: 'mutate_properties', target: { kind: 'asset', id: 'asset-1' }, entityType: 'asset',
        mutations: [{ propertyId: 'asset.library_refs', operation: 'append' }],
      }],
    }).success).toBe(false)
  })

  it('通用写入对所有可写反射领域解析精确 revision 作用域', () => {
    const capability = APPLICATION_REFLECTION_APPLICATION_CAPABILITIES
      .find((item) => item.id === 'change_application_entities')
    if (!capability?.resolveRequiredScopes) throw new Error('CHANGE_REQUIRED_SCOPE_RESOLVER_MISSING')
    const input = (entityType: string, propertyId: string) => ({
      summary: `修改 ${entityType}`,
      changes: [{
        kind: 'set_properties' as const,
        target: { kind: entityType, id: 'target-1' }, entityType,
        properties: { [propertyId]: 'value' },
      }],
    })
    expect(capability.resolveRequiredScopes(input('camera_stage.object', 'camera_stage.object.color') as never))
      .toEqual(['toolbox'])
    expect(capability.resolveRequiredScopes(input('canvas.node', 'canvas.node.title') as never))
      .toEqual(['canvas'])
    expect(capability.resolveRequiredScopes(input('asset', 'asset.favorite') as never))
      .toEqual(['assets'])
    expect(capability.resolveRequiredScopes(input('application.setting', 'application.setting.value') as never))
      .toEqual(['settings'])
  })
})
