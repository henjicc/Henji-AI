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
  it('确定性任务图无环，且至少有一个可立即运行的 Facet', () => {
    const match = createDeterministicTaskGraph(CAMERA_GOAL, snapshot())
    expect(match).not.toBeNull()
    if (!match) return
    assertAcyclic(match.graph)
    // 没有可运行项 = 任务图从第一步就推不动，结算会把它误判成完成
    expect(match.graph.facets.some((facet) => facet.dependsOn.length === 0)).toBe(true)
    expect(match.graph.facets.find((facet) => facet.facetId === 'camera_scene')
      ?.requiredEffects[0]).toMatchObject({
        effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 2,
      })
    expect(match.graph.actionGroups.find((group) => group.facetId === 'camera_scene'))
      .toMatchObject({ mode: 'dependent', dependsOn: expect.arrayContaining(['show_target_surface_actions']) })
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
      expect.objectContaining({ effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 2 }),
      expect.objectContaining({ effect: 'update', entityTypes: ['camera_stage.object'], minimumCount: 2 }),
    ]))
    expect(scene?.targetEntityTypes).toContain('camera_stage.object')
    expect(match.graph.facets.find((facet) => facet.facetId === 'camera_motion')?.requiredEffects[0])
      .toMatchObject({ effect: 'execute', entityTypes: ['camera_stage.trajectory'] })
    expect(match.graph.facets.find((facet) => facet.facetId === 'camera_object_animation')?.requiredEffects[0])
      .toMatchObject({ effect: 'create', entityTypes: ['camera_stage.keyframe'] })
    expect(verify?.dependsOn).toEqual(expect.arrayContaining([
      'camera_scene', 'camera_motion', 'camera_object_animation',
    ]))
    expect(capabilityMatches(project?.requiredEffects[0] as AgentTaskRequiredEffect, 'create_camera_stage_project')).toBe(true)
    expect(capabilityMatches(scene?.requiredEffects[0] as AgentTaskRequiredEffect, 'place_camera_stage_object')).toBe(true)
    expect(capabilityMatches(scene?.requiredEffects[1] as AgentTaskRequiredEffect, 'update_camera_stage_object')).toBe(true)
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

  it('明确要求创建两个画布节点时生成 minimumCount=2 的 create Effect', () => {
    const match = createDeterministicTaskGraph('在画布创建两个节点并分别设置参数', snapshot())
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_structure')
      ?.requiredEffects[0]).toMatchObject({
        effect: 'create', entityTypes: ['canvas.node'], minimumCount: 2, verificationRequired: true,
      })
  })

  it('完整画布模型图可覆盖节点、连线和汇合验证基线', () => {
    const goal = '在画布添加两个节点并连接'
    const baseline = createDeterministicTaskGraph(goal, snapshot())
    const candidate = tryCreateModelTaskGraph({
      goal,
      rawFacets: [{
        facetId: 'canvas_write', domain: 'canvas', goal: '新增节点并连接',
        capabilityKinds: ['mutate'], completionConditions: ['节点与连线都有结构化证据。'],
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
      '在 3D 镜头参考里新建一个项目，放一个立方体',
      snapshot(),
    )
    const navigation = match?.graph.facets.find((facet) => facet.facetId === 'show_target_surface')
    expect(navigation?.targetSurfaceId).toBe('tool.camera_stage')
    expect(navigation?.requiredEffects[0]).toMatchObject({
      effect: 'navigate',
      targetRefs: [{ kind: 'application.surface', id: 'tool.camera_stage' }],
    })
  })
})
