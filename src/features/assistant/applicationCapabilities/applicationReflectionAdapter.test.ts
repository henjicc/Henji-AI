import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  describe: vi.fn(),
  listDeclaredPropertyPermissions: vi.fn(() => ['assets:read', 'assets:write', 'storyboard:read']),
  listProperties: vi.fn((entityType: string) => (
    entityType === 'sample.item'
      ? [
          { id: 'sample.item.object_ref' },
          { id: 'sample.item.property_path' },
          { id: 'sample.item.time' },
          { id: 'sample.item.value' },
          { id: 'sample.item.easing' },
        ]
      : [{ id: 'asset.library_refs' }]
  )),
  getPropertyAvailability: vi.fn(),
  getCollectionAvailability: vi.fn(),
  plan: vi.fn(),
  commit: vi.fn(),
  readEntity: vi.fn(),
  listEntities: vi.fn(),
  getAcceptedPropertyOperations: vi.fn(() => ['set']),
}))

vi.mock('./applicationControlRegistry', () => ({
  getApplicationReflectionRegistry: () => ({
    describe: mocks.describe,
    listDeclaredPropertyPermissions: mocks.listDeclaredPropertyPermissions,
    listProperties: mocks.listProperties,
    getPropertyAvailability: mocks.getPropertyAvailability,
    getCollectionAvailability: mocks.getCollectionAvailability,
    readEntity: mocks.readEntity,
    listEntities: mocks.listEntities,
  }),
  getApplicationControlExecutionEngine: () => ({
    plan: mocks.plan,
    commit: mocks.commit,
    getAcceptedPropertyOperations: mocks.getAcceptedPropertyOperations,
  }),
}))

import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/applicationReflectionApplicationCapabilities'
import { agentObservedEffectSchema } from '@/core/assistant/taskGraph'

import { applicationReflectionHandlers } from './applicationReflectionAdapter'

const context = { signal: new AbortController().signal, requestId: 'reflection-adapter-test' }

describe('应用反射通用能力适配器', () => {
  beforeEach(() => {
    mocks.readEntity.mockResolvedValue({
      ref: { kind: 'sample.item', id: 'item-1' }, entityType: 'sample.item',
      properties: {}, revisions: {}, capturedAt: new Date().toISOString(),
    })
    mocks.getCollectionAvailability.mockResolvedValue({
      entityType: 'sample.item', parent: { kind: 'sample.parent', id: 'parent-1' },
      create: { available: true, reasons: [], requiredPermissions: [], recoveries: [], blocks: [] },
      remove: { available: true, reasons: [], requiredPermissions: [], recoveries: [], blocks: [] },
      revisions: { toolbox: 2 },
    })
  })
  it('实体列表含显示标签时仍产生合法的稳定引用 Effect', () => {
    const capability = APPLICATION_REFLECTION_APPLICATION_CAPABILITIES.find(
      (item) => item.id === 'list_application_entities'
    )
    const effects = capability?.resolveObservedEffects?.(
      { entityType: 'camera_stage.state_keyframe', limit: 50 },
      {
        refs: [{
          kind: 'camera_stage.state_keyframe', id: 'project-1:keyframe-1', label: '状态关键帧 1', revision: 3,
        }],
        nextCursor: null, revisions: { toolbox: 3 }, revision: 3, scopeRevisions: { toolbox: 3 },
      },
    ) ?? []

    expect(effects.map((effect) => agentObservedEffectSchema.parse(effect))).toEqual([
      expect.objectContaining({
        targetRefs: [{ kind: 'camera_stage.state_keyframe', id: 'project-1:keyframe-1' }],
      }),
    ])
  })
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
        id: 'sample.item', domain: 'sample', version: 1,
        title: '样例项', description: '测试集合成员。', refKind: 'sample.item',
        dataClass: 'C1', exposures: ['ui', 'assistant'], parentTypes: ['camera_stage.scene'],
        revisionScopes: ['toolbox'], queryCapabilityIds: ['observe_camera_stage_scene'],
        collectionWrite: { creatable: true, removable: true, requiredPropertyIds: ['sample.item.time'], maxItemsPerChange: 128 },
        schemaRef: { catalogVersion: 'application-capabilities/v2', kind: 'entity', id: 'sample.item', version: 1, digest: `sha256:${'a'.repeat(64)}` },
      }],
      properties: [{
        id: 'sample.item.time', entityType: 'sample.item', version: 1,
        title: '时间', description: '关键帧时间。', value: { kind: 'number', minimum: 0 },
        nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant'],
        requiredPermissions: { read: ['camera_stage:read'], write: ['camera_stage:write'] },
        revisionScopes: ['toolbox'],
        schemaRef: { catalogVersion: 'application-capabilities/v2', kind: 'property', id: 'sample.item.time', version: 1, digest: `sha256:${'b'.repeat(64)}` },
      }],
    })

    const result = await applicationReflectionHandlers.describeEntities(
      { domains: [], entityTypes: ['sample.item'] },
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
      id: 'sample.item',
      parentTypes: ['camera_stage.scene'],
      collectionWrite: { creatable: true, requiredPropertyIds: ['sample.item.time'] },
    })
    expect(result.properties[0]).toEqual({
      id: 'sample.item.time',
      entityType: 'sample.item',
      title: '时间',
      description: '关键帧时间。',
      value: { kind: 'number', minimum: 0 },
      writable: true,
      writeOperations: ['set'],
    })
  })

  it('结构描述公开计划入口真实接受的属性操作及引用集合替换语义', async () => {
    mocks.describe.mockReturnValueOnce({
      catalogVersion: 'application-capabilities/v2',
      entities: [],
      properties: [{
        id: 'asset.library_refs', entityType: 'asset', title: '所属集合', description: '素材所属集合。',
        value: { kind: 'ref_list', refKinds: ['asset.library'] }, nullable: false,
        requiredPermissions: { read: ['assets:read'], write: ['assets:write'] },
      }],
    })
    mocks.getAcceptedPropertyOperations.mockReturnValueOnce(['append', 'remove', 'set'])

    const result = await applicationReflectionHandlers.describeEntities(
      { domains: ['assets'], entityTypes: ['asset'] }, context,
    )

    expect(result.properties[0]).toMatchObject({
      id: 'asset.library_refs',
      writeOperations: ['append', 'remove', 'set'],
      setBehavior: 'replace_collection',
    })
  })

  it('带实例引用时投影当前属性与集合可用性，并剔除权限和 revision 噪音', async () => {
    mocks.describe.mockReturnValueOnce({
      catalogVersion: 'application-capabilities/v2',
      entities: [{
        id: 'sample.item', title: '样例项', description: '测试集合成员。',
        parentTypes: ['camera_stage.scene'],
        collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [], maxItemsPerChange: 128 },
      }],
      properties: [],
    })
    mocks.listProperties.mockReturnValueOnce([{ id: 'camera_stage.scene.timeline.duration' }])
    mocks.getPropertyAvailability.mockResolvedValueOnce([{
      propertyId: 'camera_stage.scene.timeline.duration', readable: true, writable: false,
      reasons: ['只读'], recoveries: [], requiredPermissions: ['camera_stage:read'], revisions: { toolbox: 4 },
    }])
    mocks.getCollectionAvailability.mockResolvedValueOnce({
      entityType: 'sample.item', parent: { kind: 'camera_stage.scene', id: 'project-1' },
      create: {
        available: false, reasons: ['简易模式以状态关键帧作为时间轴。'], requiredPermissions: ['camera_stage:write'],
        recoveries: [{ summary: '先满足测试状态要求。', capabilityIds: [], entityTypes: ['sample.parent'], propertyIds: [] }],
      },
      remove: { available: false, reasons: ['简易模式以状态关键帧作为时间轴。'], requiredPermissions: ['camera_stage:write'], recoveries: [] },
      revisions: { toolbox: 4 },
    })

    const result = await applicationReflectionHandlers.describeEntities({
      domains: ['camera_stage'], entityTypes: [], refs: [{ kind: 'camera_stage.scene', id: 'project-1' }],
    }, context)

    expect(result.propertyAvailability[0]).toMatchObject({
      ref: { kind: 'camera_stage.scene', id: 'project-1' },
      properties: [{ propertyId: 'camera_stage.scene.timeline.duration', writable: false, reasons: ['只读'] }],
    })
    expect(result.collectionAvailability[0]).toMatchObject({
      entityType: 'sample.item',
      create: { available: false, reasons: ['简易模式以状态关键帧作为时间轴。'] },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/requiredPermissions|revisions/)
    expect(serialized.length).toBeLessThan(5_000)
  })

  it('mutate_properties 原样传递 append/remove 等属性操作', async () => {
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-1' })
    mocks.commit.mockResolvedValueOnce({
      status: 'completed',
      transactionRef: 'transaction-1',
      resultingRevisions: { assets: 2 },
      resultRefs: [], effects: [],
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

  it('mutation 以 entityType 规范化冗余的 ref.kind，避免在错误实体上查属性', async () => {
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-playback' })
    mocks.commit.mockResolvedValueOnce({
      status: 'completed', transactionRef: 'transaction-playback',
      resultingRevisions: { toolbox: 2 }, resultRefs: [], effects: [], evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '定位播放头',
      changes: [{
        kind: 'set_properties',
        // 真实日志中的错误形状：id 正确，但 kind 沿用了 project。
        target: { kind: 'camera_stage.project', id: 'project-1' },
        entityType: 'camera_stage.playback',
        properties: { 'camera_stage.playback.current_time': 1 },
      }],
    }, context)

    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({
        target: { kind: 'camera_stage.playback', id: 'project-1' },
      })],
    }), expect.any(Object))
  })

  it('截断引用仅在缓存中唯一命中时恢复完整稳定引用', async () => {
    mocks.listEntities.mockResolvedValueOnce({
      refs: [{ kind: 'sample.unique', id: '02e7225a-full-stable-id' }],
      nextCursor: null, revisions: {},
    })
    await applicationReflectionHandlers.listEntities({ entityType: 'sample.unique', limit: 10 }, context)
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-normalized-ref' })
    mocks.commit.mockResolvedValueOnce({
      status: 'completed', transactionRef: 'transaction-normalized-ref',
      resultingRevisions: {}, resultRefs: [], effects: [], evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '使用缓存的完整引用',
      changes: [{
        kind: 'set_properties', target: { kind: 'sample.unique', id: '02e7225a…' },
        entityType: 'sample.unique', properties: { value: 1 },
      }],
    }, context)

    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ target: { kind: 'sample.unique', id: '02e7225a-full-stable-id' } })],
    }), expect.any(Object))
  })

  it('截断引用存在多个候选时拒绝猜测且执行器调用次数为零', async () => {
    mocks.listEntities.mockResolvedValueOnce({
      refs: [
        { kind: 'sample.ambiguous', id: 'same-prefix-first' },
        { kind: 'sample.ambiguous', id: 'same-prefix-second' },
      ],
      nextCursor: null, revisions: {},
    })
    await applicationReflectionHandlers.listEntities({ entityType: 'sample.ambiguous', limit: 10 }, context)
    const planCalls = mocks.plan.mock.calls.length

    await expect(applicationReflectionHandlers.changeEntities({
      summary: '禁止猜测引用',
      changes: [{
        kind: 'set_properties', target: { kind: 'sample.ambiguous', id: 'same-prefix…' },
        entityType: 'sample.ambiguous', properties: { value: 1 },
      }],
    }, context)).rejects.toThrow('REFRESH_REQUIRED')
    expect(mocks.plan).toHaveBeenCalledTimes(planCalls)
  })

  it('提交前的无副作用 revision 冲突自动刷新一次并重新规划', async () => {
    mocks.readEntity
      .mockResolvedValueOnce({
        ref: { kind: 'sample.item', id: 'item-stable' }, entityType: 'sample.item',
        properties: { 'sample.item.value': 1 }, revisions: { toolbox: 1 }, capturedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        ref: { kind: 'sample.item', id: 'item-stable' }, entityType: 'sample.item',
        properties: { 'sample.item.value': 1 }, revisions: { toolbox: 2 }, capturedAt: new Date().toISOString(),
      })
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-stale' }).mockResolvedValueOnce({ planRef: 'plan-refreshed' })
    mocks.commit
      .mockResolvedValueOnce({ status: 'failed', code: 'CONFLICT', message: '状态变化', recoverable: true })
      .mockResolvedValueOnce({
        status: 'completed', transactionRef: 'transaction-refreshed', resultingRevisions: { toolbox: 3 },
        resultRefs: [], effects: [], evidence: [],
      })

    await applicationReflectionHandlers.changeEntities({
      summary: '刷新后写入',
      changes: [{
        kind: 'set_properties', target: { kind: 'sample.item', id: 'item-stable' },
        entityType: 'sample.item', properties: { value: 2 },
      }],
    }, { ...context, expectedRevisions: { toolbox: 1 } })

    expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ expectedRevisions: { toolbox: 2 } })],
    }), expect.any(Object))
  })

  it('集合新增在执行器尚未运行的 revision 冲突后从动态可用性刷新并重规划', async () => {
    mocks.getCollectionAvailability.mockResolvedValueOnce({
      entityType: 'sample.item', parent: { kind: 'sample.parent', id: 'parent-1' },
      create: { available: true, reasons: [], requiredPermissions: [], recoveries: [], blocks: [] },
      remove: { available: true, reasons: [], requiredPermissions: [], recoveries: [], blocks: [] },
      revisions: { toolbox: 7 },
    })
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-stale' }).mockResolvedValueOnce({ planRef: 'plan-refreshed' })
    mocks.commit
      .mockResolvedValueOnce({ status: 'failed', code: 'CONFLICT', message: '集合 revision 变化', recoverable: true })
      .mockResolvedValueOnce({
        status: 'completed', transactionRef: 'transaction-refreshed', resultingRevisions: { toolbox: 8 },
        resultRefs: [], effects: [], evidence: [],
      })

    await applicationReflectionHandlers.changeEntities({
      summary: '创建集合成员',
      changes: [{
        kind: 'create_items', parent: { kind: 'sample.parent', id: 'parent-1' },
        entityType: 'sample.item', items: [{ properties: { value: 2 } }],
      }],
    }, { ...context, expectedRevisions: { toolbox: 1 } })

    expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ expectedRevisions: { toolbox: 7 } })],
    }), expect.any(Object))
  })

  it('revision 刷新时目标属性已变化则停止且不覆盖', async () => {
    mocks.readEntity
      .mockResolvedValueOnce({
        ref: { kind: 'sample.item', id: 'item-concurrent' }, entityType: 'sample.item',
        properties: { 'sample.item.value': 1 }, revisions: { toolbox: 1 }, capturedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        ref: { kind: 'sample.item', id: 'item-concurrent' }, entityType: 'sample.item',
        properties: { 'sample.item.value': 9 }, revisions: { toolbox: 2 }, capturedAt: new Date().toISOString(),
      })
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-concurrent' })
    mocks.commit.mockResolvedValueOnce({ status: 'failed', code: 'CONFLICT', message: '状态变化', recoverable: true })
    const commitCalls = mocks.commit.mock.calls.length

    await expect(applicationReflectionHandlers.changeEntities({
      summary: '不得覆盖并发变化',
      changes: [{
        kind: 'set_properties', target: { kind: 'sample.item', id: 'item-concurrent' },
        entityType: 'sample.item', properties: { value: 2 },
      }],
    }, { ...context, expectedRevisions: { toolbox: 1 } })).rejects.toThrow('目标属性已在刷新期间变化')
    expect(mocks.commit).toHaveBeenCalledTimes(commitCalls + 1)
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
      resultRefs: [], effects: [],
      evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '写入漂浮关键帧',
      changes: [{
        kind: 'create_items',
        parent: { kind: 'camera_stage.scene', id: 'project-1' },
        entityType: 'sample.item',
        items: [{
          properties: {
            // 短名要被补全
            object_ref: 'object-1',
            time: 0,
            // 已经是完整 ID 的原样保留
            'sample.item.value': '1.0',
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
              'sample.item.object_ref': 'object-1',
              'sample.item.time': 0,
              'sample.item.value': '1.0',
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
      resultingRevisions: {}, resultRefs: [], effects: [], evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '写入未知属性',
      changes: [{
        kind: 'set_properties',
        target: { kind: 'sample.item', id: 'item-1' },
        entityType: 'sample.item',
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

  it('通用写入把正式执行器报告的自动状态关键帧计为级联 Effect', () => {
    const capability = APPLICATION_REFLECTION_APPLICATION_CAPABILITIES
      .find((item) => item.id === 'change_application_entities')
    if (!capability?.resolveObservedEffects) throw new Error('CHANGE_EFFECT_RESOLVER_MISSING')
    const effects = capability.resolveObservedEffects({
      summary: '写入动画',
      changes: [{
        kind: 'set_properties', entityType: 'camera_stage.object',
        target: { kind: 'camera_stage.object', id: 'project-1:object-1' },
        properties: { 'camera_stage.object.animatable.transform.position.y': 1.5 },
      }],
    } as never, {
      status: 'completed', transactionRef: 'transaction-1', resultingRevisions: { toolbox: 2 },
      resultRefs: [], evidence: [], effects: [{
        effect: 'create', entityType: 'camera_stage.state_keyframe',
        refs: [{ kind: 'camera_stage.state_keyframe', id: 'project-1:keyframe-2' }],
        propertyIds: [], origin: { kind: 'cascade', declarationId: 'camera_stage.auto_state_keyframe_create' },
      }],
    } as never)
    expect(effects).toContainEqual(expect.objectContaining({
      effect: 'create', entityTypes: ['camera_stage.state_keyframe'],
      targetRefs: [{ kind: 'camera_stage.state_keyframe', id: 'project-1:keyframe-2' }],
    }))
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
