import { describe, expect, it } from 'vitest'

import {
  AGENT_TASK_GRAPH_VERSION,
  agentTaskGraphSchema,
  type AgentTaskFacet,
} from '../../../../../src/core/assistant/taskGraph'
import { AgentToolRegistry } from '../tools/registry'
import { AgentFacetProgressTracker } from './facet-progress'

function facet(input: Partial<AgentTaskFacet> & Pick<AgentTaskFacet, 'facetId' | 'domain'>): AgentTaskFacet {
  const readOnly = input.capabilityKinds?.includes('observe') ?? false
  return {
    facetId: input.facetId,
    domain: input.domain,
    goal: `完成 ${input.facetId}`,
    targetEntityTypes: [],
    requiredObservations: [],
    capabilityKinds: input.capabilityKinds ?? ['mutate'],
    targetSurfaceId: null,
    dependsOn: [],
    parallelizable: false,
    completionConditions: ['返回稳定证据'],
    requiredEffects: [{
      effectId: `${input.facetId}_effect`,
      effect: readOnly ? 'observe' : 'update',
      entityTypes: readOnly ? ['camera_stage.project'] : ['settings.item'],
      propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
      actionGroupId: `${input.facetId}_actions`,
    }],
    uncertainties: [], confidence: 1,
    status: input.status ?? 'pending', statusReason: '', evidence: [],
  }
}

function graph(facets: AgentTaskFacet[]) {
  return agentTaskGraphSchema.parse({
    version: AGENT_TASK_GRAPH_VERSION,
    goal: '测试 Action Plan',
    facets,
    actionGroups: facets.map((item) => ({
      actionGroupId: item.requiredEffects[0].actionGroupId,
      facetId: item.facetId,
      mode: item.requiredEffects[0].effect === 'observe' ? 'parallel_read' : 'ordered_write',
      effectIds: [item.requiredEffects[0].effectId],
      dependsOn: [],
    })),
    dependencies: [],
    stopConditions: ['完成或明确受阻时停止。'],
  })
}

const settingEffect = (effectId: string, actionGroupId = 'settings_batch') => ({
  effectId, effect: 'update' as const, entityTypes: ['settings.item'], propertyIds: [effectId],
  minimumCount: 1, targetRefs: [], verificationRequired: true, actionGroupId,
})

describe('Action Plan 声明协议', () => {
  it('多写入计划通过预检并在提交后解除数量门禁', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'settings', domain: 'settings' }),
    ]), new AgentToolRegistry(), true)
    expect(tracker.hasSufficientActionPlan(2)).toBe(false)
    const prepared = tracker.prepareDeclaredActionPlan({
      facets: [{ facetId: 'settings', requiredEffects: [settingEffect('setting_a'), settingEffect('setting_b')] }],
      actionGroups: [{
        actionGroupId: 'settings_batch', facetId: 'settings', mode: 'atomic_batch',
        effectIds: ['setting_a', 'setting_b'], dependsOn: [],
      }],
    })
    expect(prepared.ok).toBe(true)
    if (prepared.ok) tracker.commitDeclaredActionPlan(prepared)
    expect(tracker.hasSufficientActionPlan(2)).toBe(true)
    expect(tracker.taskGraphSnapshot().actionGroups[0]).toMatchObject({ mode: 'atomic_batch' })
  })

  it('补充一个 Facet 不清空其他 Facet 已保存的 Effect Ledger', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'observed', domain: 'camera_stage', capabilityKinds: ['observe'] }),
      facet({ facetId: 'settings', domain: 'settings' }),
    ]), new AgentToolRegistry(), true, [{
      effectId: 'observed_effect', count: 1, verified: true,
      evidenceDigests: ['observed-digest'], evidence: ['camera_stage.project:project-1'],
    }])
    const prepared = tracker.prepareDeclaredActionPlan({
      facets: [{ facetId: 'settings', requiredEffects: [settingEffect('setting_a')] }],
      actionGroups: [{
        actionGroupId: 'settings_batch', facetId: 'settings', mode: 'atomic_batch',
        effectIds: ['setting_a'], dependsOn: [],
      }],
    })
    expect(prepared.ok).toBe(true)
    if (prepared.ok) tracker.commitDeclaredActionPlan(prepared)
    expect(tracker.effectLedgerSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ effectId: 'observed_effect', count: 1, verified: true }),
    ]))
  })

  it('模型写错 Effect ID 与 Action Group 时由运行时推导补正，不再判失败', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'active', domain: 'settings' }),
    ]), new AgentToolRegistry(), true)
    const declared = settingEffect('declared_effect')
    const prepared = tracker.prepareDeclaredActionPlan({
      facets: [{ facetId: 'active', requiredEffects: [declared, declared] }],
      // 交叉引用全错：ID 重复、分组引用不存在的 Effect、还多写了一个未知键。
      actionGroups: [{
        actionGroupId: 'settings_batch', facetId: 'active', mode: 'ordered_write',
        effectIds: ['wrong_effect'], dependsOn: [],
      }],
      note: '模型多写的键应被剥离',
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.taskGraph.facets[0].requiredEffects.map((effect) => effect.effectId))
      .toEqual(['active_e1', 'active_e2'])
    expect(prepared.taskGraph.actionGroups).toEqual([expect.objectContaining({
      actionGroupId: 'active_actions',
      facetId: 'active',
      mode: 'atomic_batch',
      effectIds: ['active_e1', 'active_e2'],
    })])
  })

  it('未知、终态、重复 Facet 返回具体问题且不改图', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'active', domain: 'settings' }),
      facet({ facetId: 'done', domain: 'settings', status: 'completed' }),
    ]), new AgentToolRegistry(), true)
    const before = tracker.taskGraphSnapshot()
    const declaration = (facetId: string, effects: AgentTaskFacet['requiredEffects']) => ({
      facets: [{ facetId, requiredEffects: effects }],
      actionGroups: [{
        actionGroupId: 'settings_batch', facetId, mode: 'ordered_write' as const,
        effectIds: effects.map((item) => item.effectId), dependsOn: [],
      }],
    })
    const declared = settingEffect('declared_effect')
    expect(tracker.prepareDeclaredActionPlan(declaration('missing', [declared])))
      .toMatchObject({ ok: false, issues: [{ code: 'UNKNOWN_FACET' }] })
    expect(tracker.prepareDeclaredActionPlan(declaration('done', [declared])))
      .toMatchObject({ ok: false, issues: [{ code: 'TERMINAL_FACET' }] })
    expect(tracker.prepareDeclaredActionPlan({
      ...declaration('active', [declared]),
      facets: [
        { facetId: 'active', requiredEffects: [declared] },
        { facetId: 'active', requiredEffects: [declared] },
      ],
    })).toMatchObject({ ok: false, issues: [{ code: 'DUPLICATE_FACET' }] })
    // 错误信息必须能自纠：列出当前真正可声明的 Facet。
    expect(tracker.prepareDeclaredActionPlan(declaration('missing', [declared])))
      .toMatchObject({ issues: [{ message: expect.stringContaining('active') }] })
    expect(tracker.taskGraphSnapshot()).toEqual(before)
  })
})
