import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { AgentToolGateway } from '../tools/gateway'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { AgentRunner } from './runner'

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-1',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCommands: ['create_visible_generation_task'],
    availableQueries: ['get_host_context'],
    capturedAt: new Date().toISOString(),
  }
}

function runRequest(goal: string): AgentStartRunRequest {
  const verifiedAt = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-1',
    goal,
    approvalMode: 'ask',
    profile: {
      id: 'profile-1',
      name: '测试配置',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 1_000, contextWindowBudget: 8_000 },
      verifications: [{
        providerId: 'provider',
        modelId: 'model',
        adapterVersion: 'test',
        verifiedAt,
        checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'].map((id) => ({
          id: id as 'text' | 'toolCall' | 'structuredOutput' | 'streaming' | 'usage' | 'cancel',
          status: 'passed' as const,
          latencyMs: 1,
        })),
        totalLatencyMs: 6,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        },
        cost: { status: 'unknown' },
      }],
      createdAt: verifiedAt,
      updatedAt: verifiedAt,
    },
    models: [{
      providerId: 'provider',
      modelId: 'model',
      displayName: '测试模型',
      adapter: 'openai-compatible',
      capabilities: {
        text: true,
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: true,
        parallelTools: false,
        jsonOutput: true,
        structuredOutputMode: 'json',
        reasoning: false,
        sampling: true,
        contextWindow: 32_000,
        maxOutputTokens: 4_000,
        usage: true,
      },
      enabled: true,
    }],
  }
}

function result(input: ModelStepInput, overrides: Partial<ModelStepResult> = {}): ModelStepResult {
  return {
    requestId: input.requestId,
    runId: input.runId,
    stepId: input.stepId,
    providerId: input.providerId,
    modelId: input.modelId,
    text: '已完成',
    reasoningText: '',
    structuredOutput: null,
    toolCalls: [],
    responseMessages: [{ role: 'assistant', content: '已完成' }],
    finishReason: 'stop',
    usage: {
      inputTokens: 10,
      inputNoCacheTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 2,
      textTokens: 2,
      reasoningTokens: 0,
      totalTokens: 12,
    },
    providerMetadataSummary: {},
    warnings: [],
    elapsedMs: 1,
    ...overrides,
  }
}

function createRuntime(registry = new AgentToolRegistry()) {
  const gateway = new AgentToolGateway({ registry, getHostContext: hostContext })
  return { registry, gateway }
}

describe('AgentRunner', () => {
  it('模糊请求经过 router 后完成 final，事件序号严格递增', async () => {
    const { registry, gateway } = createRuntime()
    const events: AgentEvent[] = []
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          text: '',
          structuredOutput: {
            intent: 'general', complexity: 'simple', path: 'primary', toolDomains: ['catalog'], reason: '一般问答',
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      return result(input)
    })
    const runner = new AgentRunner({
      runId: 'run-final',
      request: runRequest('请简短回答这个一般问题'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep: vi.fn(),
        onEvent: (event) => events.push(event),
        onTerminal: terminalResolve,
      },
    })
    runner.start()
    const state = await terminal
    expect(state).toMatchObject({ status: 'completed', finalText: '已完成' })
    expect(runModelStep).toHaveBeenCalledTimes(2)
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1))
    expect(events.some((event) => event.type === 'PlanUpdated')).toBe(true)
    expect(events.some((event) => event.type === 'VerificationCompleted' && event.passed)).toBe(true)
    expect(runner.getEventHistory()).toEqual(events)
  })

  it('R2 工具暂停审批，通过后回注 observation 并完成', async () => {
    const registry = new AgentToolRegistry()
    const executions: string[] = []
    registry.register(defineAgentTool({
      name: 'create_visible_generation_task',
      version: 1,
      title: '创建生成任务',
      description: '测试生成任务工具。',
      category: 'generation',
      side: 'backend',
      risk: 'R2',
      permission: 'generation:create',
      readOnly: false,
      destructive: false,
      openWorld: true,
      idempotent: true,
      timeoutMs: 1_000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
      supportsPreview: true,
      supportsUndo: false,
      requiredContext: ['generation'],
      inputSchema: z.object({ prompt: z.string() }).strict(),
      outputSchema: z.object({ taskId: z.string() }).strict(),
      aiInputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
      preview: () => ({ title: '创建任务', summary: '创建一个测试任务。', targetIds: {}, reversible: false, dataClasses: ['C1'] }),
      execute: async (input) => {
        executions.push(input.prompt)
        return { taskId: 'task-1' }
      },
      concurrencyKey: () => 'generation:test',
      targetIds: () => ({}),
      dataClasses: () => ['C1'],
      summarize: (output) => `已创建 ${output.taskId}`,
    }))
    const { gateway } = createRuntime(registry)
    let primaryCalls = 0
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          text: '',
          structuredOutput: {
            intent: 'generate',
            complexity: 'simple',
            reason: '用户要求生成图片',
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      primaryCalls += 1
      if (primaryCalls === 1) {
        return result(input, {
          text: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-1', toolName: 'create_visible_generation_task', input: { prompt: '测试' }, dynamic: false }],
          responseMessages: [{
            role: 'assistant',
            content: [
              { type: 'reasoning', text: '需要先提交生成任务。' },
              { type: 'tool-call', toolCallId: 'tool-1', toolName: 'create_visible_generation_task', input: { prompt: '测试' }, dynamic: false },
            ],
          }],
        })
      }
      expect(input.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'reasoning', text: '需要先提交生成任务。' }),
            expect.objectContaining({ type: 'tool-call', toolCallId: 'tool-1' }),
          ]),
        }),
      ]))
      return result(input, { text: '任务已创建', responseMessages: [{ role: 'assistant', content: '任务已创建' }] })
    })
    const runnerRef: { current: AgentRunner | null } = { current: null }
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runner = new AgentRunner({
      runId: 'run-tool',
      request: runRequest('生成一张测试图片'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep: vi.fn(),
        onEvent: (event) => {
          if (event.type === 'ApprovalRequired') runnerRef.current?.respondApproval(event.approval.approvalId, 'approve')
        },
        onTerminal: terminalResolve,
      },
    })
    runnerRef.current = runner
    runner.start()
    const state = await terminal
    expect(state.status).toBe('completed')
    expect(executions).toEqual(['测试'])
    expect(state.usage.toolCalls).toBe(1)
  })

  it('取消会终止状态并传播到当前模型请求', () => {
    const { registry, gateway } = createRuntime()
    const cancelModelStep = vi.fn()
    const runner = new AgentRunner({
      runId: 'run-cancel',
      request: runRequest('一个模糊请求'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep: () => new Promise(() => undefined),
        cancelModelStep,
      },
    })
    runner.start()
    const state = runner.cancel('测试取消')
    expect(state.status).toBe('cancelled')
    expect(cancelModelStep).toHaveBeenCalledWith(expect.stringContaining('run-cancel:router:'))
  })
})
