import { describe, expect, it, vi } from 'vitest'

import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { ProviderModelStepError } from './provider-error'
import { executeModelStepWithRetry } from './retry-policy'

const input = {
  requestId: 'request-1',
  runId: 'run-1',
  stepId: 'step-1',
  providerId: 'provider-1',
  modelId: 'model-1',
  messages: [{ role: 'user', content: '测试' }],
  output: { mode: 'text' },
  capabilities: {
    streaming: true, toolCall: true, parallelTools: false,
    structuredOutputMode: 'json', reasoning: false, sampling: true, usage: true,
  },
  settings: { maxRetries: 2 },
} as ModelStepInput

const result = { text: '完成' } as ModelStepResult

function providerError(
  category: 'server' | 'authentication',
  retryAfterMs = category === 'server' ? 500 : null
): ProviderModelStepError {
  return new ProviderModelStepError({
    code: category.toUpperCase(), category, status: category === 'server' ? 503 : 401,
    retryable: category === 'server', retryAfterMs,
    providerId: 'provider-1', modelId: 'model-1', requestId: 'request-1', message: '安全错误',
  })
}

describe('executeModelStepWithRetry', () => {
  it('只重试未产生输出的瞬态错误并发布可见事件', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(providerError('server'))
      .mockResolvedValueOnce(result)
    const emit = vi.fn()
    const sleep = vi.fn().mockResolvedValue(undefined)
    await expect(executeModelStepWithRetry({
      input, signal: new AbortController().signal, emit, operation, sleep,
    })).resolves.toBe(result)
    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500, expect.any(AbortSignal))
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'Retrying', layer: 'request', attempt: 1, category: 'server',
    }))
  })

  it('鉴权错误不重试', async () => {
    const operation = vi.fn().mockRejectedValue(providerError('authentication'))
    await expect(executeModelStepWithRetry({
      input,
      signal: new AbortController().signal,
      emit: vi.fn(),
      operation,
      sleep: vi.fn(),
    })).rejects.toMatchObject({ details: { category: 'authentication' } })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('未提供 Retry-After 时按 Pi 的 2/4/8 秒最多重试三次', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(providerError('server', null))
      .mockRejectedValueOnce(providerError('server', null))
      .mockRejectedValueOnce(providerError('server', null))
      .mockResolvedValueOnce(result)
    const sleep = vi.fn().mockResolvedValue(undefined)
    await expect(executeModelStepWithRetry({
      input: { ...input, settings: { maxRetries: 3 } },
      signal: new AbortController().signal,
      emit: vi.fn(),
      operation,
      sleep,
    })).resolves.toBe(result)
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([2_000, 4_000, 8_000])
    expect(operation).toHaveBeenCalledTimes(4)
  })

  it('流已产生文本后不自动重放请求', async () => {
    const operation = vi.fn(async (emit) => {
      emit({ type: 'TextDelta', text: '部分输出' })
      throw providerError('server')
    })
    await expect(executeModelStepWithRetry({
      input,
      signal: new AbortController().signal,
      emit: vi.fn(),
      operation,
      sleep: vi.fn(),
    })).rejects.toMatchObject({ details: { category: 'server' } })
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
