import { describe, expect, it } from 'vitest'

import { agentTaskGraphSchema, createSingleFacetTaskGraph } from './taskGraph'

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
      version: 'agent-task-graph/v1',
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
})
