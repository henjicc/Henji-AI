import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import {
  agentAcceptedActionPlanDeclarationSchema,
  agentActionPlanDeclarationSchema,
  createSingleFacetTaskGraph,
  type AgentActionPlanDeclaration,
} from '../../../../../src/core/assistant/taskGraph'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentRouteDecision } from '../context/types'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolGateway } from '../tools/gateway'
import { AgentToolRegistry } from '../tools/registry'
import { AgentFacetProgressTracker } from './facet-progress'
import { AgentToolExecutionCoordinator } from './tool-execution-coordinator'

function declaration(facetId = 'settings') {
  return {
    facets: [{ facetId, requiredEffects: [{
      effectId: 'setting_a', effect: 'update' as const, entityTypes: ['settings.item'],
      propertyIds: ['a'], minimumCount: 1, targetRefs: [], verificationRequired: true,
      actionGroupId: 'settings_batch',
    }, {
      effectId: 'setting_b', effect: 'update' as const, entityTypes: ['settings.item'],
      propertyIds: ['b'], minimumCount: 1, targetRefs: [], verificationRequired: true,
      actionGroupId: 'settings_batch',
    }] }],
    actionGroups: [{
      actionGroupId: 'settings_batch', facetId, mode: 'atomic_batch' as const,
      effectIds: ['setting_a', 'setting_b'], dependsOn: [],
    }],
  }
}

function setup() {
  const registry = new AgentToolRegistry()
  const execute = vi.fn(async (input: AgentActionPlanDeclaration) => ({ accepted: true as const, ...input }))
  registry.register(defineAgentTool({
    name: 'declare_action_plan', version: 1, title: '声明计划', description: '测试计划声明。',
    category: 'application', side: 'backend', risk: 'R0', permission: 'application:read',
    readOnly: true, destructive: false, openWorld: false, idempotent: true, timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: false,
    requiredContext: [], inputSchema: agentActionPlanDeclarationSchema,
    outputSchema: agentAcceptedActionPlanDeclarationSchema,
    aiInputSchema: z.toJSONSchema(agentActionPlanDeclarationSchema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>,
    execute, concurrencyKey: () => 'action-plan', targetIds: () => ({}), dataClasses: () => ['C0'],
    summarize: () => '计划已声明。',
  }))
  const graph = createSingleFacetTaskGraph({
    goal: '修改两项设置', facetId: 'settings', domain: 'settings',
    capabilityKinds: ['mutate'], completionCondition: '两项设置均已修改',
  })
  const tracker = new AgentFacetProgressTracker(graph, registry, true)
  const gateway = new AgentToolGateway({
    registry,
    getHostContext: () => null,
    appendPermissionAudit: async () => {},
  })
  const events: AgentEventInput[] = []
  const route: AgentRouteDecision = {
    routeVersion: 'agent-route/v2', intent: 'settings', candidateIntents: ['settings'],
    complexity: 'multi_step', path: 'primary', toolDomains: ['settings'], source: 'deterministic',
    reason: '测试计划声明', taskFacets: ['settings'], suggestedCapabilityQueries: ['settings'],
    taskGraph: graph,
  }
  const coordinator = new AgentToolExecutionCoordinator({
    runId: 'run-plan', threadId: 'thread-plan', approvalMode: 'assistant_decides',
    supportsParallelTools: false, gateway, registry,
    catalogPlanner: {
      queueKnownToolForActivation: () => false,
      rememberObservation: () => undefined,
      rememberDiscovered: () => [],
    } as never,
    recoveryGuard: { validate: () => null } as never,
    signal: new AbortController().signal,
    waitIfPaused: async () => {}, throwIfCancelled: () => {},
    recordToolCall: vi.fn(), recordProgress: vi.fn(), recordFailure: vi.fn(), recordSuccess: vi.fn(),
    setActiveToolCall: vi.fn(), requestApproval: async () => 'approve', onObservation: vi.fn(),
    emit: (event) => events.push(event), onDiscoveredTools: vi.fn(), getProgressTracker: () => tracker,
  })
  return { coordinator, events, execute, route, tracker }
}

function call(input: unknown): ModelStepToolCall {
  return {
    toolCallId: 'call-plan', toolName: 'declare_action_plan', input,
    dynamic: false,
  }
}

describe('AgentToolExecutionCoordinator action plan', () => {
  it('无效声明在 Gateway 前失败，不执行 backend、不更新任务图', async () => {
    const { coordinator, events, execute, route, tracker } = setup()
    const before = tracker.taskGraphSnapshot()
    await coordinator.execute([call(declaration('missing'))], route, {}, new Set(['declare_action_plan']))
    expect(execute).not.toHaveBeenCalled()
    expect(tracker.taskGraphSnapshot()).toEqual(before)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'ToolFailed', toolName: 'declare_action_plan',
        error: expect.objectContaining({ code: 'INVALID_INPUT' }),
      }),
    ]))
    expect(events.some((event) => event.type === 'ToolCompleted')).toBe(false)
    expect(events.some((event) => event.type === 'PlanUpdated')).toBe(false)
  })

  it('合法声明执行一次并在成功 observation 前原子提交任务图', async () => {
    const { coordinator, events, execute, route, tracker } = setup()
    await coordinator.execute([call(declaration())], route, {}, new Set(['declare_action_plan']))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(tracker.hasSufficientActionPlan(2)).toBe(true)
    // 分组由运行时按 Facet 推导，模型声明里的分组 ID 只是噪声。
    expect(tracker.taskGraphSnapshot().actionGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionGroupId: 'settings_actions', mode: 'atomic_batch' }),
    ]))
    expect(events.some((event) => event.type === 'ToolFailed')).toBe(false)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PlanUpdated' }),
      expect.objectContaining({ type: 'ToolCompleted', toolName: 'declare_action_plan' }),
    ]))
  })
})
