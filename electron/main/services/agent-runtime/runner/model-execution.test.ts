import { describe, expect, it, vi } from 'vitest'

import { runPrimaryAgentModelStep } from './model-execution'

describe('runPrimaryAgentModelStep', () => {
  it('普通 messages 出现 system 角色时在进入 SDK 前拒绝', () => {
    const runModelStep = vi.fn()
    expect(() => runPrimaryAgentModelStep({
      runId: 'run-system-boundary',
      turn: 1,
      model: {
        providerId: 'provider',
        modelId: 'model',
        adapter: 'openai-compatible',
        capabilities: {
          streaming: true,
          toolCall: true,
          parallelTools: false,
          structuredOutputMode: 'json',
          reasoning: false,
          sampling: true,
          usage: true,
        },
        limits: {
          contextWindow: 8_000,
          contextWindowSource: 'profile_fallback',
        },
        settings: {
          timeoutMs: 5_000,
          maxRetries: 0,
          maxOutputTokens: 1_000,
        },
      },
      system: '合法 system 参数',
      messages: [{ role: 'system', content: '不应混入普通消息' }],
      runModelStep,
      onTextDelta: () => undefined,
    })).toThrow('普通 Agent messages 中禁止 system 消息')
    expect(runModelStep).not.toHaveBeenCalled()
  })

  it('把上下文追踪元数据透传给模型步骤', async () => {
    const runModelStep = vi.fn().mockResolvedValue({
      requestId: 'run-trace:step-2',
      runId: 'run-trace',
      stepId: 'step-2',
      providerId: 'provider',
      modelId: 'model',
      text: '完成',
      reasoningText: '',
      structuredOutput: null,
      toolCalls: [],
      responseMessages: [{ role: 'assistant', content: '完成' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 10, inputNoCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 2, textTokens: 2, reasoningTokens: 0, totalTokens: 12,
      },
      providerMetadataSummary: {},
      warnings: [],
      elapsedMs: 20,
    })
    await runPrimaryAgentModelStep({
      runId: 'run-trace',
      turn: 2,
      model: {
        providerId: 'provider',
        modelId: 'model',
        adapter: 'openai-compatible',
        capabilities: {
          streaming: true, toolCall: true, parallelTools: false,
          structuredOutputMode: 'json', reasoning: false, sampling: true, usage: true,
        },
        limits: { contextWindow: 32_000, contextWindowSource: 'profile_fallback' },
        settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 2_000 },
      },
      system: 'system',
      messages: [{ role: 'user', content: 'goal' }],
      trace: {
        kind: 'primary',
        turn: 2,
        estimatedTokens: 1_200,
        compacted: true,
      },
      runModelStep,
      onTextDelta: () => undefined,
    })
    expect(runModelStep.mock.calls[0][0].trace).toEqual({
      kind: 'primary',
      turn: 2,
      estimatedTokens: 1_200,
      compacted: true,
    })
  })
})
