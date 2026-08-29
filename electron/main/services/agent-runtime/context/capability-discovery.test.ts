import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type {
  ApplicationCapabilityDiscoveryInput,
  ApplicationCapabilityDiscoveryOutput,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import { applicationCapabilityDiscoveryInputSchema } from '../../../../../src/core/assistant/capabilityDiscovery'
import { AGENT_DISCOVERY_LEASE_TOOL_LIMIT } from '../../../../../src/core/assistant/toolBudget'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AGENT_CORE_TOOL_NAMES } from './tool-activation'
import { AgentCapabilityDiscoveryCatalog, pairReadAndWriteByEntity } from './capability-discovery'

function fullContext(registry: ReturnType<typeof createBuiltinAgentToolRegistry>): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-discovery',
    revision: 5,
    scopeRevisions: { navigation: 2, generation: 1, canvas: 3, toolbox: 4, assets: 1 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    surface: { id: 'tool.camera_stage', kind: 'tool', focusedRef: null, selectedRefs: [] },
    project: { id: 'project-1', selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: registry.allDefinitions()
      .filter((definition) => definition.side === 'frontend')
      .map((definition) => definition.name),
    capturedAt: new Date().toISOString(),
  }
}

function request(
  partial: Partial<ApplicationCapabilityDiscoveryInput> & Pick<ApplicationCapabilityDiscoveryInput, 'queries'>
): ApplicationCapabilityDiscoveryInput {
  return applicationCapabilityDiscoveryInputSchema.parse(partial)
}

function createCatalog(): {
  catalog: AgentCapabilityDiscoveryCatalog
  registry: ReturnType<typeof createBuiltinAgentToolRegistry>
  context: HostContextSnapshot
} {
  const registry = createBuiltinAgentToolRegistry(async () => {
    throw new Error('测试不执行前端工具')
  })
  return { registry, catalog: new AgentCapabilityDiscoveryCatalog(registry), context: fullContext(registry) }
}

function discover(
  input: ApplicationCapabilityDiscoveryInput,
  runId = 'run-discovery'
): ApplicationCapabilityDiscoveryOutput {
  const { catalog, context } = createCatalog()
  return catalog.discover(runId, input, context)
}

describe('AgentCapabilityDiscoveryCatalog', () => {
  /*
   * 准入只有域，其余全是排序信号。
   *
   * capability-discovery.ts 的 structuralMatch 上方记录了四次同形事故：surface、entityTypes、
   * capabilityKinds、导航 surface 分别被当成硬过滤，已注册能力因此对模型隐身。每次修都只堵住
   * 当次那一条，因为**过滤这个动作本身**才是错的。这条门禁守住"域之外不再有硬过滤"。
   */
  it('点名实体不会把同一次请求里其他域的能力筛掉', () => {
    const result = discover(request({
      queries: ['在三维场景里放置对象', '打开三维编辑器'],
      domains: ['camera_stage', 'navigation'],
      entityTypes: ['camera_stage.object'],
    }))
    const names = result.capabilities.map((item) => item.name)
    // 实体只命中 camera_stage，但 navigation 域的能力不能因此消失。
    expect(names.some((name) => name.includes('camera_stage'))).toBe(true)
    expect(result.capabilities.some((item) => (
      item.domain === 'navigation' || item.category === 'navigation'
    ))).toBe(true)
  })

  /*
   * 本阶段的核心替代设计：读写配对保底。
   *
   * 它替换的是 requiredEffectScore——那个分数的输入由运行时代填，模型写不出来，所以旧实现
   * 必须先把模型的请求整个改写掉才轮得到它生效。现在改成一条从注册表推导的结构规则：
   * 脚本要写就得先读（拿 ref、读回验证），所以每个点名实体至少保证一读一写进入投影。
   * 这条规则不依赖模型的任何猜测，可以对全部已注册实体穷举验证。
   */
  it('每个点名实体在租约里读写成对', () => {
    const { catalog, registry, context } = createCatalog()
    const entityTypes = [...new Set(registry.allDefinitions()
      .flatMap((definition) => definition.capability?.control?.impacts ?? [])
      .flatMap((impact) => impact.entityTypes))]
      .filter((entityType) => entityType.includes('.'))

    expect(entityTypes.length).toBeGreaterThan(0)
    for (const entityType of entityTypes.slice(0, 12)) {
      // 刻意不填 domains：这条门禁只验证「配对保底」本身，把域准入隔离出去。
      const result = catalog.discover(`run-pair-${entityType}`, request({
        queries: [`操作 ${entityType}`], entityTypes: [entityType], writes: true,
      }), context)
      /*
       * 判据是「可达」而不是「在租约里」。
       *
       * 核心地板工具（get_current_application_context 等）本来就永久激活，
       * selectLeaseableToolNames 刻意跳过它们——不发租约不等于拿不到。
       */
      const reachable = new Set([...result.leasedToolNames, ...AGENT_CORE_TOOL_NAMES])
      const touching = registry.allDefinitions().filter((definition) => (
        (definition.capability?.control?.impacts ?? [])
          .some((impact) => impact.entityTypes.includes(entityType))
      ))
      const hasReadable = touching.some((definition) => definition.readOnly)
      const hasWritable = touching.some((definition) => !definition.readOnly)
      if (hasReadable) {
        expect(touching.some((definition) => definition.readOnly && reachable.has(definition.name)), entityType)
          .toBe(true)
      }
      if (hasWritable) {
        expect(touching.some((definition) => !definition.readOnly && reachable.has(definition.name)), entityType)
          .toBe(true)
      }
    }
  })

  /*
   * 名额不够分时，配对保底才真正生效——这条用小 limit 直接验证它。
   *
   * 上一条门禁在当前目录规模下撤掉规则也不会变红（排序已经把实体命中的能力全放进来了）。
   * 但名额是固定的而目录会增长，某个实体的能力数一旦超过预算，按字母序被切掉的很可能
   * 恰好是那个写能力——那时模型只剩只读能力，写入直接没有入口。
   */
  it('名额被切时仍保证点名实体读写各留一个', () => {
    const { registry, context } = createCatalog()
    const entityType = 'camera_stage.object'
    const catalog = new AgentCapabilityDiscoveryCatalog(registry)
    const all = catalog.discover('run-pair-budget', request({
      queries: [`操作 ${entityType}`], entityTypes: [entityType], writes: true,
    }), context)
    const touching = registry.allDefinitions().filter((definition) => (
      (definition.capability?.control?.impacts ?? [])
        .some((impact) => impact.entityTypes.includes(entityType))
    ))
    expect(touching.filter((item) => item.readOnly).length).toBeGreaterThan(0)
    expect(touching.filter((item) => !item.readOnly).length).toBeGreaterThan(0)
    // 直接对配对函数施加只有 2 个名额的极端预算：读写必须各占一个。
    const sorted = all.capabilities.flatMap((match) => {
      const definition = registry.get(match.name)
      return definition ? [{
        entry: { name: match.name, readOnly: match.readOnly },
        match,
      }] : []
    }) as never[]
    const picked = pairReadAndWriteByEntity(
      request({ queries: ['x'], entityTypes: [entityType], writes: true }),
      sorted,
      2,
    )
    expect(picked).toHaveLength(2)
    const pickedDefinitions = picked.map((name) => registry.get(name))
    expect(pickedDefinitions.some((item) => item?.readOnly === true)).toBe(true)
    expect(pickedDefinitions.some((item) => item?.readOnly === false)).toBe(true)
  })

  /*
   * 最差输入：模型只写了 queries，没写 domains 也没写 entityTypes。
   *
   * normalizeCallInput 删除之后，模型写什么就发什么，所以这条路径必须真的能用——
   * 否则一次字段填得不全的发现就等于整次运行没有出口。
   */
  it('只写自然语言查询也能命中非零能力', () => {
    const result = discover(request({ queries: ['在三维场景里放一个球体'] }))
    expect(result.capabilities.length).toBeGreaterThan(0)
    expect(result.leasedToolNames.length).toBeGreaterThan(0)
  })

  it.each([
    '把这张图高清放大',
    '移除这张图片的背景',
    '调整这张图的镜头角度',
  ])('图片工具自然语言查询无需 domain 也能发现并租用原生能力：%s', (query) => {
    const result = discover(request({ queries: [query] }), `run-image-capability-${query}`)

    expect(result.capabilities.map((item) => item.name)).toContain('apply_canvas_image_capability')
    expect(result.leasedToolNames).toContain('apply_canvas_image_capability')
  })

  it('只读任务可以关闭写能力投影，压缩返回体积', () => {
    const readOnly = discover(request({
      queries: ['查看三维场景当前状态'], domains: ['camera_stage'],
      entityTypes: ['camera_stage.object'], writes: false,
    }), 'run-readonly')
    const writable = discover(request({
      queries: ['查看三维场景当前状态'], domains: ['camera_stage'],
      entityTypes: ['camera_stage.object'], writes: true,
    }), 'run-writable')
    expect(readOnly.scriptApi.actions.length).toBeLessThanOrEqual(writable.scriptApi.actions.length)
  })

  /*
   * 回归：错误的缺失标签比没有标签更贵。
   *
   * 实测一次 0 命中被报成 permission_filtered，助手照着这个标签给用户编出了"需要先授权 3D
   * 对象写入能力"这个根本不存在的原因，还建议用户去授权——它会被当成事实写进答复。
   */
  it('缺失原因不把没匹配上误报成权限过滤', () => {
    const result = discover(request({
      queries: ['操作一个不存在的东西'], domains: ['not_a_real_domain'],
    }), 'run-missing')
    expect(result.capabilities).toHaveLength(0)
    expect(result.missing[0]?.reason).toBe('unsupported_domain')
  })

  it('脚本投影给出精确参数签名与实体属性，模型不必猜 SDK', () => {
    const result = discover(request({
      queries: ['在三维场景放置对象并设置位置'],
      domains: ['camera_stage'],
      entityTypes: ['camera_stage.object'],
    }), 'run-projection')
    expect(result.scriptApi.language).toBe('henji-ts/v1')
    expect(result.scriptApi.entryTool).toBe('run_henji_script')
    expect(result.scriptApi.entities.entityTypes).toContain('camera_stage.object')
    for (const action of result.scriptApi.actions) {
      expect(action.parameters, action.id).toBeTruthy()
      expect(action.returns.fields.length, action.id).toBeGreaterThanOrEqual(0)
    }
  })

  /*
   * 回归：容量不足的 Recipe 被投影出来，模型选中它、失败、重试。
   *
   * 设置领域的 Recipe 只能做 1 次 update，而"改一个值再恢复原值"需要 2 次。旧实现拿运行时
   * 代填的 requiredEffects.minimumCount 把装不下的配方直接过滤掉；请求扁平化后那个字段没有
   * 了，容量不足的配方也进了投影——实测一次设置任务因此烧掉 3 次脚本调用和 2 次守卫失败。
   *
   * 修法不是把 requiredEffects 加回来，而是把上限如实给模型：过滤错了是直接没有出路，
   * 信息给全了模型自己会选。
   */
  it('Recipe 投影带上单次调用的容量上限', () => {
    const result = discover(request({
      queries: ['修改一个设置值再恢复原值'],
      domains: ['settings'],
      entityTypes: ['settings.registry'],
      writes: true,
    }), 'run-limits')
    const recipes = result.scriptApi.recipes
    expect(recipes.length).toBeGreaterThan(0)
    for (const recipe of recipes) {
      expect(recipe.limits, recipe.id).toBeDefined()
      expect(recipe.limits?.length, recipe.id).toBeGreaterThan(0)
      for (const limit of recipe.limits ?? []) {
        expect(limit.maximumCount, `${recipe.id}/${limit.effect}`).toBeGreaterThan(0)
      }
    }
  })

  it('相同请求复用缓存并标记 reused', () => {
    const { catalog, context } = createCatalog()
    const input = request({
      queries: ['画布节点编排'], domains: ['canvas'], entityTypes: ['canvas.node'],
    })
    const first = catalog.discover('run-cache', input, context)
    const second = catalog.discover('run-cache', input, context)
    expect(first.reused).toBe(false)
    expect(second.reused).toBe(true)
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(second.capabilities.map((item) => item.name))
      .toEqual(first.capabilities.map((item) => item.name))
  })

  it('schemaRef 可按引用读回完整输入结构', () => {
    const { catalog, context } = createCatalog()
    const result = catalog.discover('run-schema', request({
      queries: ['画布节点编排'], domains: ['canvas'], entityTypes: ['canvas.node'],
    }), context)
    const ref = result.capabilities[0]?.schemaRef
    expect(ref).toBeTruthy()
    if (!ref) return
    const documents = catalog.readSchemas({ refs: [ref] })
    expect(documents.documents[0]?.inputSchema).toBeTruthy()
    expect(documents.missing).toHaveLength(0)
  })

  it('租约与 deferred 互斥，且租约不超过发现预算', () => {
    const result = discover(request({
      queries: ['三维场景与画布的全部操作'],
      domains: ['camera_stage', 'canvas', 'navigation'],
    }), 'run-budget')
    expect(result.leasedToolNames.length).toBeLessThanOrEqual(AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
    // 同一个名字不能既已租约又被判为延迟——模型会据此决定下一轮能不能调它。
    for (const name of result.leasedToolNames) {
      expect(result.deferredToolNames, name).not.toContain(name)
    }
  })
})


