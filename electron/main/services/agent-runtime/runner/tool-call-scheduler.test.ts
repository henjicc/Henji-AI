import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import {
  AGENT_CONTRACT_VERSION,
  type HostScopeRevisions,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { AgentToolCatalogPlanner } from '../context/catalog'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolGateway } from '../tools/gateway'
import { AgentToolRegistry } from '../tools/registry'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentStopPolicyExceededError } from './budget'
import { AgentToolCallScheduler } from './tool-call-scheduler'

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-scheduler',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [],
    capturedAt: new Date().toISOString(),
  }
}

function toolCall(index: number): ModelStepToolCall {
  return {
    toolCallId: `call-${index}`,
    toolName: 'read_test_resource',
    input: { id: `resource-${index}` },
    dynamic: false,
  }
}

function createScheduler(
  execute: (id: string) => Promise<{ id: string }>,
  observations: AgentToolObservation[],
  events: AgentEventInput[],
  executionGuard?: (
    call: ModelStepToolCall,
    expectedRevisions: Partial<HostScopeRevisions>
  ) => string | null,
  activeToolNames: ReadonlySet<string> = new Set(['read_test_resource', 'write_test_resource']),
  configurePlanner?: (planner: AgentToolCatalogPlanner) => void,
  recordFailure?: () => void,
  onOutcome?: (
    call: ModelStepToolCall,
    observation: AgentToolObservation,
    expectedRevisions: Partial<HostScopeRevisions>
  ) => void,
  recordToolCall: (signature: string, write: boolean) => void = () => undefined
): AgentToolCallScheduler {
  const registry = new AgentToolRegistry()
  registry.register(defineAgentTool({
    name: 'read_test_resource',
    version: 1,
    title: '读取测试资源',
    description: '读取独立测试资源。',
    category: 'diagnostics',
    side: 'backend',
    risk: 'R0',
    permission: 'test:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({ id: z.string() }).strict(),
    outputSchema: z.object({ id: z.string() }).strict(),
    aiInputSchema: {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
    },
    execute: async (input) => execute(input.id),
    concurrencyKey: (input) => `test:${input.id}`,
    targetIds: (input) => ({ id: input.id }),
    dataClasses: () => ['C0'],
    summarize: (output) => `已读取 ${output.id}`,
  }))
  registry.register(defineAgentTool({
    name: 'write_test_resource',
    version: 1,
    title: '写入测试资源',
    description: '写入独立测试资源。',
    category: 'diagnostics',
    side: 'backend',
    risk: 'R0',
    permission: 'test:write',
    readOnly: false,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({ id: z.string() }).strict(),
    outputSchema: z.object({ id: z.string() }).strict(),
    aiInputSchema: {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
    },
    execute: async (input) => execute(input.id),
    concurrencyKey: (input) => `test-write:${input.id}`,
    targetIds: (input) => ({ id: input.id }),
    dataClasses: () => ['C0'],
    summarize: (output) => `已写入 ${output.id}`,
  }))
  const gateway = new AgentToolGateway({
    registry,
    getHostContext: hostContext,
    appendPermissionAudit: async () => {},
  })
  const catalogPlanner = new AgentToolCatalogPlanner(registry)
  configurePlanner?.(catalogPlanner)
  return new AgentToolCallScheduler({
    runId: 'run-scheduler',
    threadId: 'thread-scheduler',
    approvalMode: 'assistant_decides',
    supportsParallelTools: true,
    gateway,
    registry,
    catalogPlanner,
    activeToolNames,
    signal: new AbortController().signal,
    waitIfPaused: () => Promise.resolve(),
    throwIfCancelled: () => undefined,
    recordToolCall,
    recordProgress: () => undefined,
    recordFailure,
    setActiveToolCall: () => undefined,
    requestApproval: () => Promise.reject(new Error('只读工具不应请求审批')),
    onObservation: (_call, observation) => observations.push(observation),
    emit: (event) => events.push(event),
    onDiscoveredTools: () => undefined,
    executionGuard,
    onOutcome,
  })
}

describe('AgentToolCallScheduler', () => {
  it('并行模型可以同时执行并发键不冲突的只读工具', async () => {
    let active = 0
    let maxActive = 0
    const observations: AgentToolObservation[] = []
    const events: AgentEventInput[] = []
    const scheduler = createScheduler(async (id) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return { id }
    }, observations, events)

    await scheduler.execute([toolCall(1), toolCall(2)], true, {})

    expect(maxActive).toBe(2)
    expect(observations).toHaveLength(2)
    expect(events.filter((event) => event.type === 'ToolRequested')).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: '读取测试资源' })])
    )
    expect(events.filter((event) => event.type === 'ToolCompleted')).toEqual([
      expect.objectContaining({ completionKind: 'observed' }),
      expect.objectContaining({ completionKind: 'observed' }),
    ])
  })

  it('一次响应中的全部工具调用都会执行，不受旧单轮上限影响', async () => {
    let executions = 0
    const observations: AgentToolObservation[] = []
    const events: AgentEventInput[] = []
    const scheduler = createScheduler(async (id) => {
      executions += 1
      return { id }
    }, observations, events)

    await scheduler.execute(Array.from({ length: 10 }, (_, index) => toolCall(index + 1)), true, {})

    expect(executions).toBe(10)
    expect(observations).toHaveLength(10)
    expect(events.filter((event) => event.type === 'ToolRequested')).toHaveLength(10)
    expect(events.filter((event) => event.type === 'ToolFailed')).toHaveLength(0)
  })

  it('恢复守卫会阻止未知副作用确认前的写操作', async () => {
    let executions = 0
    const observations: AgentToolObservation[] = []
    const events: AgentEventInput[] = []
    const scheduler = createScheduler(async (id) => {
      executions += 1
      return { id }
    }, observations, events, (call) => (
      call.toolName === 'write_test_resource' ? '请先读取真实状态。' : null
    ))

    await scheduler.execute([{
      toolCallId: 'call-write',
      toolName: 'write_test_resource',
      input: { id: 'resource-1' },
      dynamic: false,
    }], true, {})

    expect(executions).toBe(0)
    expect(observations[0]).toMatchObject({
      output: { ok: false, error: { code: 'RECOVERY_VERIFICATION_REQUIRED' } },
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'ToolRequested', category: 'diagnostics', readOnly: false, idempotent: true,
      }),
    ]))
  })

  it('拒绝动态工具调用和未在本轮冻结集合中的工具', async () => {
    let executions = 0
    const observations: AgentToolObservation[] = []
    const events: AgentEventInput[] = []
    const scheduler = createScheduler(async (id) => {
      executions += 1
      return { id }
    }, observations, events, undefined, new Set(['read_test_resource']))

    await scheduler.execute([{
      ...toolCall(1),
      dynamic: true,
    }, {
      toolCallId: 'call-write',
      toolName: 'write_test_resource',
      input: { id: 'resource-write' },
      dynamic: false,
    }], true, {})

    expect(executions).toBe(0)
    expect(observations).toHaveLength(2)
    expect(observations.every((item) => (
      (item.output as { error?: { code?: string } }).error?.code === 'TOOL_NOT_ACTIVE'
    ))).toBe(true)
  })

  it('已发现工具被挤出时安排下一轮恢复，不计入连续执行失败', async () => {
    let executions = 0
    let failures = 0
    const observations: AgentToolObservation[] = []
    const events: AgentEventInput[] = []
    const scheduler = createScheduler(async (id) => {
      executions += 1
      return { id }
    }, observations, events, undefined, new Set(), (planner) => {
      planner.restoreDiscovered(['read_test_resource'])
    }, () => { failures += 1 })

    await scheduler.execute([{ ...toolCall(1), dynamic: true }], true, {})

    expect(executions).toBe(0)
    expect(failures).toBe(0)
    expect(observations[0]).toMatchObject({
      output: {
        ok: false,
        error: { code: 'TOOL_NOT_ACTIVE', retryable: true, recovery: 'refresh_context' },
      },
    })
  })

  it('执行前守卫和结果回调接收同一组 base revision', async () => {
    const observations: AgentToolObservation[] = []
    const events: AgentEventInput[] = []
    const guarded: Array<Partial<HostScopeRevisions>> = []
    const completed: Array<Partial<HostScopeRevisions>> = []
    const scheduler = createScheduler(
      async (id) => ({ id }),
      observations,
      events,
      (_call, revisions) => {
        guarded.push(revisions)
        return null
      },
      undefined,
      undefined,
      undefined,
      (_call, _observation, revisions) => completed.push(revisions)
    )

    await scheduler.execute([toolCall(1)], true, { canvas: 7 })

    expect(guarded).toEqual([{ canvas: 7 }])
    expect(completed).toEqual([{ canvas: 7 }])
  })

  it('Harness 硬上限立即逃逸，不包装成可重试的工具失败', async () => {
    const stop = new AgentStopPolicyExceededError('MAX_TOOL_CALLS', '测试硬上限')
    const scheduler = createScheduler(
      async (id) => ({ id }),
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => { throw stop }
    )

    await expect(scheduler.execute([toolCall(1)], true, {})).rejects.toBe(stop)
  })

  it('宿主画布编译不占模型租约槽，并以一次提交审批完成原生批次', async () => {
    const invoked: string[] = []
    const events: AgentEventInput[] = []
    const observations: AgentToolObservation[] = []
    const revisions = {
      navigation: 0, generation: 0, canvas: 1, toolbox: 0, assets: 0,
    }
    const registry = createBuiltinAgentToolRegistry(async (operation) => {
      const id = operation.capability.id
      invoked.push(id)
      const input = operation.capability.input as {
        projectId?: string
        operations?: Array<Record<string, unknown>>
        planRef?: string
      }
      const data = id === 'plan_canvas_batch'
        ? {
            planRef: 'plan-1', projectId: input.projectId ?? 'project-1',
            operationCount: input.operations?.length ?? 0,
            operations: input.operations ?? [], reversible: true,
            revision: 0, scopeRevisions: { ...revisions, canvas: 0 },
          }
        : {
            planRef: input.planRef ?? 'plan-1', projectId: 'project-1',
            appliedOperations: [
              { index: 0, kind: 'add_node', nodeId: 'node-1' },
              { index: 1, kind: 'add_node', nodeId: 'node-2' },
            ],
            operationCount: 2, undoRef: 'undo-batch-1', status: 'committed',
            revision: 1, scopeRevisions: revisions,
          }
      return {
        ok: true,
        data,
        resultingRevision: id === 'plan_canvas_batch' ? 0 : 1,
        resultingScopeRevisions: id === 'plan_canvas_batch'
          ? { ...revisions, canvas: 0 }
          : revisions,
      }
    })
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: () => hostContext(),
      appendPermissionAudit: async () => undefined,
    })
    let approvals = 0
    const scheduler = new AgentToolCallScheduler({
      runId: 'run-canvas-batch', threadId: 'thread-canvas-batch', approvalMode: 'ask',
      supportsParallelTools: true, gateway, registry,
      catalogPlanner: new AgentToolCatalogPlanner(registry),
      // 批次 plan/commit 没有披露给模型；只有模型实际请求的成员能力在活动集。
      activeToolNames: new Set(['add_canvas_node']),
      signal: new AbortController().signal,
      waitIfPaused: async () => undefined,
      throwIfCancelled: () => undefined,
      recordToolCall: () => undefined,
      recordProgress: () => undefined,
      setActiveToolCall: () => undefined,
      requestApproval: async (_call, approval) => {
        approvals += 1
        await gateway.resolveApproval(approval.approvalId, 'run-canvas-batch', 'approve')
        return 'approve'
      },
      onObservation: (_call, observation) => observations.push(observation),
      emit: (event) => events.push(event),
      onDiscoveredTools: () => undefined,
    })
    const placement = { mode: 'viewport_center' as const }
    await scheduler.execute([{
      toolCallId: 'add-1', toolName: 'add_canvas_node', dynamic: false,
      input: { projectId: 'project-1', nodeType: 'text', placement },
    }, {
      toolCallId: 'add-2', toolName: 'add_canvas_node', dynamic: false,
      input: { projectId: 'project-1', nodeType: 'image', placement },
    }], true, { canvas: 0 })

    expect(events.filter((event) => event.type === 'ToolFailed')).toEqual([])
    expect(invoked).toEqual(['plan_canvas_batch', 'commit_canvas_batch'])
    expect(approvals).toBe(1)
    expect(observations).toHaveLength(2)
    expect(events.filter((event) => event.type === 'ToolRequested').map((event) => (
      event.type === 'ToolRequested' ? event.toolName : ''
    ))).toEqual(['plan_canvas_batch', 'commit_canvas_batch'])
    expect(events.filter((event) => event.type === 'ToolCompleted')).toHaveLength(2)
  })
})
