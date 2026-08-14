import { describe, expect, it } from 'vitest'

import {
  AGENT_TASK_GRAPH_VERSION,
  agentTaskGraphSchema,
  type AgentTaskFacet,
} from '../../../../../src/core/assistant/taskGraph'
import { AgentToolRegistry } from '../tools/registry'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
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
    goal: '测试写入计划门禁',
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

/*
 * 旧的 `declare_action_plan` 逐工具声明协议已整体移除：它对模型不可达（工具集过滤 +
 * 脚本 FORBIDDEN_ACTIONS 双向封禁），路由判错的现行出口是重写一段覆盖缺失 Effect 的完整
 * Henji Script。本文件只保留仍然生效的三件事：写入数量门禁、能力发现请求规范化、
 * 结算后的 ACTION_PLAN_REQUIRED 与硬停终态。
 */
describe('写入计划门禁与发现请求规范化', () => {
  it('导航与修改在同一响应时按同一口径计入计划', () => {
    const navigation = facet({ facetId: 'open', domain: 'camera_stage' })
    navigation.capabilityKinds = ['navigate']
    navigation.requiredEffects = [{
      effectId: 'open_effect', effect: 'navigate', entityTypes: ['camera_stage.project'],
      propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
      actionGroupId: 'open_actions',
    }]
    const mutation = facet({ facetId: 'animate', domain: 'camera_stage' })
    mutation.requiredEffects = [{
      effectId: 'animate_effect', effect: 'update', entityTypes: ['camera_stage.object'],
      propertyIds: ['animatable.transform.position.y'], minimumCount: 1, targetRefs: [],
      verificationRequired: true, actionGroupId: 'animate_actions',
    }]

    const tracker = new AgentFacetProgressTracker(
      graph([navigation, mutation]),
      new AgentToolRegistry(),
      true,
    )
    expect(tracker.hasSufficientActionPlan(2)).toBe(true)
  })

  it('模型在发现请求里申报的领域会被并入，而不是被前沿覆盖', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'canvas', domain: 'canvas' })]),
      registry,
      true
    )
    const normalized = tracker.normalizeCallInput({
      toolCallId: 'c1',
      toolName: 'discover_application_capabilities',
      input: {
        facets: [{
          facetId: 'camera_scene',
          queries: ['放置三维对象'],
          entityTypes: ['camera_stage.object'],
        }],
      },
      dynamic: false,
    }) as { facets: Array<{ facetId: string; domains: string[]; entityTypes: string[] }> }

    const declared = normalized.facets.find((item) => item.facetId === 'camera_scene')
    expect(declared, '模型申报的 Facet 必须出现在规范化后的请求里').toBeDefined()
    expect(declared?.domains).toContain('camera_stage')
    expect(declared?.entityTypes).toContain('camera_stage.object')
    // 运行时前沿仍然在，模型漏掉依赖也不会把自己锁死。
    expect(normalized.facets.map((item) => item.facetId)).toContain('canvas')
  })

  it('申报的领域必须真实存在，编造的域不会被并入', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'canvas', domain: 'canvas' })]),
      registry,
      true
    )
    const normalized = tracker.normalizeCallInput({
      toolCallId: 'c2',
      toolName: 'discover_application_capabilities',
      input: {
        facets: [{ facetId: 'made_up', entityTypes: ['not_a_domain.thing'] }],
      },
      dynamic: false,
    }) as { facets: Array<{ facetId: string }> }
    expect(normalized.facets.map((item) => item.facetId)).not.toContain('made_up')
  })

  /*
   * 根源回归：「任务图声明的 Effect 已满足」不等于「用户的目标达成」。
   *
   * 实测：用户要"白色球体"，兜底任务图只生成了一条 effect，place_camera_stage_object 一成功
   * 就结算 completed；validate 当场拒绝一切后续工具、settlementGuidance 下发"停止调用工具"。
   * 模型自己清楚球体还不是白的（答复里写着"未完成/待确认：球体的材质颜色"），却连
   * update_camera_stage_object 都调不动，只能回一句"需要我确认球体为纯白色时，回复一声即可"。
   * 用户看到的就是"每一步操作都要我跟他说一声"。
   *
   * 任务图是对用户目标的近似，清单做完不构成停止的理由；真正该拦的"没有新进展"由
   * repeated_write / repeated_failure / no_change 和运行预算负责，它们判的是事实。
   */
  it('任务图结算完成后不再硬停，缺失目标收敛到一段完整 Henji Script', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'camera_stage', domain: 'camera_stage', status: 'completed' })]),
      registry
    )
    expect(tracker.settlement().status).toBe('completed')

    /*
     * 还差"把它改成白色"这一步。拦截理由必须是可自纠的 ACTION_PLAN_REQUIRED——"白色"这个
     * Effect 确实从来没进过脚本计划，应当重新生成一段覆盖缺失 Effect 的完整 Henji Script。
     * 出口只有这一个：`declare_action_plan` 已随旧协议整体删除，任何提示词都不得再指向它。
     */
    const decision = tracker.validate(
      { toolCallId: 'c1', toolName: 'update_camera_stage_object', input: {}, dynamic: false },
      {}
    )
    expect(decision?.reason).not.toContain('任务图已结算')
    expect(decision?.code).toBe('ACTION_PLAN_REQUIRED')
    expect(decision?.reason).toContain('完整 Henji Script')
    expect(decision?.reason).not.toContain('declare_action_plan')

    const guidance = tracker.settlementGuidance() ?? ''
    expect(guidance).not.toContain('停止调用工具')
    expect(guidance).toContain('对照用户原话')
    // 检查点只下发一次，状态没变就不再重复贴。
    expect(tracker.settlementGuidance()).toBeNull()
  })

  it('真正做不下去的两种终态仍然硬停', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    for (const status of ['blocked', 'waiting_user'] as const) {
      const tracker = new AgentFacetProgressTracker(
        graph([facet({ facetId: 'camera_stage', domain: 'camera_stage', status })]),
        registry
      )
      expect(tracker.validate(
        { toolCallId: 'c1', toolName: 'update_camera_stage_object', input: {}, dynamic: false },
        {}
      ), status).not.toBeNull()
      expect(tracker.settlementGuidance(), status).toContain('停止调用工具')
    }
  })
})
