import { describe, expect, it } from 'vitest'

import { agentTaskGraphSchema, createSingleFacetTaskGraph } from './taskGraph'
import { createCapabilityDiscoveryInputFromTaskGraph } from './capabilityDiscovery'

describe('agentTaskGraphSchema', () => {
  it('创建可持久化的单 Facet 兼容任务图', () => {
    const graph = createSingleFacetTaskGraph({
      goal: '读取设置',
      facetId: 'settings',
      domain: 'settings',
      capabilityKinds: ['observe', 'query'],
      completionCondition: '返回设置 revision',
    })
    expect(graph).toMatchObject({
      version: 'agent-task-graph/v2',
      facets: [{ facetId: 'settings', status: 'pending' }],
    })
  })

  it('拒绝重复 Facet 和悬空依赖', () => {
    const graph = createSingleFacetTaskGraph({
      goal: '测试',
      facetId: 'first',
      domain: 'canvas',
      completionCondition: '完成',
    })
    expect(() => agentTaskGraphSchema.parse({
      ...graph,
      facets: [graph.facets[0], { ...graph.facets[0], dependsOn: ['missing'] }],
    })).toThrow()
  })

  it('拒绝跨 Facet 偷挂 Effect 或未完整收录 Effect 的 Action Group', () => {
    const base = createSingleFacetTaskGraph({
      goal: '测试组归属', facetId: 'first', domain: 'canvas', completionCondition: '完成',
    })
    const second = createSingleFacetTaskGraph({
      goal: '测试组归属', facetId: 'second', domain: 'settings', completionCondition: '完成',
    })
    expect(() => agentTaskGraphSchema.parse({
      ...base,
      facets: [base.facets[0], second.facets[0]],
      actionGroups: [{
        ...base.actionGroups[0],
        effectIds: [base.facets[0].requiredEffects[0].effectId, second.facets[0].requiredEffects[0].effectId],
      }, second.actionGroups[0]],
    })).toThrow()
    expect(() => agentTaskGraphSchema.parse({
      ...base,
      actionGroups: [{ ...base.actionGroups[0], effectIds: ['missing_effect'] }],
    })).toThrow()
  })

  it('一次把全部 Facet 转换为批量发现请求', () => {
    const first = createSingleFacetTaskGraph({
      goal: '读取设置', facetId: 'settings', domain: 'settings',
      capabilityKinds: ['observe', 'query'], completionCondition: '返回 revision',
    })
    const second = {
      ...first.facets[0],
      facetId: 'show_settings',
      domain: 'navigation',
      capabilityKinds: ['navigate' as const],
      targetSurfaceId: 'settings.general',
      requiredEffects: [{
        effectId: 'show_settings_effect', effect: 'navigate' as const,
        entityTypes: [], propertyIds: [], minimumCount: 1, targetRefs: [],
        verificationRequired: false, actionGroupId: 'show_settings_actions',
      }],
    }
    const graph = agentTaskGraphSchema.parse({
      ...first,
      facets: [first.facets[0], second],
      actionGroups: [
        ...first.actionGroups,
        {
          actionGroupId: 'show_settings_actions', facetId: 'show_settings', mode: 'parallel_read',
          effectIds: ['show_settings_effect'], dependsOn: [],
        },
      ],
    })
    const request = createCapabilityDiscoveryInputFromTaskGraph(graph)
    expect(request?.facets).toHaveLength(2)
    expect(request?.facets[1]).toMatchObject({
      facetId: 'show_settings',
      domains: ['navigation'],
      targetSurfaceIds: ['settings.general'],
    })
  })
})
