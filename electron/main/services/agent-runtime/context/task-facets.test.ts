import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentTaskGraph, AgentTaskRequiredEffect } from '../../../../../src/core/assistant/taskGraph'
import { CAMERA_STAGE_PROJECT_APPLICATION_CAPABILITIES } from '../../../../../src/core/assistant/capabilities/cameraStageProjectApplicationCapabilities'
import { CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES } from '../../../../../src/core/assistant/capabilities/cameraStageSceneApplicationCapabilities'
import { potentialEffectMatches } from '../runner/facet-effect-ledger'
import {
  createDeterministicTaskGraph,
  createModelTaskGraph,
  taskGraphCoversBaseline,
  tryCreateModelTaskGraph,
} from './task-facets'

/**
 * 任务图的依赖必须无环。
 *
 * schema 只拦自环和悬空边，**多节点环是放行的**。一旦成环，环上的 Facet 永远没有一个"依赖
 * 全部完成"的可运行项，任务图无法自行推进；而结算侧看到的是"没有受阻、没有等待用户"，
 * 于是把整张图判成 completed 并下发"停止调用工具"——实测就是这样丢掉了圆柱体、环绕运镜
 * 和上下漂浮动画，助手却汇报"已完成"。
 */

function snapshot(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-facets',
    revision: 1,
    scopeRevisions: { navigation: 1, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: ['get_host_context'],
    capturedAt: new Date().toISOString(),
  }
}

function assertAcyclic(built: AgentTaskGraph): void {
  const byId = new Map(built.facets.map((facet) => [facet.facetId, facet]))
  const state = new Map<string, 'visiting' | 'done'>()
  const walk = (facetId: string, trail: string[]): void => {
    if (state.get(facetId) === 'done') return
    if (state.get(facetId) === 'visiting') {
      throw new Error(`任务图存在依赖环：${[...trail, facetId].join(' -> ')}`)
    }
    state.set(facetId, 'visiting')
    for (const dependency of byId.get(facetId)?.dependsOn ?? []) walk(dependency, [...trail, facetId])
    state.set(facetId, 'done')
  }
  for (const facet of built.facets) walk(facet.facetId, [])
}

const CAMERA_GOAL = '在 3D 镜头参考里新建工程，放一个立方体和一个圆柱体，做 60 帧环绕运镜，两个物体上下漂浮'
const REPORTED_CAMERA_GOAL = '在 3D 镜头参考里边，新建一个叫测试7788的项目，然后在新的场景里边放一个紫色立方体，然后放一个红色圆柱体，然后做一个大概 60 帧的动画吧，然后一个是摄像机围绕着它旋转，然后，两个物体是漂浮着的，上下移动的'

function capabilityMatches(effect: AgentTaskRequiredEffect, capabilityId: string): boolean {
  const capability = [
    ...CAMERA_STAGE_PROJECT_APPLICATION_CAPABILITIES,
    ...CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES,
  ].find((candidate) => candidate.id === capabilityId)
  return capability?.control?.impacts.some((impact) => potentialEffectMatches(effect, {
    effect: impact.effect,
    entityTypes: impact.entityTypes,
    propertyIds: impact.propertyIds,
    targetRefs: [],
    count: 1,
    verified: false,
    evidence: [],
  })) ?? false
}

describe('任务图依赖不得成环', () => {
  it('“给场景加个球并上下浮动”同时声明对象创建与状态关键帧动画，不再先撞计划守卫', () => {
    const match = createDeterministicTaskGraph('给场景加个球，让它上下浮动，然后播放给我看', snapshot())
    expect(match?.graph.facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'camera_scene', 'camera_object_animation', 'camera_playback', 'camera_verify',
    ]))
    expect(match?.graph.facets.find((facet) => facet.facetId === 'camera_scene')?.requiredEffects[0])
      .toMatchObject({ effect: 'execute', entityTypes: ['camera_stage.object'] })
    expect(match?.graph.facets.find((facet) => facet.facetId === 'camera_object_animation')?.requiredEffects[0])
      .toMatchObject({ effect: 'update', entityTypes: ['camera_stage.object'] })
    expect(match?.graph.facets.find((facet) => facet.facetId === 'camera_playback')?.requiredEffects[0])
      .toMatchObject({
        effect: 'update', entityTypes: ['camera_stage.playback'],
        propertyIds: ['camera_stage.playback.playing'],
      })
    expect(match?.graph.facets.some((facet) => facet.facetId === 'camera_motion')).toBe(false)
  })

  it('“3D 运镜工程”只是工程类型名，不凭空生成摄像机运镜任务', () => {
    const match = createDeterministicTaskGraph(
      '新建一个 3D 运镜工程，给场景加一个白色球体，让它上下浮动并循环播放',
      snapshot(),
    )
    expect(match?.graph.facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'camera_project', 'camera_scene', 'camera_object_animation', 'camera_playback', 'camera_verify',
    ]))
    expect(match?.graph.facets.some((facet) => facet.facetId === 'camera_motion')).toBe(false)
  })

  it('物体环形轨迹、旋转和缩放动画不被扩张成摄像机运镜', () => {
    const match = createDeterministicTaskGraph(
      '新建三维工程，放一个球，让球沿环形轨迹运动，同时旋转和缩放，最后循环播放',
      snapshot(),
    )
    expect(match?.graph.facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'camera_scene', 'camera_object_animation', 'camera_playback', 'camera_verify',
    ]))
    expect(match?.graph.facets.some((facet) => facet.facetId === 'camera_motion')).toBe(false)
  })

  it('明确绑定摄像机的环绕仍产生运镜 Facet', () => {
    const match = createDeterministicTaskGraph(
      '新建三维工程，放一个球，让摄像机环绕球体旋转一圈',
      snapshot(),
    )
    expect(match?.graph.facets.some((facet) => facet.facetId === 'camera_motion')).toBe(true)
  })

  it('确定性任务图无环，且至少有一个可立即运行的 Facet', () => {
    const match = createDeterministicTaskGraph(CAMERA_GOAL, snapshot())
    expect(match).not.toBeNull()
    if (!match) return
    assertAcyclic(match.graph)
    // 没有可运行项 = 任务图从第一步就推不动，结算会把它误判成完成
    expect(match.graph.facets.some((facet) => facet.dependsOn.length === 0)).toBe(true)
    expect(match.graph.facets.find((facet) => facet.facetId === 'camera_scene')
      ?.requiredEffects[0]).toMatchObject({
        effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1,
      })
    expect(match.graph.actionGroups.find((group) => group.facetId === 'camera_scene'))
      .toMatchObject({ mode: 'dependent', dependsOn: expect.arrayContaining(['camera_project_actions']) })
    expect(match.graph.facets.some((facet) => facet.facetId === 'show_target_surface')).toBe(false)
  })

  it('用户原话生成可执行的工程、布置、颜色、运镜、动画与汇合验证 Effect', () => {
    const match = createDeterministicTaskGraph(REPORTED_CAMERA_GOAL, snapshot())
    expect(match).not.toBeNull()
    if (!match) return
    const project = match.graph.facets.find((facet) => facet.facetId === 'camera_project')
    const scene = match.graph.facets.find((facet) => facet.facetId === 'camera_scene')
    const verify = match.graph.facets.find((facet) => facet.facetId === 'camera_verify')
    expect(project?.requiredEffects[0]).toMatchObject({
      effect: 'create', entityTypes: ['camera_stage.project'], minimumCount: 1,
      verificationRequired: true,
    })
    expect(scene?.requiredEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1 }),
      expect.objectContaining({ effect: 'update', entityTypes: ['camera_stage.object'], minimumCount: 1 }),
    ]))
    expect(scene?.targetEntityTypes).toContain('camera_stage.object')
    expect(match.graph.facets.find((facet) => facet.facetId === 'camera_motion')?.requiredEffects[0])
      .toMatchObject({ effect: 'execute', entityTypes: ['camera_stage.trajectory'] })
    expect(match.graph.facets.find((facet) => facet.facetId === 'camera_object_animation')?.requiredEffects[0])
      .toMatchObject({ effect: 'update', entityTypes: ['camera_stage.object'] })
    expect(verify?.dependsOn).toEqual(expect.arrayContaining([
      'camera_scene', 'camera_motion', 'camera_object_animation',
    ]))
    expect(capabilityMatches(project?.requiredEffects[0] as AgentTaskRequiredEffect, 'create_camera_stage_project')).toBe(true)
    expect(capabilityMatches(scene?.requiredEffects[0] as AgentTaskRequiredEffect, 'place_camera_stage_object')).toBe(true)
    expect(capabilityMatches(scene?.requiredEffects[1] as AgentTaskRequiredEffect, 'update_camera_stage_object')).toBe(true)
  })

  it('“新建 3D 场景”识别为新工程，点名颜色时同时要求外观写入', () => {
    const match = createDeterministicTaskGraph(
      '新建一个名为复测的 3D 场景，加入一个白色球体；在 0、1、2 秒让球体上下浮动；最后验证球体位置和三枚状态关键帧。',
      snapshot(),
    )
    const project = match?.graph.facets.find((facet) => facet.facetId === 'camera_project')
    const scene = match?.graph.facets.find((facet) => facet.facetId === 'camera_scene')

    expect(project?.requiredEffects[0]).toMatchObject({
      effect: 'create', entityTypes: ['camera_stage.project'], minimumCount: 1,
    })
    expect(scene?.requiredEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1 }),
      expect.objectContaining({ effect: 'update', entityTypes: ['camera_stage.object'], minimumCount: 1 }),
    ]))
  })

  it('复用已有工程保持 observe，Router 模型漏掉显式创建时拒绝该图', () => {
    const reused = createDeterministicTaskGraph('打开并复用已有 3D 工程，然后放置一个立方体', snapshot())
    expect(reused?.graph.facets.find((facet) => facet.facetId === 'camera_project')?.requiredEffects[0])
      .toMatchObject({ effect: 'observe' })

    expect(tryCreateModelTaskGraph({
      goal: REPORTED_CAMERA_GOAL,
      rawFacets: [{
        facetId: 'camera_project', domain: 'camera_stage', goal: '读取工程',
        targetEntityTypes: ['camera_stage.project'], observationKinds: ['entity_state'],
        capabilityKinds: ['observe'], targetSurfaceId: 'tool.camera_stage', dependsOn: [],
        parallelizable: false, completionConditions: ['读取完成'],
        requiredEffects: [{
          effectId: 'camera_project_effect', effect: 'observe', entityTypes: ['camera_stage.project'],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
          actionGroupId: 'camera_project_actions',
        }], uncertainties: [], confidence: 1,
      }],
      primaryIntent: 'camera_stage',
      candidateDomains: ['camera_stage', 'navigation'],
      snapshot: snapshot(),
    })).toBeNull()
  })

  it('在已有项目中创建对象不会被误判为新建工程', () => {
    const reused = createDeterministicTaskGraph(
      '在已有 3D 项目里创建一个立方体并让它旋转',
      snapshot(),
    )
    expect(reused?.graph.facets.find((facet) => facet.facetId === 'camera_project')?.requiredEffects[0])
      .toMatchObject({ effect: 'observe' })
  })

  it('画布建节点任务保留节点类型目录依赖，且 create 阈值不随原话数量浮动', () => {
    const match = createDeterministicTaskGraph('在画布创建两个节点并分别设置参数', snapshot())
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_node_catalog'))
      .toMatchObject({
        targetEntityTypes: ['canvas.node_type'],
        capabilityKinds: ['observe', 'query'],
        requiredEffects: [{ effect: 'observe', minimumCount: 2 }],
      })
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_structure')
      ?.requiredEffects[0]).toMatchObject({
        effect: 'create', entityTypes: ['canvas.node'], minimumCount: 1, verificationRequired: true,
      })
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_structure')?.dependsOn)
      .toContain('canvas_node_catalog')
  })

  it('生成图片后放入画布的确定性任务图同时保留生成、画布写入和最终验证', () => {
    const match = createDeterministicTaskGraph(
      '生成一张机械圆环图片，新建一个画布项目，把生成结果加入画布，再创建一个文字说明节点',
      snapshot(),
    )
    expect(match?.intents).toEqual(expect.arrayContaining(['generate', 'canvas']))
    expect(match?.graph.facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'generation_result', 'canvas_project', 'canvas_node_catalog', 'canvas_generation_result', 'canvas_verify',
    ]))
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_generation_result'))
      .toMatchObject({
        dependsOn: expect.arrayContaining(['generation_result']),
        requiredEffects: [expect.objectContaining({
          effect: 'create', entityTypes: ['canvas.node'], minimumCount: 1,
        })],
      })
  })

  it('跨生成、画布和状态动画的复杂目标只登记用户明确要求的 Effect', () => {
    const match = createDeterministicTaskGraph(
      '真实生成一张暖色山谷图片；新建画布并把真实生成结果放入，确认一个媒体节点；'
      + '新建三维工程，放入一个名为夕阳球体的球体，在 0、1、2、3、4 秒改变球体位置和缩放，'
      + '同时逐步改变摄像机位置、旋转和 fov，开启循环播放；最后验证五枚状态关键帧。',
      snapshot(),
    )
    const canvas = match?.graph.facets.find((facet) => facet.facetId === 'canvas_generation_result')
    const scene = match?.graph.facets.find((facet) => facet.facetId === 'camera_scene')
    const animation = match?.graph.facets.find((facet) => facet.facetId === 'camera_object_animation')

    expect(canvas?.requiredEffects[0]).toMatchObject({
      effect: 'create', entityTypes: ['canvas.node'], minimumCount: 1,
    })
    expect(scene?.requiredEffects[0]).toMatchObject({
      effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1,
    })
    expect(animation?.requiredEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'update', entityTypes: ['camera_stage.object'] }),
      expect.objectContaining({ effect: 'update', entityTypes: ['camera_stage.camera'] }),
    ]))
    expect(match?.graph.facets.some((facet) => facet.facetId === 'camera_motion')).toBe(false)
    expect(match?.graph.facets.some((facet) => facet.facetId === 'show_target_surface')).toBe(false)
  })

  it('生成后把这张图放成唯一媒体节点时不制造 Recipe 已封装的节点目录 Facet', () => {
    const match = createDeterministicTaskGraph(
      '生成一张暖色极简几何山谷图片，新建画布，等待真实生成成功后把这张图放成唯一的媒体节点；不要切换或打开任何界面。',
      snapshot(),
    )
    const facetIds = match?.graph.facets.map((facet) => facet.facetId) ?? []
    expect(facetIds).toEqual(expect.arrayContaining([
      'generation_result', 'canvas_project', 'canvas_structure', 'canvas_verify',
    ]))
    expect(facetIds).not.toContain('canvas_node_catalog')
    expect(facetIds).not.toContain('show_target_surface')
  })

  it('海报类生成不依赖“图片”字样，且生成结果先于画布落地', () => {
    const match = createDeterministicTaskGraph(
      '生成一张赛博朋克风格海报，如果没有画布项目就创建，把生成结果放进画布并定位到指定位置',
      snapshot(),
    )
    expect(match?.intents).toEqual(expect.arrayContaining(['generate', 'canvas']))
    expect(match?.graph.facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'generation_result', 'canvas_generation_result', 'canvas_verify',
    ]))
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_generation_result')?.dependsOn)
      .toContain('generation_result')
  })

  it('已有 generation.result 形成专用桥梁 Facet，不被纯画布流程配方截获', () => {
    const match = createDeterministicTaskGraph(
      '不要提交新的生成任务，使用 generation.result:task-1 新建画布项目，把生成结果放入画布并读取验证节点位置',
      snapshot(),
    )
    expect(match?.graph.facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'canvas_project', 'canvas_generation_result', 'canvas_verify',
    ]))
    expect(match?.graph.facets.some((facet) => facet.facetId === 'generation_result')).toBe(false)
    expect(match?.graph.facets.some((facet) => facet.facetId === 'canvas_node_catalog')).toBe(false)
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_verify')?.dependsOn)
      .toEqual(['canvas_generation_result'])
  })

  it('“已有生成结果作为图片节点”不会被名词中的生成误判为新生成任务', () => {
    const match = createDeterministicTaskGraph(
      '新建一个画布，把已有生成结果 task-1 作为图片节点放到坐标 x=320、y=180，并从正式状态源验证。不要重新生成图片。',
      snapshot(),
    )
    const facetIds = match?.graph.facets.map((facet) => facet.facetId) ?? []
    expect(facetIds).toEqual(expect.arrayContaining([
      'canvas_project', 'canvas_generation_result', 'canvas_verify',
    ]))
    expect(facetIds).not.toContain('generation_result')
    expect(match?.intents).not.toContain('generate')
  })

  it('“不要创建新项目”不会被名词后的创建字样误判为工程创建', () => {
    const match = createDeterministicTaskGraph(
      '不要创建新项目，在现有画布中创建一个文字节点',
      snapshot(),
    )
    expect(match?.graph.facets.some((facet) => facet.facetId === 'canvas_project')).toBe(false)
    expect(match?.graph.facets.some((facet) => facet.facetId === 'canvas_structure')).toBe(true)
  })

  it('素材复合任务分别声明创建素材库和更新素材，否定删除不会生成 delete Effect', () => {
    const match = createDeterministicTaskGraph(
      '找到最新生成图片，重命名并加标签，新建一个素材库后把图片加入其中，不要删除任何素材或工程',
      snapshot(),
    )
    expect(match?.graph.facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'asset_lookup', 'asset_library_create', 'asset_update', 'asset_verify',
    ]))
    expect(match?.graph.facets.some((facet) => facet.facetId === 'asset_delete')).toBe(false)
    expect(match?.graph.facets.flatMap((facet) => facet.requiredEffects)
      .some((effect) => effect.effect === 'delete')).toBe(false)
    expect(match?.graph.facets.find((facet) => facet.facetId === 'asset_update')?.dependsOn)
      .toEqual(expect.arrayContaining(['asset_lookup', 'asset_library_create']))
  })

  it('素材集合生命周期把改名和删除归到 asset.library，而不是虚构 asset 写入', () => {
    const match = createDeterministicTaskGraph(
      '在素材库中新建一个名为测试集合的素材集合，将它重命名为已改名，然后删除这个集合，并读取素材库确认它已经不存在。不要生成任何图片或视频。',
      snapshot(),
    )
    const facets = match?.graph.facets ?? []
    expect(facets.map((facet) => facet.facetId)).toEqual(expect.arrayContaining([
      'asset_lookup', 'asset_library_create', 'asset_library_update',
      'asset_library_delete', 'asset_verify',
    ]))
    expect(facets.some((facet) => facet.facetId === 'asset_update')).toBe(false)
    expect(facets.some((facet) => facet.facetId === 'asset_delete')).toBe(false)
    expect(facets.find((facet) => facet.facetId === 'asset_library_create')
      ?.requiredEffects[0].verificationRequired).toBe(false)
    expect(facets.find((facet) => facet.facetId === 'asset_library_update')
      ?.requiredEffects[0]).toMatchObject({
        effect: 'update', entityTypes: ['asset.library'],
        propertyIds: ['asset.library.name'], verificationRequired: false,
      })
    expect(facets.find((facet) => facet.facetId === 'asset_library_delete')
      ?.requiredEffects[0]).toMatchObject({
        effect: 'delete', entityTypes: ['asset.library'], verificationRequired: true,
      })
  })

  it('完整画布模型图可覆盖节点、连线和汇合验证基线', () => {
    const goal = '在画布添加两个节点并连接'
    const baseline = createDeterministicTaskGraph(goal, snapshot())
    const candidate = tryCreateModelTaskGraph({
      goal,
      rawFacets: [{
        facetId: 'canvas_node_catalog', domain: 'canvas', goal: '搜索节点类型并读取结构',
        capabilityKinds: ['observe', 'query'], completionConditions: ['节点类型与端口结构已读取。'],
        requiredEffects: [{
          effectId: 'canvas_node_catalog_effect', effect: 'observe', entityTypes: ['canvas.node_type'],
          propertyIds: [], minimumCount: 2, targetRefs: [], verificationRequired: false,
          actionGroupId: 'canvas_node_catalog_group',
        }],
      }, {
        facetId: 'canvas_write', domain: 'canvas', goal: '新增节点并连接',
        capabilityKinds: ['mutate'], dependsOn: ['canvas_node_catalog'],
        completionConditions: ['节点与连线都有结构化证据。'],
        requiredEffects: [{
          effectId: 'canvas_node_effect', effect: 'create', entityTypes: ['canvas.node'],
          propertyIds: [], minimumCount: 2, targetRefs: [], verificationRequired: true,
          actionGroupId: 'canvas_node_group',
        }, {
          effectId: 'canvas_edge_effect', effect: 'create', entityTypes: ['canvas.edge'],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
          actionGroupId: 'canvas_edge_group',
        }],
      }, {
        facetId: 'canvas_verify', domain: 'canvas', goal: '读取画布验证节点与连线',
        capabilityKinds: ['observe', 'query'], dependsOn: ['canvas_write'],
        completionConditions: ['结构化读取确认目标节点与连线存在。'],
        requiredEffects: [{
          effectId: 'canvas_verify_effect', effect: 'observe',
          entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
          actionGroupId: 'canvas_verify_group',
        }],
      }],
      primaryIntent: 'canvas', candidateDomains: ['canvas', 'catalog'], snapshot: snapshot(),
    })
    expect(candidate).not.toBeNull()
    expect(baseline).not.toBeNull()
    expect(taskGraphCoversBaseline(candidate as AgentTaskGraph, baseline?.graph as AgentTaskGraph)).toBe(true)
  })

  it('模型给出成环的 Facet 时，构建阶段必须把环打断而不是原样接受', () => {
    const built = createModelTaskGraph({
      goal: CAMERA_GOAL,
      rawFacets: [
        {
          facetId: 'place_cube', domain: 'camera_stage', goal: '放置立方体',
          capabilityKinds: ['mutate'], dependsOn: ['orbit_camera'],
          completionConditions: ['返回稳定 revision'],
          requiredEffects: [{
            effectId: 'place_cube_effect', effect: 'create', entityTypes: ['camera_stage.object'],
            propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
            actionGroupId: 'place_cube_actions',
          }],
        },
        {
          facetId: 'orbit_camera', domain: 'camera_stage', goal: '环绕运镜',
          capabilityKinds: ['mutate'], dependsOn: ['place_cube'],
          completionConditions: ['返回稳定 revision'],
          requiredEffects: [{
            effectId: 'orbit_camera_effect', effect: 'execute', entityTypes: ['camera_stage.trajectory'],
            propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
            actionGroupId: 'orbit_camera_actions',
          }],
        },
      ],
      primaryIntent: 'camera_stage',
      candidateDomains: ['camera_stage', 'navigation', 'toolbox'],
      snapshot: snapshot(),
    })
    assertAcyclic(built)
    expect(built.facets.some((facet) => facet.dependsOn.length === 0)).toBe(true)
  })

  /*
   * 回归：切了工作区就把"打开三维编辑器"标成完成。
   *
   * navigate 的 effectMatches 只比 effect 名，不带目标 Surface 的话任意导航都算数——实测里
   * switch_workspace 切到工具工作区就让 show_target_surface 进入终态，
   * open_camera_stage_project 从此被跳过，用户看到工作区变了但工程页面没开。
   */
  it('导航 Facet 的完成条件绑定到目标 Surface 稳定引用', () => {
    const match = createDeterministicTaskGraph(
      '打开 3D 镜头参考，新建一个项目并放一个立方体',
      snapshot(),
    )
    const navigation = match?.graph.facets.find((facet) => facet.facetId === 'show_target_surface')
    expect(navigation?.targetSurfaceId).toBe('tool.camera_stage')
    expect(navigation?.requiredEffects[0]).toMatchObject({
      effect: 'navigate',
      targetRefs: [{ kind: 'application.surface', id: 'tool.camera_stage' }],
    })
  })

  it('“不要切换或打开界面”不会反向创建导航 Facet', () => {
    const match = createDeterministicTaskGraph(
      '新建一个 3D 工程，放一个球并做上下浮动动画，不要切换或打开界面。',
      snapshot(),
    )
    expect(match?.graph.facets.some((facet) => facet.capabilityKinds.includes('navigate'))).toBe(false)
    expect(match?.domains).not.toContain('navigation')
    expect(match?.graph.forbiddenEffects).toContain('navigate')
  })
})

describe('Camera Stage 确定性任务语义', () => {
  it('工程名包含动画且后文有三枚关键帧时，仍只创建一个工程和一个球', () => {
    const result = createDeterministicTaskGraph(
      '新建一个名为真实助手动画的三维工程，给场景加一个球。依次写入三枚状态关键帧后播放。',
      snapshot(),
    )
    const projectEffect = result?.graph.facets
      .find((facet) => facet.facetId === 'camera_project')?.requiredEffects[0]
    const sceneEffect = result?.graph.facets
      .find((facet) => facet.facetId === 'camera_scene')?.requiredEffects[0]
    expect(projectEffect).toMatchObject({ effect: 'create', entityTypes: ['camera_stage.project'], minimumCount: 1 })
    expect(sceneEffect).toMatchObject({ effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1 })
  })
})
