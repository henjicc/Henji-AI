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

  /*
   * 根源回归：路由判错时，主模型必须有出路。
   *
   * 路由用一个小模型、只看当前这一句话定 intent，intent 决定任务图的 Facet 集合，Facet 集合
   * 又决定哪些能力发现得到——判错一次整次运行就没有出口。实测连着三次：「再帮我添加一个白色的
   * 球体」判成 generate、「你这不对吧」判成 diagnose、「你继续」判成 canvas，而上一轮三次都在
   * camera_stage。三次里主模型都读懂了用户（它拿得到完整会话历史，路由拿不到），却只能停下来
   * 解释自己被阻塞。
   *
   * 补建之后代价从"卡死"降到"多烧一轮"。
   */
  it('路由漏掉的领域可由模型现场补建 Facet', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    // 任务图只有一个 canvas Facet——正是「你继续」被判成 canvas 时的形状。
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'canvas', domain: 'canvas' })]),
      registry,
      true
    )
    const prepared = tracker.prepareDeclaredActionPlan({
      facets: [{
        facetId: 'camera_scene',
        requiredEffects: [{
          effect: 'execute',
          entityTypes: ['camera_stage.object'],
          minimumCount: 1,
        }],
      }],
      actionGroups: [],
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    tracker.commitDeclaredActionPlan(prepared)

    const created = tracker.taskGraphSnapshot().facets.find((item) => item.facetId === 'camera_scene')
    // 领域由 entityTypes 反推，模型不需要（也不能）自己指定。
    expect(created?.domain).toBe('camera_stage')
    expect(created?.capabilityKinds).toContain('execute')
    // 原有 Facet 不受影响。
    expect(tracker.taskGraphSnapshot().facets.map((item) => item.facetId))
      .toEqual(['canvas', 'camera_scene'])
    // 补建之后放置对象的调用不再被判成"不在任务图里"。
    expect(tracker.validate(
      { toolCallId: 'c1', toolName: 'place_camera_stage_object', input: {}, dynamic: false },
      {}
    )).toBeNull()
  })

  /*
   * 根源回归的另一半：补建正确 Facet 之后，路由生成的错误 Facet 必须能作废。
   *
   * 没有这一半，第三次实测失败还是会重演：模型已经补建 camera_scene 把活干完，那个永远拿不到
   * 证据的 canvas Facet 仍然让整次运行报 VERIFICATION_REPAIR_FAILED。
   */
  it('补建新 Facet 时可作废零证据的错误 Facet，结算不再算失败', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'canvas', domain: 'canvas' })]),
      registry,
      true
    )
    const prepared = tracker.prepareDeclaredActionPlan({
      facets: [{
        facetId: 'camera_scene',
        requiredEffects: [{
          effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1,
        }],
      }],
      actionGroups: [],
      supersededFacetIds: ['canvas'],
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    tracker.commitDeclaredActionPlan(prepared)

    expect(tracker.taskGraphSnapshot().facets.find((item) => item.facetId === 'canvas')?.status)
      .toBe('superseded')
    // 被作废的 Facet 既不算完成也不算失败，直接退出结算——不能再拖住整次运行。
    const settlement = tracker.settlement()
    expect(settlement.remainingFacetIds).not.toContain('canvas')
    expect(settlement.blockedFacets.map((item) => item.facetId)).not.toContain('canvas')
  })

  it('作废是有守卫的：不能用来逃避没做完的工作', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'canvas', domain: 'canvas' })]),
      registry,
      true
    )
    // 只作废、不补建 → 拒绝。作废本身不是目的，"换一个正确的来做"才是。
    expect(tracker.prepareDeclaredActionPlan({
      facets: [{
        facetId: 'canvas',
        requiredEffects: [{ effect: 'update', entityTypes: ['canvas.node'], minimumCount: 1 }],
      }],
      actionGroups: [],
      supersededFacetIds: ['canvas'],
    })).toMatchObject({ ok: false, issues: [{ code: 'UNKNOWN_FACET' }] })

    // 已经产生过证据的 Facet 不能被一句话抹掉。
    const touchedTracker = new AgentFacetProgressTracker(
      graph([{ ...facet({ facetId: 'canvas', domain: 'canvas' }), evidence: ['canvas.project:p-1'] }]),
      registry,
      true
    )
    expect(touchedTracker.prepareDeclaredActionPlan({
      facets: [{
        facetId: 'camera_scene',
        requiredEffects: [{ effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1 }],
      }],
      actionGroups: [],
      supersededFacetIds: ['canvas'],
    })).toMatchObject({
      ok: false,
      issues: [{ message: expect.stringContaining('执行痕迹') }],
    })
  })

  /*
   * 谁来选工具：模型申报的 Facet 必须并进发现请求，而不是被运行时前沿整个覆盖。
   *
   * Anthropic 的 Tool Search 由主模型驱动检索（工具选择准确率 79.5% → 88.1%）；本项目的等价物
   * 是能力发现 + 租约，但旧实现把模型的请求改写成运行时前沿，模型写的 facetId / entityTypes
   * 全部丢弃——主模型（唯一拿得到完整会话历史的那个）连"我要的东西在另一个领域"都说不出来。
   */
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
  it('任务图结算完成后不再硬拦工具调用，也不下停止令', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'camera_stage', domain: 'camera_stage', status: 'completed' })]),
      registry
    )
    expect(tracker.settlement().status).toBe('completed')

    /*
     * 还差"把它改成白色"这一步。拦截理由必须从"任务图已结算，禁止继续"变成可自纠的
     * ACTION_PLAN_REQUIRED——"白色"这个 Effect 确实从来没进过计划，补声明再写才是对的，
     * 而这条错误会告诉模型怎么补。区别在于：前者是死路，后者是一步之遥。
     */
    const decision = tracker.validate(
      { toolCallId: 'c1', toolName: 'update_camera_stage_object', input: {}, dynamic: false },
      {}
    )
    expect(decision?.reason).not.toContain('任务图已结算')
    expect(decision?.code).toBe('ACTION_PLAN_REQUIRED')
    expect(decision?.reason).toContain('declare_action_plan')

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

  it('补建 Facet 的领域必须真实存在，且有数量上限', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tracker = new AgentFacetProgressTracker(
      graph([facet({ facetId: 'canvas', domain: 'canvas' })]),
      registry,
      true
    )
    // 实体类型指向不存在的领域时仍然拒绝——模型可以纠正路由，但编不出新领域。
    expect(tracker.prepareDeclaredActionPlan({
      facets: [{
        facetId: 'made_up',
        requiredEffects: [{ effect: 'execute', entityTypes: ['not_a_domain.thing'], minimumCount: 1 }],
      }],
      actionGroups: [],
    })).toMatchObject({ ok: false, issues: [{ code: 'UNKNOWN_FACET' }] })

    // 一次声明里补建超过上限时拒绝，避免模型把任务图撑爆。
    expect(tracker.prepareDeclaredActionPlan({
      facets: Array.from({ length: 5 }, (_, index) => ({
        facetId: `extra_${index}`,
        requiredEffects: [{ effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1 }],
      })),
      actionGroups: [],
    })).toMatchObject({ ok: false, issues: [{ code: 'UNKNOWN_FACET' }] })
  })
})
