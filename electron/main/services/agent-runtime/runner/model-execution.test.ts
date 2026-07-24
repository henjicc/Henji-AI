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
})
