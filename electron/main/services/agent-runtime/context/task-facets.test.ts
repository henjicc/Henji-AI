import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentTaskGraph } from '../../../../../src/core/assistant/taskGraph'
import { createDeterministicTaskGraph, createModelTaskGraph } from './task-facets'

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

describe('任务图依赖不得成环', () => {
  it('确定性任务图无环，且至少有一个可立即运行的 Facet', () => {
    const match = createDeterministicTaskGraph(CAMERA_GOAL, snapshot())
    expect(match).not.toBeNull()
    if (!match) return
    assertAcyclic(match.graph)
    // 没有可运行项 = 任务图从第一步就推不动，结算会把它误判成完成
    expect(match.graph.facets.some((facet) => facet.dependsOn.length === 0)).toBe(true)
    expect(match.graph.facets.find((facet) => facet.facetId === 'camera_scene')
      ?.requiredEffects[0]?.minimumCount).toBe(2)
    expect(match.graph.actionGroups.find((group) => group.facetId === 'camera_scene'))
      .toMatchObject({ mode: 'dependent', dependsOn: expect.arrayContaining(['show_target_surface_actions']) })
  })

  it('明确要求创建两个画布节点时生成 minimumCount=2 的 create Effect', () => {
    const match = createDeterministicTaskGraph('在画布创建两个节点并分别设置参数', snapshot())
    expect(match?.graph.facets.find((facet) => facet.facetId === 'canvas_structure')
      ?.requiredEffects[0]).toMatchObject({
        effect: 'create', entityTypes: ['canvas.node'], minimumCount: 2, verificationRequired: true,
      })
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
})
