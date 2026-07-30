import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { AgentToolCatalogPlanner } from '../context/catalog'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolGateway } from '../tools/gateway'
import { AgentToolRegistry } from '../tools/registry'
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
    availableCommands: [],
    availableQueries: [],
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
  executionGuard?: (call: ModelStepToolCall) => string | null,
  activeToolNames: ReadonlySet<string> = new Set(['read_test_resource', 'write_test_resource'])
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
  return new AgentToolCallScheduler({
    runId: 'run-scheduler',
    threadId: 'thread-scheduler',
    approvalMode: 'assistant_decides',
    supportsParallelTools: true,
    gateway,
    registry,
    catalogPlanner: new AgentToolCatalogPlanner(registry),
    activeToolNames,
    signal: new AbortController().signal,
    waitIfPaused: () => Promise.resolve(),
    throwIfCancelled: () => undefined,
    recordToolCall: () => undefined,
    recordProgress: () => undefined,
    setActiveToolCall: () => undefined,
    requestApproval: () => Promise.reject(new Error('只读工具不应请求审批')),
    onObservation: (_call, observation) => observations.push(observation),
    emit: (event) => events.push(event),
    onDiscoveredTools: () => undefined,
    executionGuard,
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
})
