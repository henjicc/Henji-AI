import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelStepResult } from '../../../../../src/core/llm/modelStep'

vi.mock('./runtime', () => ({ runModelStep: vi.fn() }))

import { runModelStep } from './runtime'
import { verifyModelCapabilities } from './capability-smoke'

function createResult(patch: Partial<ModelStepResult> = {}): ModelStepResult {
  return {
    requestId: 'request',
    runId: 'run',
    stepId: 'step',
    providerId: 'provider',
    modelId: 'model',
    text: 'OK',
    reasoningText: '',
    structuredOutput: null,
    toolCalls: [],
    responseMessages: [{ role: 'assistant', content: 'OK' }],
    finishReason: 'stop',
    usage: {
      inputTokens: 2,
      inputNoCacheTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
      textTokens: 1,
      reasoningTokens: 0,
      totalTokens: 3,
    },
    providerMetadataSummary: {},
    warnings: [],
    elapsedMs: 10,
    ...patch,
  }
}

describe('verifyModelCapabilities', () => {
  beforeEach(() => {
    vi.mocked(runModelStep).mockReset()
  })

  it('汇总真实 smoke 检查、usage 与未知费用状态', async () => {
    vi.mocked(runModelStep)
      .mockImplementationOnce(async (_input, emit) => {
        emit({ type: 'TextDelta', text: 'OK' })
        return createResult()
      })
      .mockResolvedValueOnce(createResult({
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call-1', toolName: 'capability_probe', input: { value: 'ok' }, dynamic: false }],
      }))
      .mockResolvedValueOnce(createResult({ structuredOutput: { ok: true } }))
      .mockRejectedValueOnce(new Error('[task_cancelled] cancelled'))

    const result = await verifyModelCapabilities({
      requestId: 'smoke-1',
      providerId: 'provider',
      modelId: 'model',
      adapter: 'openai',
      baseUrl: 'https://example.com/v1',
    })

    expect(runModelStep).toHaveBeenCalledTimes(4)
    expect(result.checks).toHaveLength(6)
    expect(result.checks.every(check => check.status === 'passed')).toBe(true)
    expect(result.usage).toMatchObject({ inputTokens: 6, outputTokens: 3, totalTokens: 9 })
    expect(result.cost).toEqual({ status: 'unknown' })
  })
})
