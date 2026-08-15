import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  type AgentStartRunRequest,
} from '../../../../../src/core/assistant/runtimeContracts'
import type {
  ModelStepFinishReason,
  ModelStepInput,
  ModelStepMessage,
  ModelStepResult,
} from '../../../../../src/core/llm/modelStep'
import { AgentToolGateway } from '../tools/gateway'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { AgentRunner } from './runner'

const usage: ModelStepResult['usage'] = {
  inputTokens: 10,
  inputNoCacheTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 2,
  textTokens: 2,
  reasoningTokens: 0,
  totalTokens: 12,
}

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-model-output',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: ['get_host_context'],
    capturedAt: new Date().toISOString(),
  }
}

function runRequest(parallelTools = false): AgentStartRunRequest {
  const verifiedAt = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-model-output',
    goal: '验证模型输出完整性',
    approvalMode: 'ask',
    profile: {
      id: 'profile-model-output',
      name: '模型输出完整性测试',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: {
        timeoutMs: 5_000,
        maxRetries: 0,
        maxOutputTokens: 1_000,
        contextWindowBudget: 8_000,
      },
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
        parallelTools,
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

function stepResult(
  input: ModelStepInput,
  overrides: Partial<ModelStepResult> = {}
): ModelStepResult {
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
    usage,
    providerMetadataSummary: {},
    warnings: [],
    elapsedMs: 1,
    ...overrides,
  }
}

function routerResult(input: ModelStepInput): ModelStepResult {
  return stepResult(input, {
    text: '',
    structuredOutput: {
      intent: 'general',
      complexity: 'simple',
      path: 'primary',
      toolDomains: ['diagnostics'],
      reason: '测试模型输出完整性',
      explicitUserIntent: false,
    },
    responseMessages: [{ role: 'assistant', content: '' }],
  })
}

function registerProbeTool(registry: AgentToolRegistry, executions: string[]): void {
  registry.register(defineAgentTool({
    name: 'get_host_context',
    version: 1,
    title: '读取宿主上下文',
    description: '用于验证输出完整性的只读工具。',
    category: 'diagnostics',
    side: 'backend',
    risk: 'R0',
    permission: 'host:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    execute: async (input) => {
      executions.push(input.value)
      return { value: input.value }
    },
    concurrencyKey: (input) => `probe:${input.value}`,
    targetIds: () => ({}),
    dataClasses: () => ['C0'],
    summarize: (output) => `读取到 ${output.value}`,
  }))
}

interface ScenarioResult {
  state: AgentRunState
  events: AgentEvent[]
  executions: string[]
  gatewayExecuteCalls: number
  nextTurnMessages: ModelStepMessage[]
}

async function runScenario(
  finishReason: ModelStepFinishReason,
  values: string[],
  parallelTools = false
): Promise<ScenarioResult> {
  const registry = new AgentToolRegistry()
  const executions: string[] = []
  registerProbeTool(registry, executions)
  const gateway = new AgentToolGateway({
    registry,
    getHostContext: hostContext,
    appendPermissionAudit: async () => undefined,
  })
  const gatewayExecute = vi.spyOn(gateway, 'execute')
  const events: AgentEvent[] = []
  let primaryCalls = 0
  let nextTurnMessages: ModelStepMessage[] = []
  const runModelStep = vi.fn(async (input: ModelStepInput) => {
    if (input.stepId.startsWith('router:')) return routerResult(input)
    primaryCalls += 1
    if (primaryCalls === 1) {
      const toolCalls = values.map((value) => ({
        toolCallId: `call-${value}`,
        toolName: 'get_host_context',
        input: { value },
        dynamic: false,
      }))
      return stepResult(input, {
        text: '',
        finishReason,
        toolCalls,
        responseMessages: [{
          role: 'assistant',
          content: toolCalls.map((call) => ({ type: 'tool-call', ...call })),
        }],
      })
    }
    nextTurnMessages = input.messages
    const finalText = finishReason === 'stop'
      ? '读取工具已完成。'
      : '上一模型输出不完整，工具调用失败且未执行。'
    return stepResult(input, {
      text: finalText,
      responseMessages: [{ role: 'assistant', content: finalText }],
    })
  })
  let resolveTerminal: (state: AgentRunState) => void = () => undefined
  const terminal = new Promise<AgentRunState>((resolve) => { resolveTerminal = resolve })
  const runner = new AgentRunner({
    runId: `run-output-${finishReason}-${values.join('-')}`,
    request: runRequest(parallelTools),
    dependencies: {
      registry,
      gateway,
      getHostContext: hostContext,
      runModelStep,
      cancelModelStep: vi.fn(),
      onEvent: (event) => events.push(event),
      onTerminal: resolveTerminal,
    },
  })
  runner.start()
  const state = await terminal
  return {
    state,
    events,
    executions,
    gatewayExecuteCalls: gatewayExecute.mock.calls.length,
    nextTurnMessages,
  }
}

describe('AgentRunner 模型输出完整性', () => {
  it.each([
    'length',
    'content-filter',
    'error',
    'other',
  ] as const)('%s 工具调用不进入网关、审批、账本或工具预算', async (finishReason) => {
    const result = await runScenario(finishReason, [finishReason])

    expect(result.state.status).toBe('completed')
    expect(result.state.usage.toolCalls).toBe(0)
    expect(result.executions).toEqual([])
    expect(result.gatewayExecuteCalls).toBe(0)
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'ToolRequested' }),
      expect.objectContaining({
        type: 'ToolFailed',
        error: expect.objectContaining({ code: 'MODEL_OUTPUT_INCOMPLETE' }),
      }),
    ]))
    expect(result.events.some((event) => (
      event.type === 'ToolStarted' || event.type === 'ApprovalRequired'
    ))).toBe(false)
    expect(JSON.stringify(result.nextTurnMessages)).toContain('[模型输出完整性恢复要求]')
    expect(result.nextTurnMessages.some((message) => message.role === 'tool')).toBe(false)
  })

  it('并行模型返回多个截断工具调用时全部 fail-closed', async () => {
    const result = await runScenario('length', ['a', 'b', 'c'], true)

    expect(result.state.usage.toolCalls).toBe(0)
    expect(result.executions).toEqual([])
    expect(result.gatewayExecuteCalls).toBe(0)
    expect(result.events.filter((event) => event.type === 'ToolRequested')).toHaveLength(3)
    expect(result.events.filter((event) => event.type === 'ToolFailed')).toHaveLength(3)
    expect(result.events.some((event) => event.type === 'ToolStarted')).toBe(false)
  })

  it('stop 携带完整工具调用时保留兼容执行路径', async () => {
    const result = await runScenario('stop', ['compatible'])

    expect(result.state.status).toBe('completed')
    expect(result.state.usage.toolCalls).toBe(1)
    expect(result.executions).toEqual(['compatible'])
    expect(result.gatewayExecuteCalls).toBe(1)
  })

  it('取消后迟到返回的工具调用不会进入网关', async () => {
    const registry = new AgentToolRegistry()
    const executions: string[] = []
    registerProbeTool(registry, executions)
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: hostContext,
      appendPermissionAudit: async () => undefined,
    })
    const gatewayExecute = vi.spyOn(gateway, 'execute')
    let resolvePrimary: (result: ModelStepResult) => void = () => undefined
    let primaryInput: ModelStepInput | null = null
    let primaryStartedResolve: () => void = () => undefined
    const primaryStarted = new Promise<void>((resolve) => { primaryStartedResolve = resolve })
    const runModelStep = vi.fn((input: ModelStepInput): Promise<ModelStepResult> => {
      if (input.stepId.startsWith('router:')) return Promise.resolve(routerResult(input))
      primaryInput = input
      primaryStartedResolve()
      return new Promise<ModelStepResult>((resolve) => { resolvePrimary = resolve })
    })
    const cancelModelStep = vi.fn(() => {
      if (!primaryInput) return
      const call = {
        toolCallId: 'call-after-abort',
        toolName: 'get_host_context',
        input: { value: 'late' },
        dynamic: false,
      }
      resolvePrimary(stepResult(primaryInput, {
        finishReason: 'tool-calls',
        toolCalls: [call],
        responseMessages: [{
          role: 'assistant',
          content: [{ type: 'tool-call', ...call }],
        }],
      }))
    })
    const runner = new AgentRunner({
      runId: 'run-output-abort',
      request: runRequest(),
      dependencies: {
        registry,
        gateway,
        getHostContext: hostContext,
        runModelStep,
        cancelModelStep,
      },
    })

    runner.start()
    await primaryStarted
    expect(runner.cancel('测试取消').status).toBe('cancelled')
    await Promise.resolve()
    await Promise.resolve()

    expect(cancelModelStep).toHaveBeenCalledWith('run-output-abort:step-1')
    expect(executions).toEqual([])
    expect(gatewayExecute).not.toHaveBeenCalled()
    expect(runner.getState().status).toBe('cancelled')
  })
})

