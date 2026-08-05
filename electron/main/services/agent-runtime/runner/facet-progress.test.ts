import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { agentToolObservationSchema, type AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import {
  AGENT_TASK_GRAPH_VERSION,
  agentTaskGraphSchema,
  type AgentObservedEffect,
  type AgentTaskFacet,
} from '../../../../../src/core/assistant/taskGraph'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { AgentFacetProgressTracker } from './facet-progress'

const schemaDigest = `sha256:${'a'.repeat(64)}`

function facet(input: Partial<AgentTaskFacet> & Pick<AgentTaskFacet, 'facetId' | 'domain'>): AgentTaskFacet {
  const capabilityKinds = input.capabilityKinds ?? ['mutate']
  const effect = capabilityKinds.includes('query') || capabilityKinds.includes('observe')
    ? 'observe' as const
    : 'create' as const
  return {
    facetId: input.facetId,
    domain: input.domain,
    goal: input.goal ?? `完成 ${input.facetId}`,
    targetEntityTypes: input.targetEntityTypes ?? [],
    requiredObservations: input.requiredObservations ?? [],
    capabilityKinds,
    targetSurfaceId: input.targetSurfaceId ?? null,
    dependsOn: input.dependsOn ?? [],
    parallelizable: input.parallelizable ?? false,
    completionConditions: input.completionConditions ?? ['返回稳定 revision 或引用'],
    requiredEffects: input.requiredEffects ?? [{
      effectId: `${input.facetId}_effect`,
      effect,
      entityTypes: input.targetEntityTypes ?? ['camera_stage.object'],
      propertyIds: [],
      minimumCount: 1,
      targetRefs: [],
      verificationRequired: false,
      actionGroupId: `${input.facetId}_actions`,
    }],
    uncertainties: input.uncertainties ?? [],
    confidence: input.confidence ?? 1,
    status: input.status ?? 'pending',
    statusReason: input.statusReason ?? '',
    evidence: input.evidence ?? [],
  }
}

function graph(facets: AgentTaskFacet[]) {
  return agentTaskGraphSchema.parse({
    version: AGENT_TASK_GRAPH_VERSION,
    goal: '测试结构化进展',
    facets,
    actionGroups: facets.flatMap((item) => item.requiredEffects.map((effect) => ({
      actionGroupId: effect.actionGroupId,
      facetId: item.facetId,
      mode: effect.effect === 'observe' ? 'parallel_read' : 'ordered_write',
      effectIds: [effect.effectId],
      dependsOn: [],
    }))),
    dependencies: facets.flatMap((item) => item.dependsOn.map((dependency) => ({
      fromFacetId: dependency,
      toFacetId: item.facetId,
    }))),
    stopConditions: ['完成或明确受阻时停止。'],
  })
}

function call(toolName: string, input: Record<string, unknown> = { id: 'same' }): ModelStepToolCall {
  return { toolCallId: `call-${toolName}`, toolName, input, dynamic: false }
}

function observation(toolName: string, output: unknown): AgentToolObservation {
  return agentToolObservationSchema.parse({
    source: { toolName, toolVersion: 1, toolCallId: `call-${toolName}` },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: `${toolName} 结果`,
    output,
  })
}

function failure(toolName: string, code: string, recovery = 'none'): AgentToolObservation {
  return observation(toolName, {
    ok: false,
    error: { code, message: `${code} 测试失败`, retryable: false, recovery },
  })
}

function registry(input?: {
  writeEffect?: AgentObservedEffect['effect']
  writeEntityTypes?: string[]
  writePropertyIds?: string[]
  writeResolver?: (toolInput: unknown, output: unknown) => AgentObservedEffect[]
}): AgentToolRegistry {
  const result = new AgentToolRegistry()
  for (const definition of [
    {
      name: 'write_camera', category: 'camera_stage', readOnly: false,
      effect: input?.writeEffect ?? 'create',
      entityTypes: input?.writeEntityTypes ?? ['camera_stage.object'],
      propertyIds: input?.writePropertyIds ?? [],
      resolver: input?.writeResolver,
    },
    {
      name: 'read_camera', category: 'camera_stage', readOnly: true,
      effect: 'observe' as const,
      entityTypes: input?.writeEntityTypes ?? ['camera_stage.object'],
      propertyIds: input?.writePropertyIds ?? [],
      resolver: undefined,
    },
    {
      name: 'navigate_surface', category: 'navigation', readOnly: false,
      effect: 'navigate' as const,
      entityTypes: [] as string[],
      propertyIds: [] as string[],
      resolver: undefined,
    },
  ]) {
    result.register(defineAgentTool({
      ...definition,
      capability: {
        domain: definition.category,
        control: { impacts: [{
          effect: definition.effect,
          entityTypes: definition.entityTypes,
          propertyIds: definition.propertyIds,
          revisionScopes: ['toolbox'],
          verificationRequired: !definition.readOnly,
        }] },
        resolveObservedEffects: definition.resolver,
      } as never,
      version: 1,
      title: definition.name,
      description: '测试进展判定。',
      side: 'backend',
      risk: 'R0',
      permission: 'test:progress',
      destructive: false,
      openWorld: false,
      idempotent: true,
      timeoutMs: 1_000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
      supportsPreview: false,
      supportsUndo: false,
      requiredContext: [],
      inputSchema: z.object({ id: z.string() }).strict(),
      outputSchema: z.record(z.string(), z.unknown()),
      aiInputSchema: {
        type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
      },
      execute: async () => ({}),
      concurrencyKey: (input) => `${definition.name}:${input.id}`,
      targetIds: (input) => ({ id: input.id }),
      dataClasses: () => ['C0'],
      summarize: () => '完成',
    }))
  }
  return result
}

describe('AgentFacetProgressTracker', () => {
  it('能力发现请求被规范化到真实依赖前沿，而不是判失败', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'ready_a', domain: 'camera_stage' }),
      facet({ facetId: 'ready_b', domain: 'camera_stage' }),
      facet({ facetId: 'later', domain: 'camera_stage', dependsOn: ['ready_a'] }),
    ]), registry())

    const facetIdsOf = (input: unknown): string[] => (
      (input as { facets: { facetId: string }[] }).facets.map((item) => item.facetId)
    )
    // 无论模型少写、多写还是只写下游，都补正成"整条链路一次发现完"，且不产生任何拒绝。
    for (const requested of [
      [{ facetId: 'ready_a' }],
      [{ facetId: 'ready_a' }, { facetId: 'ready_b' }, { facetId: 'later' }],
      [{ facetId: 'later' }],
    ]) {
      const target = call('discover_application_capabilities', { facets: requested })
      expect(facetIdsOf(tracker.normalizeCallInput(target))).toEqual(['ready_a', 'ready_b', 'later'])
      expect(tracker.validate(target, {})).toBeNull()
    }
  })

  /*
   * 回归："在 3D 镜头参考里新建工程并布置场景"整次运行卡死的那条链路。
   *
   * 工程创建成功但还差一次验证观察 → camera_project 停在 active → 依赖前沿始终只有它自己
   * → 旧实现的能力发现返回"允许：无"、导航写入返回 ACTION_PLAN_REQUIRED，模型转去
   * declare_action_plan 又撞 schema，四次守卫失败直接触发 CONSECUTIVE_FAILURES。
   */
  it('前置 Facet 尚未验证完成时，能力发现与下游导航都不再死锁', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({
        facetId: 'camera_project', domain: 'camera_stage',
        targetEntityTypes: ['camera_stage.project'],
        requiredEffects: [{
          effectId: 'camera_project_effect', effect: 'create',
          entityTypes: ['camera_stage.project'], propertyIds: [], minimumCount: 1,
          targetRefs: [], verificationRequired: true, actionGroupId: 'camera_project_actions',
        }],
      }),
      facet({
        facetId: 'show_target_surface', domain: 'navigation',
        capabilityKinds: ['observe', 'navigate'], dependsOn: ['camera_project'],
        requiredEffects: [{
          effectId: 'show_target_surface_effect', effect: 'navigate', entityTypes: [],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
          actionGroupId: 'show_target_surface_actions',
        }],
      }),
    ]), registry({ writeEntityTypes: ['camera_stage.project'] }))

    tracker.observe({
      call: call('write_camera', { id: 'project' }), expectedRevisions: {},
      observation: observation('write_camera', { projectId: 'project-1', revision: 3 }),
    })
    expect(tracker.dependencyFrontierFacetIds()).toEqual(['camera_project'])

    const discovery = call('discover_application_capabilities', {
      facets: [{ facetId: 'show_target_surface' }],
    })
    expect(tracker.normalizeCallInput(discovery)).not.toBeNull()
    expect(tracker.validate(discovery, {})).toBeNull()
    expect(tracker.validate(call('navigate_surface', { id: 'tools' }), {})).toBeNull()
  })

  it('规范化把运行时 requiredEffects 带进发现请求，租约排序才有依据', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({
        facetId: 'camera',
        domain: 'camera_stage',
        targetEntityTypes: ['camera_stage.project'],
        requiredEffects: [{
          effectId: 'camera_effect', effect: 'create', entityTypes: ['camera_stage.project'],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
          actionGroupId: 'camera_actions',
        }],
      }),
    ]), registry())
    const normalized = tracker.normalizeCallInput(call('discover_application_capabilities', {
      facets: [{ facetId: 'camera', queries: ['新建工程'] }],
    })) as { facets: { queries: string[]; requiredEffects: unknown[] }[] }
    expect(normalized.facets[0].requiredEffects).toEqual([
      { effect: 'create', entityTypes: ['camera_stage.project'], propertyIds: [] },
    ])
    // 模型自带的检索词保留，运行时目标补在前面。
    expect(normalized.facets[0].queries).toContain('新建工程')
  })

  /*
   * 写入本身不构成验证，但一次覆盖到位的结构化观察就够了。
   *
   * 旧实现按实例数累加验证次数：写 2 个对象要再读 2 次、写 6 个关键帧要再读 6 次。可 observe
   * 一次就返回整个场景，再读只会拿到同一份数据并被去重挡掉——实测 camera_object_animation
   * 因此永远停在 active，活干完了却报"任务图仍有 Facet 未结算"。
   */
  it('要求创建两个对象时写入不能自我验证，一次独立结构化观察即可完成', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({
        facetId: 'two_objects',
        domain: 'camera_stage',
        targetEntityTypes: ['camera_stage.object'],
        requiredEffects: [{
          effectId: 'two_objects_effect', effect: 'create',
          entityTypes: ['camera_stage.object'], propertyIds: [], minimumCount: 2,
          targetRefs: [], verificationRequired: true, actionGroupId: 'two_objects_actions',
        }],
      }),
    ]), registry())

    const first = tracker.observe({
      call: call('write_camera', { id: 'first' }), expectedRevisions: {},
      observation: observation('write_camera', { objectId: 'object-1', revision: 1 }),
    })
    expect(first[0]).toMatchObject({ facetId: 'two_objects', status: 'active' })
    expect(tracker.settlement()).toMatchObject({ status: 'active', completedFacetIds: [] })

    const restored = new AgentFacetProgressTracker(
      tracker.taskGraphSnapshot(), registry(), false, tracker.effectLedgerSnapshot()
    )

    const second = restored.observe({
      call: call('write_camera', { id: 'second' }), expectedRevisions: {},
      observation: observation('write_camera', { objectId: 'object-2', revision: 2 }),
    })
    expect(second[0]).toMatchObject({ facetId: 'two_objects', status: 'active' })

    const verification = restored.observe({
      call: call('read_camera', { id: 'verify' }), expectedRevisions: {},
      observation: observation('read_camera', { verified: true, objectId: 'object-1', revision: 2 }),
    })
    expect(verification[0]).toMatchObject({ facetId: 'two_objects', status: 'completed' })
    expect(restored.settlement().status).toBe('completed')
  })

  /*
   * 回归：一次结构化观察只记给了第一个候选 Facet。
   *
   * "只取第一个候选"是为了防止一次写入被多个 Facet 重复计数，但观察不是写入。一次
   * observe_camera_stage_scene 返回整个场景，本来就同时构成多个 Facet 的验证证据；实测它只记给
   * camera_scene，camera_object_animation 拿不到证据，关键帧已落库却永远停在 active。
   */
  /*
   * 回归：declare_action_plan 把已完成的 Facet 打回 pending。
   *
   * 追踪器把活动状态放在独立的 facets Map 里，taskGraph.facets 始终是任务开始时的快照。旧实现
   * 对未声明的 Facet 回退到快照，提交时又用合并结果重建整个 Map——实测 6 个 Facet 全部完成过，
   * 补声明关键帧计划时集体重置；之后有新工具调用的五个陆续重新完成，唯独已导航完毕的
   * show_target_surface 不会再被触发，永远停在 pending，整次运行报"仍有 1 个 Facet 未结算"。
   */
  it('补声明某个 Facet 不会重置其他 Facet 运行中取得的状态', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'navigated', domain: 'camera_stage', capabilityKinds: ['observe'] }),
      facet({ facetId: 'pending_write', domain: 'camera_stage' }),
    ]), registry(), true)

    // navigated 在运行中真实完成；它之后不会再有工具调用来重新触发。
    tracker.observe({
      call: call('read_camera', { id: 'observe-once' }), expectedRevisions: {},
      observation: observation('read_camera', { objectId: 'object-1', revision: 2 }),
    })
    expect(tracker.settlement().completedFacetIds).toContain('navigated')

    const prepared = tracker.prepareDeclaredActionPlan({
      facets: [{
        facetId: 'pending_write',
        requiredEffects: [{
          effect: 'create', entityTypes: ['camera_stage.object'], minimumCount: 2,
        }],
      }],
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    tracker.commitDeclaredActionPlan(prepared)

    expect(tracker.settlement().completedFacetIds).toContain('navigated')
    expect(tracker.taskGraphSnapshot().facets.find((item) => item.facetId === 'navigated')?.status)
      .toBe('completed')
  })

  it('纯观察同时结算所有匹配 Facet，写入仍只归属一个', () => {
    const sceneEffect = (facetId: string) => ({
      effectId: `${facetId}_effect`, effect: 'create' as const,
      entityTypes: ['camera_stage.object'], propertyIds: [], minimumCount: 1,
      targetRefs: [], verificationRequired: true, actionGroupId: `${facetId}_actions`,
    })
    const taskGraph = graph([
      facet({ facetId: 'scene_a', domain: 'camera_stage', requiredEffects: [sceneEffect('scene_a')] }),
      facet({ facetId: 'scene_b', domain: 'camera_stage', requiredEffects: [sceneEffect('scene_b')] }),
    ])

    // 写入只归属一个 Facet：一次写入不会被两个 Facet 重复计数。
    const writeTracker = new AgentFacetProgressTracker(taskGraph, registry())
    expect(writeTracker.observe({
      call: call('write_camera', { id: 'one' }), expectedRevisions: {},
      observation: observation('write_camera', { objectId: 'object-1', revision: 1 }),
    })).toHaveLength(1)

    // 两个 Facet 的写入都已完成、都还差验证证据时，一次结构化观察应当同时结算两者。
    const tracker = new AgentFacetProgressTracker(taskGraph, registry(), false, [
      { effectId: 'scene_a_effect', count: 1, verified: false, evidenceDigests: [], evidence: [] },
      { effectId: 'scene_b_effect', count: 1, verified: false, evidenceDigests: [], evidence: [] },
    ])
    const observed = tracker.observe({
      call: call('read_camera', { id: 'verify' }), expectedRevisions: {},
      observation: observation('read_camera', { verified: true, objectId: 'object-1', revision: 2 }),
    })
    expect(observed.map((event) => event.facetId).sort()).toEqual(['scene_a', 'scene_b'])
    expect(tracker.settlement().status).toBe('completed')
  })

  it('同一 action group 已开始后不会因第一项结算而拦截兄弟调用', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'group_write', domain: 'camera_stage' }),
    ]), registry())
    const first = call('write_camera', { id: 'first' })
    tracker.observe({
      call: first,
      expectedRevisions: {},
      observation: observation('write_camera', { objectId: 'object-1', revision: 1 }),
    })
    expect(tracker.settlement().status).toBe('completed')
    const sibling = call('write_camera', { id: 'second' })
    expect(tracker.validate(sibling, {})).toMatchObject({
      reason: expect.stringContaining('任务图已结算'),
    })
    expect(tracker.validate(sibling, {}, true)).toBeNull()
  })

  it('同领域但错误实体或错误属性不能贡献 Effect', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({
        facetId: 'position', domain: 'camera_stage',
        requiredEffects: [{
          effectId: 'position_effect', effect: 'update', entityTypes: ['camera_stage.object'],
          propertyIds: ['camera_stage.object.position'], minimumCount: 1, targetRefs: [],
          verificationRequired: false, actionGroupId: 'position_actions',
        }],
      }),
    ]), registry({
      writeEffect: 'update',
      writeEntityTypes: ['camera_stage.camera'],
      writePropertyIds: ['camera_stage.camera.fov'],
    }))

    expect(tracker.observe({
      call: call('write_camera'), expectedRevisions: {},
      observation: observation('write_camera', { revision: 1 }),
    })).toEqual([])
    expect(tracker.settlement().status).toBe('active')
  })

  it('图外写入在执行前返回 ACTION_PLAN_REQUIRED', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({
        facetId: 'position', domain: 'camera_stage',
        requiredEffects: [{
          effectId: 'position_effect', effect: 'update', entityTypes: ['camera_stage.object'],
          propertyIds: ['camera_stage.object.transform.position'], minimumCount: 1,
          targetRefs: [], verificationRequired: true, actionGroupId: 'position_actions',
        }],
      }),
    ]), registry({ writeEffect: 'create', writeEntityTypes: ['camera_stage.camera'] }))
    expect(tracker.validate(call('write_camera'), {})).toMatchObject({
      code: 'ACTION_PLAN_REQUIRED',
      // 拒绝理由必须能自纠：列出任务图待办 Effect 和补声明方式。
      reason: expect.stringContaining('position:update(camera_stage.object)'),
    })
  })

  it('相同输出不会重复计数，且无解析器的能力一次最多贡献一个 Effect', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({
        facetId: 'two_objects', domain: 'camera_stage',
        requiredEffects: [{
          effectId: 'two_objects_effect', effect: 'create', entityTypes: ['camera_stage.object'],
          propertyIds: [], minimumCount: 2, targetRefs: [], verificationRequired: false,
          actionGroupId: 'two_objects_actions',
        }],
      }),
    ]), registry())
    const firstCall = call('write_camera', { id: 'first' })
    const sameOutput = observation('write_camera', { objectId: 'same', revision: 1 })
    tracker.observe({ call: firstCall, expectedRevisions: {}, observation: sameOutput })
    tracker.observe({
      call: call('write_camera', { id: 'second' }), expectedRevisions: {}, observation: sameOutput,
    })
    expect(tracker.settlement()).toMatchObject({ status: 'active', completedFacetIds: [] })
  })

  it('能力缺失会阻塞目标 Facet 及其依赖项并立即结算', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
      facet({ facetId: 'navigate', domain: 'navigation', dependsOn: ['camera'] }),
      facet({ facetId: 'verify', domain: 'diagnostics', dependsOn: ['navigate'] }),
    ]), registry())

    const events = tracker.observe({
      call: call('discover_application_capabilities', { facets: ['camera'] }),
      expectedRevisions: {},
      observation: observation('discover_application_capabilities', {
        fingerprint: schemaDigest,
        reused: false,
        facets: [],
        missing: [{ facetId: 'camera', reason: 'unsupported_domain' }],
      }),
    })

    expect(events).toEqual([expect.objectContaining({
      facetId: 'camera', status: 'blocked', kind: 'capability_missing',
    })])
    expect(tracker.drainPendingEvents()).toEqual([
      expect.objectContaining({ facetId: 'navigate', status: 'blocked' }),
      expect.objectContaining({ facetId: 'verify', status: 'blocked' }),
    ])
    expect(tracker.settlement()).toMatchObject({
      status: 'blocked', remainingFacetIds: [],
    })
  })

  it('一次发现覆盖整条链路，下游 Facet 的工具提前租好', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'anchor', domain: 'camera_stage', capabilityKinds: ['query'] }),
      facet({ facetId: 'write', domain: 'camera_stage', dependsOn: ['anchor'] }),
    ]), registry())
    // 执行顺序仍由依赖前沿约束，只有能力发现的范围放宽。
    expect(tracker.dependencyFrontierFacetIds()).toEqual(['anchor'])
    const normalized = tracker.normalizeCallInput(call('discover_application_capabilities', {
      facets: [{ facetId: 'write' }],
    })) as { facets: { facetId: string }[] }
    expect(normalized.facets.map((item) => item.facetId)).toEqual(['anchor', 'write'])
  })

  it('新 schema 算进展，同一 Facet 的重复发现靠 no_change 软刹车而不是硬失败', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
    ]), registry())
    const discoveryCall = call('discover_application_capabilities', {
      facets: [{ facetId: 'camera' }],
    })
    const discoveryOutput = {
      fingerprint: schemaDigest,
      reused: false,
      missing: [],
      facets: [{
        facetId: 'camera',
        schemaRefs: [{
          catalogVersion: 'application-capabilities/v2', kind: 'operation', id: 'write_camera',
          version: 1, digest: schemaDigest,
        }],
      }],
    }
    expect(tracker.observe({
      call: discoveryCall, expectedRevisions: {},
      observation: observation(discoveryCall.toolName, discoveryOutput),
    })[0]).toMatchObject({ kind: 'schema_discovered', status: 'active' })

    // 第二次发现不再硬拒（硬拒会让前沿全部租约后彻底死锁），改由重复无进展计数收敛。
    expect(tracker.validate(discoveryCall, {})).toBeNull()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      tracker.observe({
        call: discoveryCall, expectedRevisions: {},
        observation: observation(discoveryCall.toolName, discoveryOutput),
      })
    }
    expect(tracker.validate(discoveryCall, {})).toMatchObject({ events: expect.any(Array) })
    expect(tracker.settlement().status).toBe('active')
  })

  it('前沿 Facet 全部持有租约时仍可发现，不会返回"允许：无"死锁', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
    ]), registry(), false, [], ['camera'])
    const target = call('discover_application_capabilities', { facets: [{ facetId: 'camera' }] })
    const normalized = tracker.normalizeCallInput(target) as { facets: { facetId: string }[] }
    expect(normalized.facets.map((item) => item.facetId)).toEqual(['camera'])
    expect(tracker.validate(target, {})).toBeNull()
  })

  it('成功写入后阻止相同参数和 base revision 的重复创建并保留部分完成', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'first_object', domain: 'camera_stage' }),
      facet({ facetId: 'second_object', domain: 'camera_stage' }),
    ]), registry())
    const write = call('write_camera')
    tracker.observe({
      call: write,
      expectedRevisions: { toolbox: 4 },
      observation: observation(write.toolName, { objectId: 'object-1', revision: 5 }),
    })

    const decision = tracker.validate(write, { toolbox: 4 })
    expect(decision).toMatchObject({
      events: [{ kind: 'repeated_write', status: 'blocked' }],
    })
    expect(tracker.settlement()).toMatchObject({
      status: 'partial', completedFacetIds: ['first_object'],
      blockedFacets: [{ facetId: 'second_object' }],
    })
    expect(tracker.settlementGuidance()).toContain('已完成部分')
  })

  it('revision 冲突后在未重读状态前拒绝相同 base revision 重试', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
    ]), registry())
    const write = call('write_camera')
    tracker.observe({
      call: write,
      expectedRevisions: { toolbox: 4 },
      observation: failure(write.toolName, 'CONFLICT', 'refresh_context'),
    })

    expect(tracker.validate(write, { toolbox: 4 })).toMatchObject({
      events: [{ kind: 'revision_conflict', status: 'blocked' }],
    })
  })

  it('无效输入重复且明确需要用户动作时复用 waiting_user 结算', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
      facet({ facetId: 'verify', domain: 'diagnostics', dependsOn: ['camera'] }),
    ]), registry())
    const write = call('write_camera')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      tracker.observe({
        call: write,
        expectedRevisions: { toolbox: 4 },
        observation: failure(write.toolName, 'INVALID_INPUT', 'user_action'),
      })
    }

    expect(tracker.settlement()).toMatchObject({
      status: 'waiting_user', waitingFacetIds: ['camera'], remainingFacetIds: ['verify'],
    })
    expect(tracker.settlementGuidance()).toContain('最小具体问题')

    expect(tracker.resumeWaitingFacets('project-1 的 object-1')).toEqual([
      expect.objectContaining({
        facetId: 'camera', status: 'active', kind: 'user_input_received',
      }),
    ])
    expect(tracker.settlement().status).toBe('active')
    expect(tracker.validate(write, { toolbox: 4 })).toBeNull()
  })

  it('权限拒绝不会继续尝试同一 Facet', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
    ]), registry())
    tracker.observe({
      call: call('write_camera'), expectedRevisions: {},
      observation: failure('write_camera', 'PERMISSION_DENIED', 'user_action'),
    })
    expect(tracker.settlement()).toMatchObject({
      status: 'blocked', blockedFacets: [{ facetId: 'camera' }],
    })
  })
})

/**
 * 实测事故：立方体放完之后，圆柱体、环绕运镜、上下漂浮三个 Facet 都还挂着，运行时却把任务图
 * 结算为 completed 并下发"停止调用工具"，助手于是收手汇报"已完成"。
 *
 * 原因是判定阶梯的第三档只看 blocked 和 waiting，**完全不看 remaining**：只要没有受阻、没有
 * 等待用户，哪怕任务图里还剩一半没做也判 completed。触发条件是"还有 Facet 但一个都不可运行"
 * ——三维写入 Facet 全都依赖导航 Facet，导航又依赖查询锚点，锚点没被记成 completed 时整条链
 * 永远没有可运行项，而它们既不是 blocked 也不是 waiting_user，精准命中这一档。
 */
describe('任务图结算不得谎报完成', () => {
  it('还有 Facet 没做时，任何情况下都不能结算为 completed', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'anchor', domain: 'camera_stage', capabilityKinds: ['query'] }),
      facet({ facetId: 'place_cylinder', domain: 'camera_stage', dependsOn: ['anchor'] }),
      facet({ facetId: 'orbit_camera', domain: 'camera_stage', dependsOn: ['anchor'] }),
    ]), registry())
    const settlement = tracker.settlement()
    expect(settlement.status).not.toBe('completed')
    expect(settlement.remainingFacetIds.length).toBeGreaterThan(0)
  })

  it('依赖死锁时把剩余 Facet 标成受阻并指出卡在哪个依赖上', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'anchor', domain: 'camera_stage', dependsOn: ['place_cylinder'] }),
      facet({ facetId: 'place_cylinder', domain: 'camera_stage', dependsOn: ['anchor'] }),
    ]), registry())
    const settlement = tracker.settlement()
    expect(settlement.status).not.toBe('completed')
    const reasons = settlement.blockedFacets.map((item) => `${item.facetId}:${item.reason}`).join('|')
    expect(reasons).toContain('place_cylinder')
    expect(reasons).toContain('anchor')
    expect(settlement.suggestedNextStep ?? '').toContain('不要声称任务已完成')
  })

  it('全部 Facet 完成时仍然结算为 completed', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'only', domain: 'camera_stage', status: 'completed' }),
    ]), registry())
    expect(tracker.settlement().status).toBe('completed')
  })
})
