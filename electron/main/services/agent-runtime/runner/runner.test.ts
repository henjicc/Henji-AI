import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import { AGENT_SESSION_ENTRY_SCHEMA_VERSION, agentSessionEntrySchema } from '../../../../../src/core/assistant/session'
import {
  ProviderModelStepError,
  type ModelStepEvent,
  type ModelStepInput,
  type ModelStepResult,
} from '@henjicc/ai-sdk'
import { AgentToolGateway } from '../tools/gateway'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentRunner } from './runner'
import * as approvalLogging from './approval-logging'
import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'

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
    availableCapabilities: ['create_visible_generation_task', 'get_host_context'],
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
  const gateway = new AgentToolGateway({
    registry,
    getHostContext: hostContext,
    appendPermissionAudit: async () => {},
  })
  return { registry, gateway }
}

describe('AgentRunner', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('外部任务续跑继承源写入回执，并在一次权威读取后封存成功', async () => {
    const registry = new AgentToolRegistry()
    const readTask = vi.fn(async () => ({ task: { id: 'task-1', status: 'success' } }))
    registry.register(defineAgentTool({
      name: 'get_generation_task', version: 1, title: '读取生成任务',
      description: '读取外部生成任务的权威状态。', category: 'generation', side: 'backend',
      risk: 'R0', permission: 'generation:read', readOnly: true, destructive: false,
      openWorld: false, idempotent: true, timeoutMs: 1_000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false,
      supportsUndo: false, requiredContext: ['generation'],
      inputSchema: z.object({ taskId: z.string() }).strict(),
      outputSchema: z.object({ task: z.object({ id: z.string(), status: z.string() }).strict() }).strict(),
      aiInputSchema: {
        type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'],
        additionalProperties: false,
      },
      capability: {
        id: 'get_generation_task', domain: 'generation', aliases: [], dataClasses: ['C1'],
        acceptsRefs: ['generation.task'], producesRefs: ['generation.task', 'generation.result'],
        availability: [], concurrencyKey: 'generation', readOnly: true,
        control: { impacts: [{
          effect: 'observe', entityTypes: ['generation.task', 'generation.result'], propertyIds: [],
          revisionScopes: ['generation'], verificationRequired: false,
        }] },
        resolveObservedEffects: (input: { taskId: string }) => [{
          effect: 'observe', entityTypes: ['generation.task', 'generation.result'], propertyIds: [],
          targetRefs: [{ kind: 'generation.task', id: input.taskId }], count: 1,
          verified: true, evidence: [`generation.task:${input.taskId}:success`],
        }],
      } as never,
      execute: readTask, concurrencyKey: (input) => `generation:${input.taskId}`,
      targetIds: (input) => ({ taskId: input.taskId }), dataClasses: () => ['C1'],
      summarize: () => '生成任务已成功。',
    }))
    const { gateway } = createRuntime(registry)
    const recoveryContext = createAgentWorkingSummary('生成一张图片')
    recoveryContext.route = {
      intent: 'generate', summary: '等待外部生成完成', toolDomains: ['generation'], explicitUserIntent: true,
    }
    // 真实外部任务终态会推进 generation revision。子运行启动时会将这个
    // 正常变化标记为 resume_read_only；宿主权威读取成功后必须在同一回合清除。
    recoveryContext.recovery = {
      mode: 'resume_read_only', reason: '宿主 revision 已变化，恢复后先重新读取状态。',
      toolName: null, toolCategory: null,
    }
    recoveryContext.unresolvedItems = [
      '恢复时宿主作用域已变化：generation；后续工具必须使用新 revision。',
    ]
    const request: AgentStartRunRequest = {
      ...runRequest('生成任务 task-1 已报告状态 success，请完成续接。'),
      externalContinuation: {
        waitId: 'wait-1', sourceRunId: 'source-run', taskId: 'task-1', observedStatus: 'success',
        sourceTotalTokens: 100, sourceKnownCostUsd: null,
        sourceEffects: [{
          effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
          targetRefs: [{ kind: 'generation.task', id: 'task-1' }], count: 1,
          verified: false, evidence: ['generation.task:task-1:submitted'],
        }],
      },
    }
    const events: AgentEvent[] = []
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runner = new AgentRunner({
      runId: 'continuation-run', request, recoveryContext,
      dependencies: {
        registry, gateway, getHostContext: hostContext,
        runModelStep: async (input) => {
          // 续跑的说明回合仍然带着工具。封存点前移之后不再在模型请求前撤掉工具——
          // 模型如果发现事情没做完，得有出口；重复提交由 assertNoResubmit 单独拦。
          return result(input, {
            text: '图片生成已经完成，权威任务状态为成功。',
            responseMessages: [{ role: 'assistant', content: '图片生成已经完成，权威任务状态为成功。' }],
          })
        },
        cancelModelStep: vi.fn(), onEvent: (event) => events.push(event), onTerminal: terminalResolve,
      },
    })

    runner.start()
    const state = await terminal

    expect(readTask).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({ status: 'completed' })
    expect(state.executionOutcome).toMatchObject({
      status: 'sealed_success',
      effects: [expect.objectContaining({
        effect: 'execute', targetRefs: [{ kind: 'generation.task', id: 'task-1' }],
      })],
    })
    expect(events.some((event) => event.type === 'ExecutionOutcomeSealed')).toBe(true)
    expect(events.some((event) => event.type === 'ToolFailed')).toBe(false)
    expect(state.workingSummary?.recovery.mode).toBe('none')
    expect(state.workingSummary?.unresolvedItems).toEqual([])
  })

  it('外部生成失败时权威读取一次后立即终止，不再请求模型或重复读取', async () => {
    const registry = new AgentToolRegistry()
    const readTask = vi.fn(async () => ({ task: { id: 'task-failed', status: 'error' } }))
    registry.register(defineAgentTool({
      name: 'get_generation_task', version: 1, title: '读取生成任务',
      description: '读取外部生成任务的权威状态。', category: 'generation', side: 'backend',
      risk: 'R0', permission: 'generation:read', readOnly: true, destructive: false,
      openWorld: false, idempotent: true, timeoutMs: 1_000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false,
      supportsUndo: false, requiredContext: ['generation'],
      inputSchema: z.object({ taskId: z.string() }).strict(),
      outputSchema: z.object({ task: z.object({ id: z.string(), status: z.string() }).strict() }).strict(),
      aiInputSchema: {
        type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'],
        additionalProperties: false,
      },
      capability: {
        id: 'get_generation_task', domain: 'generation', aliases: [], dataClasses: ['C1'],
        acceptsRefs: ['generation.task'], producesRefs: ['generation.task'],
        availability: [], concurrencyKey: 'generation', readOnly: true,
        control: { impacts: [{
          effect: 'observe', entityTypes: ['generation.task'], propertyIds: [],
          revisionScopes: ['generation'], verificationRequired: false,
        }] },
        resolveObservedEffects: (input: { taskId: string }) => [{
          effect: 'observe', entityTypes: ['generation.task'], propertyIds: [],
          targetRefs: [{ kind: 'generation.task', id: input.taskId }], count: 1,
          verified: true, evidence: [`generation.task:${input.taskId}:error`],
        }],
      } as never,
      execute: readTask, concurrencyKey: (input) => `generation:${input.taskId}`,
      targetIds: (input) => ({ taskId: input.taskId }), dataClasses: () => ['C1'],
      summarize: () => '生成任务失败。',
    }))
    const { gateway } = createRuntime(registry)
    const recoveryContext = createAgentWorkingSummary('生成一张图片')
    recoveryContext.route = {
      intent: 'generate', summary: '等待外部生成完成', toolDomains: ['generation'], explicitUserIntent: true,
    }
    const request: AgentStartRunRequest = {
      ...runRequest('生成任务 task-failed 已报告状态 error，请完成续接。'),
      externalContinuation: {
        waitId: 'wait-failed', sourceRunId: 'source-run', taskId: 'task-failed', observedStatus: 'error',
        sourceTotalTokens: 100, sourceKnownCostUsd: null,
        sourceEffects: [{
          effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
          targetRefs: [{ kind: 'generation.task', id: 'task-failed' }], count: 1,
          verified: false, evidence: ['generation.task:task-failed:submitted'],
        }],
      },
    }
    const runModelStep = vi.fn(async (input: ModelStepInput) => result(input))
    const events: AgentEvent[] = []
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runner = new AgentRunner({
      runId: 'failed-continuation-run', request, recoveryContext,
      dependencies: {
        registry, gateway, getHostContext: hostContext, runModelStep,
        cancelModelStep: vi.fn(), onEvent: (event) => events.push(event), onTerminal: terminalResolve,
      },
    })

    runner.start()
    const state = await terminal

    expect(readTask).toHaveBeenCalledTimes(1)
    expect(runModelStep).not.toHaveBeenCalled()
    expect(state).toMatchObject({
      status: 'failed',
      error: { code: 'SCRIPT_STEP_FAILED', retryable: false, recovery: 'none' },
    })
    expect(events.filter((event) => event.type === 'RunFailed')).toHaveLength(1)
  })

  it.each([
    { finalText: '设置已经修改并验证。', expectedStatus: 'completed' as const },
    { finalText: '', expectedStatus: 'completed_with_warning' as const },
  ])('一段脚本做完就在给出最终答复时封存，最终说明为“$finalText”时不再开启第三轮', async ({ finalText, expectedStatus }) => {
    const registry = new AgentToolRegistry()
    registry.register(defineAgentTool({
      name: 'run_henji_script', version: 1, title: '运行 Henji Script',
      description: '以受控脚本修改并验证设置。', category: 'application', side: 'backend',
      risk: 'R0', permission: 'settings:write', readOnly: false, destructive: false,
      openWorld: false, idempotent: false, timeoutMs: 1_000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false,
      supportsUndo: false, requiredContext: ['settings'],
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ status: z.literal('completed'), scopeRevisions: z.record(z.string(), z.number()) }).strict(),
      aiInputSchema: {
        type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
        additionalProperties: false,
      },
      capability: {
        id: 'run_henji_script', domain: 'application', aliases: [], dataClasses: ['C0'],
        acceptsRefs: [], producesRefs: ['settings.registry'], availability: [],
        concurrencyKey: 'settings', readOnly: false,
        control: { impacts: [{
          effect: 'update', entityTypes: ['settings.registry'], propertyIds: [],
          revisionScopes: ['settings'], verificationRequired: true,
        }] },
        resolveObservedEffects: () => [{
          effect: 'update', entityTypes: ['settings.registry'], propertyIds: [],
          targetRefs: [{ kind: 'settings.registry', id: 'default' }], count: 1,
          verified: true, evidence: ['settings.registry:default'],
        }],
      } as never,
      execute: async () => ({
        status: 'completed' as const,
        scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0, settings: 1, surface: 0 },
      }),
      concurrencyKey: () => 'settings', targetIds: () => ({}), dataClasses: () => ['C0'],
      summarize: () => '设置程序已完成并验证。',
    }))
    const { gateway } = createRuntime(registry)
    const programEvents: AgentEvent[] = []
    let primaryTurns = 0
    let presentationToolNames: string[] | null = null
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      primaryTurns += 1
      if (primaryTurns === 1) {
        expect((input.tools ?? []).map((tool) => tool.name)).toContain('run_henji_script')
        const toolCall = {
          toolCallId: 'settings-program', toolName: 'run_henji_script',
          input: { value: 'test' }, dynamic: false,
        }
        return result(input, {
          text: '',
          toolCalls: [toolCall],
          responseMessages: [{ role: 'assistant', content: [{ type: 'tool-call', ...toolCall }] }],
          finishReason: 'tool-calls',
        })
      }
      presentationToolNames = (input.tools ?? []).map((tool) => tool.name)
      return result(input, { text: finalText })
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runner = new AgentRunner({
      runId: 'program-presentation-run',
      request: runRequest('把界面主题设置改成测试值'),
      dependencies: {
        registry, gateway, getHostContext: hostContext, runModelStep,
        cancelModelStep: vi.fn(), onEvent: (event) => programEvents.push(event), onTerminal: terminalResolve,
      },
    })

    runner.start()
    const state = await terminal
    expect(state.status).toBe(expectedStatus)
    expect(state.executionOutcome.status).toBe('sealed_success')
    expect(state.presentationOutcome.status)
      .toBe(expectedStatus === 'completed' ? 'generated' : 'fallback')
    /*
     * 说明回合仍然带着工具。旧实现在模型请求前判"任务图结算完成"就把工具整个撤掉，于是模型
     * 即使知道用户要的颜色还没设，也只能回一句"需要我确认时回复一声"。现在封存发生在模型
     * 自己给出最终答复之后，撤工具既没必要也有害。
     */
    expect(presentationToolNames).toContain('run_henji_script')
    expect(programEvents.some((event) => event.type === 'ToolCompleted')).toBe(true)
    expect(programEvents.some((event) => event.type === 'ToolFailed')).toBe(false)
    expect(runModelStep).toHaveBeenCalledTimes(2)
  })

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
            intent: 'general', toolDomains: ['catalog'], reason: '一般问答',
            explicitUserIntent: false,
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      return result(input)
    })
    const runner = new AgentRunner({
      runId: 'run-final',
      request: runRequest('请简短回答这个一般问题'),
      conversationHistory: [
        { role: 'user', content: '第一轮约束：回答必须简短' },
        { role: 'assistant', content: '已记住这个约束' },
      ],
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
    const primaryInput = runModelStep.mock.calls.find(([input]) => input.stepId === 'step-1')?.[0]
    expect(primaryInput?.messages).toEqual(expect.arrayContaining([
      { role: 'user', content: '第一轮约束：回答必须简短' },
      { role: 'assistant', content: '已记住这个约束' },
    ]))
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1))
    expect(events.some((event) => event.type === 'PlanUpdated')).toBe(true)
    expect(events.some((event) => event.type === 'VerificationCompleted' && event.passed)).toBe(true)
    expect(runner.getEventHistory()).toEqual(events)
  })

  it('默认循环超过旧 12 轮和 24 次工具后仍由模型最终答复自然结束', async () => {
    const registry = new AgentToolRegistry()
    registry.register(defineAgentTool({
      name: 'read_long_chain_fact',
      version: 1,
      title: '读取长链路事实',
      description: '为长链路循环测试返回确定性事实。',
      capability: {
        id: 'read_long_chain_fact', domain: 'diagnostics', aliases: [], dataClasses: ['C0'],
        acceptsRefs: [], producesRefs: [], availability: [], concurrencyKey: 'diagnostics',
        control: { impacts: [{
          effect: 'observe', entityTypes: ['diagnostics.fact'], propertyIds: [],
          revisionScopes: [], verificationRequired: false,
        }] },
        resolveObservedEffects: (input: { index: number }) => [{
          effect: 'observe', entityTypes: ['diagnostics.fact'], propertyIds: [], targetRefs: [],
          count: 1, verified: true, evidence: [`fact:${input.index}`],
        }],
      } as never,
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
      inputSchema: z.object({ index: z.number().int() }).strict(),
      outputSchema: z.object({ index: z.number().int() }).strict(),
      aiInputSchema: {
        type: 'object',
        properties: { index: { type: 'number' } },
        required: ['index'],
        additionalProperties: false,
      },
      execute: async (input) => ({ index: input.index }),
      concurrencyKey: (input) => `long-chain:${input.index}`,
      targetIds: () => ({}),
      dataClasses: () => ['C0'],
      summarize: (output) => `已读取事实 ${output.index}`,
    }))
    const { gateway } = createRuntime(registry)
    let primaryTurn = 0
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          text: '',
          structuredOutput: {
            intent: 'general',
            toolDomains: ['diagnostics'],
            reason: '长链路读取',
            explicitUserIntent: false,
            taskFacets: [{
              facetId: 'long_chain', domain: 'diagnostics', goal: '读取 26 个独立事实',
              targetEntityTypes: ['diagnostics.fact'], observationKinds: [],
              capabilityKinds: ['observe'], targetSurfaceId: null, dependsOn: [], parallelizable: false,
              completionConditions: ['26 个事实均有结构化读取证据。'],
              requiredEffects: [{
                effectId: 'long_chain_effect', effect: 'observe', entityTypes: ['diagnostics.fact'],
                propertyIds: [], minimumCount: 26, targetRefs: [], verificationRequired: false,
                actionGroupId: 'long_chain_actions',
              }],
              uncertainties: [], confidence: 1,
            }],
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      primaryTurn += 1
      if (primaryTurn > 13) return result(input, { text: '长链路已完成' })
      const toolCalls = [0, 1].map((offset) => ({
        toolCallId: `call-${primaryTurn}-${offset}`,
        toolName: 'read_long_chain_fact',
        input: { index: primaryTurn * 10 + offset },
        dynamic: false,
      }))
      return result(input, {
        text: '',
        toolCalls,
        responseMessages: [{
          role: 'assistant',
          content: toolCalls.map((call) => ({ type: 'tool-call', ...call })),
        }],
        finishReason: 'tool-calls',
      })
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    new AgentRunner({
      runId: 'run-long-chain',
      request: runRequest('完成一个长链路读取任务'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep: vi.fn(),
        onTerminal: terminalResolve,
      },
    }).start()

    await expect(terminal).resolves.toMatchObject({
      status: 'completed',
      finalText: '长链路已完成',
      usage: { turns: 14, toolCalls: 26 },
    })
  })

  it('鉴权、计费等非瞬态 Provider 错误不进入 Agent 语义重试', async () => {
    const { registry, gateway } = createRuntime()
    const events: AgentEvent[] = []
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          structuredOutput: {
            intent: 'general', explicitUserIntent: false,
            toolDomains: ['catalog'], reason: '一般问答',
          },
        })
      }
      throw new ProviderModelStepError({
        code: 'UNAUTHORIZED', category: 'authentication', status: 401,
        retryable: false, retryAfterMs: null,
        providerId: input.providerId, modelId: input.modelId,
        requestId: input.requestId, message: '模型供应商鉴权失败',
      })
    })
    const runner = new AgentRunner({
      runId: 'run-auth-failure',
      request: runRequest('回答问题'),
      dependencies: {
        registry, gateway, getHostContext: hostContext, runModelStep,
        cancelModelStep: vi.fn(), onEvent: (event) => events.push(event),
        onTerminal: terminalResolve,
      },
    })
    runner.start()
    await expect(terminal).resolves.toMatchObject({ status: 'failed' })
    expect(runModelStep).toHaveBeenCalledTimes(2)
    expect(events.some((event) => event.type === 'ModelRetrying')).toBe(false)
  })

  it('澄清问题使用稳定 waitId 恢复原运行且回答只消费一次', async () => {
    // 澄清由模型显式调用 ask_user 触发，不再从最终答复的措辞里嗅探问号。
    const { registry, gateway } = createRuntime(createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    }))
    let primaryCalls = 0
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          text: '',
          structuredOutput: {
            intent: 'general', explicitUserIntent: false,
            toolDomains: ['catalog'], reason: '需要澄清',
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      primaryCalls += 1
      if (primaryCalls === 1) {
        const call = {
          toolCallId: 'call-ask-layout',
          toolName: 'ask_user',
          input: { question: '请确认使用横版还是竖版？', reason: '版式会决定后续所有尺寸参数。' },
        }
        return result(input, {
          text: '',
          toolCalls: [{ ...call, dynamic: false }],
          responseMessages: [{ role: 'assistant', content: [{ type: 'tool-call', ...call }] }],
        })
      }
      expect(input.messages).toEqual(expect.arrayContaining([
        { role: 'user', content: '使用横版' },
      ]))
      return result(input, {
        text: '已确认使用横版。',
        responseMessages: [{ role: 'assistant', content: '已确认使用横版。' }],
      })
    })
    const runnerRef: { current: AgentRunner | null } = { current: null }
    let duplicateRejected = false
    const runner = new AgentRunner({
      runId: 'run-clarification',
      request: runRequest('帮我选择一个版式'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep: vi.fn(),
        onEvent: (event) => {
          if (event.type !== 'ClarificationRequired') return
          if (!event.waitId) throw new Error('expected clarification waitId')
          runnerRef.current?.respondClarification(event.waitId, '使用横版')
          try {
            runnerRef.current?.respondClarification(event.waitId, '重复回答')
          } catch {
            duplicateRejected = true
          }
        },
        onTerminal: terminalResolve,
      },
    })
    runnerRef.current = runner
    runner.start()
    const state = await terminal
    expect(state).toMatchObject({ status: 'completed', finalText: '已确认使用横版。' })
    expect(duplicateRejected).toBe(true)
    expect(primaryCalls).toBe(2)
  })

  it('最终回复前到达的当前任务补充会在 settled 边界触发下一轮', async () => {
    const { registry, gateway } = createRuntime()
    let consumeCalls = 0
    let primaryCalls = 0
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          text: '',
          structuredOutput: {
            intent: 'general', explicitUserIntent: false,
            toolDomains: ['catalog'], reason: '一般问答',
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      primaryCalls += 1
      if (primaryCalls === 2) {
        expect(input.messages).toEqual(expect.arrayContaining([
          { role: 'user', content: '再加一个约束' },
        ]))
      }
      return result(input, {
        text: primaryCalls === 1 ? '第一版回答' : '包含补充约束的回答',
        responseMessages: [{
          role: 'assistant',
          content: primaryCalls === 1 ? '第一版回答' : '包含补充约束的回答',
        }],
      })
    })
    const runner = new AgentRunner({
      runId: 'run-current-message',
      request: runRequest('先给一个回答'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep: vi.fn(),
        consumeCurrentTaskMessages: async () => {
          consumeCalls += 1
          if (consumeCalls !== 2) return []
          return [agentSessionEntrySchema.parse({
            schemaVersion: AGENT_SESSION_ENTRY_SCHEMA_VERSION,
            entryId: 'queued-1', threadId: 'thread-1', sequence: 2,
            runId: 'run-current-message', turn: null, kind: 'queued_message',
            payload: {
              clientMessageId: 'client-1', content: '再加一个约束', mode: 'current_task',
              status: 'consumed', targetRunId: 'run-current-message',
              consumedByRunId: 'run-current-message',
            },
            status: 'active', parentEntryId: null, createdAt: new Date().toISOString(),
          })]
        },
        onTerminal: terminalResolve,
      },
    })
    runner.start()
    const state = await terminal
    expect(state.finalText).toBe('包含补充约束的回答')
    expect(primaryCalls).toBe(2)
  })

  it('R2 工具暂停审批，通过后回注 observation 并完成', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-30T08:00:00.000Z') })
    const registry = new AgentToolRegistry()
    const executions: string[] = []
    registry.register(defineAgentTool({
      name: 'run_henji_script',
      version: 1,
      title: '创建生成任务',
      description: '测试生成任务工具。',
      capability: {
        id: 'run_henji_script', domain: 'application', aliases: [], dataClasses: ['C1'],
        acceptsRefs: [], producesRefs: ['generation.task'], availability: [], concurrencyKey: 'generation',
        control: { impacts: [{
          effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
          revisionScopes: ['generation'], verificationRequired: true,
        }] },
        resolveObservedEffects: (_input: { prompt: string }, output: { taskId: string }) => [{
          effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
          targetRefs: [{ kind: 'generation.task', id: output.taskId }], count: 1,
          verified: true, evidence: [`task:${output.taskId}`],
        }],
      } as never,
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
    let releaseApprovalAudit: () => void = () => undefined
    let markApprovalAuditStarted: () => void = () => undefined
    const approvalAuditStarted = new Promise<void>((resolve) => {
      markApprovalAuditStarted = resolve
    })
    const approvalAuditGate = new Promise<void>((resolve) => {
      releaseApprovalAudit = resolve
    })
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: hostContext,
      appendPermissionAudit: async (fact) => {
        if (fact.event !== 'approved') return
        markApprovalAuditStarted()
        await approvalAuditGate
      },
    })
    let primaryCalls = 0
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          text: '',
          structuredOutput: {
            intent: 'generate',
            reason: '用户要求生成图片',
            explicitUserIntent: true,
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      primaryCalls += 1
      if (primaryCalls === 1) {
        return result(input, {
          text: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-1', toolName: 'run_henji_script', input: { prompt: '测试' }, dynamic: false }],
          responseMessages: [{
            role: 'assistant',
            content: [
              { type: 'reasoning', text: '需要先提交生成任务。' },
              { type: 'tool-call', toolCallId: 'tool-1', toolName: 'run_henji_script', input: { prompt: '测试' }, dynamic: false },
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
    let approvalResponse: Promise<AgentRunState> | undefined
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
          if (event.type === 'ApprovalRequired') {
            approvalResponse = runnerRef.current?.respondApproval(
              event.approval.approvalId,
              'approve'
            )
          }
        },
        onTerminal: terminalResolve,
      },
    })
    runnerRef.current = runner
    runner.start()
    await approvalAuditStarted
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    expect(executions).toEqual([])
    expect(runner.getState().status).toBe('waiting_approval')

    releaseApprovalAudit()
    const response = approvalResponse
    if (!response) throw new Error('expected approval response')
    await response
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

  it('cancelAndWait 立即进入取消状态，但会等待运行终止审计完成', async () => {
    const { registry, gateway } = createRuntime()
    let releaseAudit: () => void = () => undefined
    let markAuditStarted: () => void = () => undefined
    const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve })
    const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve })
    vi.spyOn(gateway, 'expireRunApprovals').mockImplementation(async () => {
      markAuditStarted()
      await auditGate
    })
    const runner = new AgentRunner({
      runId: 'run-cancel-wait',
      request: runRequest('等待取消审计'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep: () => new Promise(() => undefined),
        cancelModelStep: vi.fn(),
      },
    })

    runner.start()
    let settled = false
    const cancellation = runner.cancelAndWait('测试等待审计').then((state) => {
      settled = true
      return state
    })

    expect(runner.getState().status).toBe('cancelled')
    await auditStarted
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseAudit()
    await expect(cancellation).resolves.toMatchObject({ status: 'cancelled' })
    expect(settled).toBe(true)
  })

  it('运行终止审计失败时仍安全取消并记录结构化失败事件', async () => {
    const { registry, gateway } = createRuntime()
    const auditError = new Error('permission audit unavailable')
    vi.spyOn(gateway, 'expireRunApprovals').mockRejectedValue(auditError)
    const logFailure = vi.spyOn(approvalLogging, 'logApprovalRunExpiryFailure')
      .mockImplementation(() => undefined)
    const runner = new AgentRunner({
      runId: 'run-cancel-audit-failure',
      request: runRequest('取消审计失败'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep: () => new Promise(() => undefined),
        cancelModelStep: vi.fn(),
      },
    })

    runner.start()
    await expect(runner.cancelAndWait('测试审计失败')).resolves.toMatchObject({
      status: 'cancelled',
    })
    expect(logFailure).toHaveBeenCalledWith('run-cancel-audit-failure', auditError)
  })

  it('定时事件持久化失败时取消模型请求并以原始错误受控终止', async () => {
    vi.useFakeTimers()
    const { registry, gateway } = createRuntime()
    let rejectPrimary: (error: Error) => void = () => undefined
    let primaryStartedResolve: () => void = () => undefined
    const primaryStarted = new Promise<void>((resolve) => { primaryStartedResolve = resolve })
    const runModelStep = vi.fn((
      input: ModelStepInput,
      emit: (event: ModelStepEvent) => void
    ): Promise<ModelStepResult> => {
      if (input.stepId.startsWith('router:')) {
        return Promise.resolve(result(input, {
          text: '',
          structuredOutput: {
            intent: 'general', explicitUserIntent: false,
            toolDomains: ['catalog'], reason: '一般问答',
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        }))
      }
      emit({ type: 'TextDelta', text: '正在回答' })
      primaryStartedResolve()
      return new Promise<ModelStepResult>((_resolve, reject) => {
        rejectPrimary = reject
      })
    })
    const cancelModelStep = vi.fn(() => rejectPrimary(new Error('[model_cancelled] 已取消')))
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runner = new AgentRunner({
      runId: 'run-event-failure',
      request: runRequest('测试异步事件失败'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep,
        onEvent: (event) => {
          if (event.type === 'ModelDelta' || cancelModelStep.mock.calls.length > 0) {
            throw new Error('[event_flush_failed] 事件持久化持续失败')
          }
        },
        onTerminal: terminalResolve,
      },
    })

    runner.start()
    await primaryStarted
    await vi.advanceTimersByTimeAsync(240)
    const state = await terminal

    expect(cancelModelStep).toHaveBeenCalledWith('run-event-failure:step-1')
    expect(state).toMatchObject({
      status: 'failed',
      error: { code: 'event_flush_failed', message: '事件持久化持续失败' },
    })
  })

  it('同步验证事件上报失败时不会误报为 completed', async () => {
    const { registry, gateway } = createRuntime()
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return result(input, {
          text: '',
          structuredOutput: {
            intent: 'general', explicitUserIntent: false,
            toolDomains: ['catalog'], reason: '一般问答',
          },
          responseMessages: [{ role: 'assistant', content: '' }],
        })
      }
      return result(input)
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const runner = new AgentRunner({
      runId: 'run-sync-event-failure',
      request: runRequest('测试同步事件失败'),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep: vi.fn(),
        onEvent: (event) => {
          if (event.type === 'VerificationCompleted') {
            throw new Error('[verification_event_failed] 验证事件持久化失败')
          }
        },
        onTerminal: terminalResolve,
      },
    })

    runner.start()
    await expect(terminal).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'verification_event_failed', message: '验证事件持久化失败' },
    })
  })
})



