import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { ApplicationCapabilityDiscoveryOutput } from '../../../../../src/core/assistant/capabilityDiscovery'
import {
  buildCapabilityDiscoveryInputForFacets,
  createCapabilityDiscoveryInputFromTaskGraph,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentCapabilityDiscoveryCatalog } from './capability-discovery'
import { createDeterministicTaskGraph, createModelTaskGraph } from './task-facets'

function fullContext(registry: ReturnType<typeof createBuiltinAgentToolRegistry>): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-discovery',
    revision: 5,
    scopeRevisions: { navigation: 2, generation: 1, canvas: 3, toolbox: 4, assets: 1 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    surface: {
      id: 'tool.camera_stage',
      kind: 'tool',
      focusedRef: null,
      selectedRefs: [],
    },
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

describe('AgentCapabilityDiscoveryCatalog', () => {
  /*
   * 回归：切了工作区但没打开三维工程页面。
   *
   * show_target_surface 的 domain 是 navigation，而真正能打开 tool.camera_stage 的
   * open_camera_stage_project domain 是 camera_stage——旧的同域过滤直接把它筛掉，模型只剩
   * 通用 switch_workspace，切到工具工作区就停了。
   */
  it('导航 Facet 能发现真正到达目标 Surface 的能力，并排在通用切换之前', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const context = fullContext(registry)
    const match = createDeterministicTaskGraph(
      '在 3D 镜头参考里边新建一个项目，放一个立方体，打开页面看看',
      context,
    )
    expect(match).not.toBeNull()
    if (!match) return
    const navigationGraph = {
      ...match.graph,
      facets: match.graph.facets.map((facet) => ({
        ...facet,
        status: facet.facetId === 'camera_project' ? 'completed' as const : facet.status,
      })),
    }
    const request = createCapabilityDiscoveryInputFromTaskGraph(navigationGraph)
    const navigationFacet = request?.facets.find((facet) => facet.facetId === 'show_target_surface')
    expect(navigationFacet).toBeDefined()
    if (!navigationFacet) return
    const output = new AgentCapabilityDiscoveryCatalog(registry).discover(
      'run-navigation-surface',
      { ...request!, facets: [navigationFacet] },
      context,
    )
    const names = output.facets[0]?.capabilityNames ?? []
    expect(names).toContain('open_camera_stage_project')
    expect(names.indexOf('open_camera_stage_project')).toBeLessThan(
      names.includes('switch_workspace') ? names.indexOf('switch_workspace') : names.length
    )
  })

  it('用户原话推进到场景前沿时优先租约摆放与更新对象能力', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const context = fullContext(registry)
    const match = createDeterministicTaskGraph(
      '在 3D 镜头参考里边，新建一个叫测试9527的项目，然后放一个紫色立方体和一个红色圆柱体，做 60 帧环绕运镜，两个物体上下漂浮',
      context,
    )
    expect(match).not.toBeNull()
    if (!match) return
    const sceneGraph = {
      ...match.graph,
      facets: match.graph.facets.map((facet) => ({
        ...facet,
        status: ['camera_project', 'show_target_surface'].includes(facet.facetId)
          ? 'completed' as const
          : facet.status,
      })),
    }
    const request = createCapabilityDiscoveryInputFromTaskGraph(sceneGraph)
    // 当前可运行的 Facet 排在最前，下游 Facet 一并带上，整条链路一次租完。
    expect(request?.facets[0]).toEqual(expect.objectContaining({
      facetId: 'camera_scene',
      entityTypes: expect.arrayContaining(['camera_stage.object']),
      requiredEffects: expect.arrayContaining([
        expect.objectContaining({ effect: 'execute', entityTypes: ['camera_stage.object'] }),
        expect.objectContaining({ effect: 'update', entityTypes: ['camera_stage.object'] }),
      ]),
    }))
    expect(request?.facets.map((facet) => facet.facetId)).toEqual(
      expect.arrayContaining(['camera_scene', 'camera_motion', 'camera_verify'])
    )
    if (!request) return
    const discovered = new AgentCapabilityDiscoveryCatalog(registry)
      .discover('run-reported-camera-scene', request, context)
    expect(discovered.facets[0]?.capabilityNames).toEqual(expect.arrayContaining([
      'place_camera_stage_object', 'update_camera_stage_object',
    ]))
  })

  it('一次解析跨领域 Facet、schemaRef、缺失项和建议激活集合', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const catalog = new AgentCapabilityDiscoveryCatalog(registry)
    const context = fullContext(registry)
    const result = catalog.discover('run-batch', {
      discoveryVersion: 'application-capability-discovery/v2',
      facets: [{
        facetId: 'camera_scene',
        queries: ['添加三维物体并设置位置'],
        domains: ['camera_stage'],
        entityTypes: ['camera_stage.object'],
        capabilityKinds: ['observe', 'mutate', 'execute'],
        targetSurfaceIds: ['tool.camera_stage'],
        requiredEffects: [
          { effect: 'execute', entityTypes: ['camera_stage.object'], propertyIds: [] },
          { effect: 'update', entityTypes: ['camera_stage.object'], propertyIds: [] },
        ],
      }, {
        facetId: 'show_surface',
        queries: ['打开三维工具'],
        domains: ['navigation'],
        entityTypes: [],
        capabilityKinds: ['navigate'],
        targetSurfaceIds: ['tool.camera_stage'],
      }, {
        facetId: 'unsupported',
        queries: ['不存在的领域'],
        domains: ['unknown_domain'],
        entityTypes: [],
        capabilityKinds: ['execute'],
        targetSurfaceIds: [],
      }],
      cursor: 0,
      limit: 20,
    }, context)

    expect(result.facets.find((facet) => facet.facetId === 'camera_scene')?.capabilityNames.length)
      .toBeGreaterThan(0)
    expect(result.facets.find((facet) => facet.facetId === 'camera_scene')?.capabilityNames)
      .toEqual(expect.arrayContaining(['place_camera_stage_object', 'update_camera_stage_object']))
    expect(result.facets.find((facet) => facet.facetId === 'show_surface')?.capabilityNames)
      .toContain('open_application_surface')
    expect(result.missing).toContainEqual(expect.objectContaining({
      facetId: 'unsupported', reason: 'unsupported_domain',
    }))
    expect(result.capabilities.every((capability) => capability.schemaRef.kind === 'operation')).toBe(true)
    expect(result.leasedToolNames).toContain('open_application_surface')
    expect(result.leasedToolNames).not.toContain('read_application_schemas')
    expect(result.leasedToolNames.length).toBeLessThanOrEqual(15)
    expect(result.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  /*
   * 回归：用户说「你这不对吧」，整次运行卡死在 0 项能力。
   *
   * 路由把主意图判成 diagnose，但读了历史后正确地把 camera_stage 放进了 toolDomains。任务图
   * 只有一个 diagnose Facet，于是发现请求带的是 domains=['diagnostics','camera_stage'] 加
   * entityTypes=['diagnostics.event']——entityTypes 当时是跨域的硬 AND 过滤，camera_stage 的能力
   * 一个都匹配不上，返回 0 项能力、0 个租约。更糟的是缺失原因被报成 permission_filtered，
   * 助手照着这个标签给用户编出了"需要先授权 3D 对象写入能力"这个根本不存在的原因。
   */
  it('域被放宽后，entityTypes 不再把新域的能力全筛掉', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    // 走生产链路：intent=diagnose 的任务图 → 发现请求 → 把 camera_stage 作为额外域并入。
    // 快照刻意停在生成工作区——实测时应用重启后就在这里，而上一轮的活是在三维编辑器里干的。
    const base = fullContext(registry)
    const context: HostContextSnapshot = {
      ...base,
      surface: {
        id: 'workspace.generation',
        kind: 'workspace',
        focusedRef: null,
        selectedRefs: [],
      },
    }
    const taskGraph = createModelTaskGraph({
      goal: '你这不对吧',
      rawFacets: undefined,
      primaryIntent: 'diagnose',
      candidateDomains: ['diagnostics', 'camera_stage'],
      snapshot: context,
    })
    expect(taskGraph.facets.map((facet) => facet.facetId)).toEqual(['diagnose'])
    const request = buildCapabilityDiscoveryInputForFacets(taskGraph.facets, {}, ['camera_stage'])
    expect(request?.facets[0]).toEqual(expect.objectContaining({
      domains: expect.arrayContaining(['diagnostics', 'camera_stage']),
      entityTypes: ['diagnostics.event'],
      targetSurfaceIds: ['workspace.generation'],
    }))
    if (!request) return
    const result = new AgentCapabilityDiscoveryCatalog(registry)
      .discover("run-not-right", request, context)

    // 关键断言：camera_stage 的能力必须真的进得来，而不是被 diagnostics.event 这个
    // 跨域 entityTypes 过滤全部筛掉。
    expect(result.leasedToolNames.some((name) => name.includes('camera_stage'))).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('缺失原因不把"没匹配上"误报成权限过滤', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    // 域已知、宿主也没有屏蔽任何能力，只是这个 kind 组合无人满足——这不是权限问题。
    const result = new AgentCapabilityDiscoveryCatalog(registry).discover('run-reason', {
      discoveryVersion: 'application-capability-discovery/v2',
      facets: [{
        facetId: 'impossible',
        queries: [],
        domains: ['camera_stage'],
        entityTypes: [],
        capabilityKinds: [],
        targetSurfaceIds: ['workspace.assets'],
      }],
      cursor: 0,
      limit: 20,
    }, fullContext(registry))

    const missing = result.missing.find((item) => item.facetId === 'impossible')
    if (missing) expect(missing.reason).toBe('no_matching_capability')
  })

  it('相同发现指纹复用缓存，schemaRef 可稳定读取完整输入结构', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const catalog = new AgentCapabilityDiscoveryCatalog(registry)
    const context = fullContext(registry)
    const input = {
      discoveryVersion: 'application-capability-discovery/v2' as const,
      facets: [{
        facetId: 'canvas',
        queries: ['读取画布项目'],
        domains: ['canvas'],
        entityTypes: ['canvas.project'],
        capabilityKinds: ['query' as const],
        targetSurfaceIds: ['workspace.canvas'],
      }],
      cursor: 0,
      limit: 2,
    }
    const first = catalog.discover('run-cache', input, context)
    const second = catalog.discover('run-cache', input, context)
    expect(second).toMatchObject({ fingerprint: first.fingerprint, reused: true })
    expect(first.page.returnedItems).toBeLessThanOrEqual(2)

    const ref = first.facets[0]?.schemaRefs[0]
    expect(ref).toBeDefined()
    const schemas = catalog.readSchemas({ refs: ref ? [ref] : [] })
    expect(schemas.documents).toHaveLength(1)
    expect(schemas.documents[0]?.inputSchema).toBeTypeOf('object')
    expect(schemas.missing).toEqual([])
  })

  it('后端原生能力执行与输出 schema 使用同一目录实现', async () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tool = registry.get('discover_application_capabilities')
    expect(tool?.capability?.id).toBe('discover_application_capabilities')
    const output = await tool?.execute({
      facets: [{
        facetId: 'assets',
        queries: ['读取素材'],
        domains: ['assets'],
        entityTypes: ['asset'],
        capabilityKinds: ['query'],
        targetSurfaceIds: ['workspace.assets'],
      }],
      cursor: 0,
      limit: 20,
      discoveryVersion: 'application-capability-discovery/v2',
    }, {
      runId: 'run-tool', threadId: 'thread-tool', toolCallId: 'call-tool',
      signal: new AbortController().signal,
      hostContext: fullContext(registry),
    }) as ApplicationCapabilityDiscoveryOutput
    expect(output.catalogVersion).toBe('application-capabilities/v2')
    expect(output.facets[0]?.capabilityNames.length).toBeGreaterThan(0)
  })

  it('能力种类按正式 impacts 匹配，不再用目录名猜 navigate/execute/mutate', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const result = new AgentCapabilityDiscoveryCatalog(registry).discover('run-impact-kind', {
      discoveryVersion: 'application-capability-discovery/v2',
      facets: [{
        facetId: 'open_canvas', queries: ['打开画布项目'], domains: ['canvas'],
        entityTypes: ['canvas.project'], capabilityKinds: ['navigate'], targetSurfaceIds: ['workspace.canvas'],
      }, {
        facetId: 'edit_image', queries: ['创建图片编辑预览'], domains: ['image_edit'],
        entityTypes: ['image_edit.preview'], capabilityKinds: ['execute'], targetSurfaceIds: ['tool.image_edit'],
      }, {
        facetId: 'change_settings', queries: ['修改设置'], domains: ['settings'],
        entityTypes: ['application.setting'], capabilityKinds: ['mutate'], targetSurfaceIds: [],
      }],
      cursor: 0,
      limit: 20,
    }, fullContext(registry))

    expect(result.facets.find((facet) => facet.facetId === 'open_canvas')?.capabilityNames)
      .toContain('open_canvas_project')
    expect(result.facets.find((facet) => facet.facetId === 'edit_image')?.capabilityNames)
      .toContain('create_image_edit_preview')
    expect(result.facets.find((facet) => facet.facetId === 'change_settings')?.capabilityNames)
      .toContain('apply_application_settings_change')
  })
})
