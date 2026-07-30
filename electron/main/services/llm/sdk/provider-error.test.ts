import { describe, expect, it } from 'vitest'

import type { ModelStepInput } from '../../../../../src/core/llm/modelStep'
import { parseModelProviderError } from '../../../../../src/core/llm/providerProtocol'
import { normalizeProviderError } from './provider-error'

const input = {
  requestId: 'request-1',
  runId: 'run-1',
  stepId: 'step-1',
  providerId: 'provider-1',
  modelId: 'model-1',
} as ModelStepInput

describe('normalizeProviderError', () => {
  it.each([
    [{ statusCode: 401, code: 'unauthorized' }, 'authentication', false],
    [{ statusCode: 402, code: 'payment_required' }, 'billing', false],
    [{ statusCode: 429, code: 'insufficient_quota' }, 'quota', false],
    [{ statusCode: 429, code: 'rate_limit' }, 'rate_limit', true],
    [{ statusCode: 503, code: 'unavailable' }, 'server', true],
    [{ code: 'ETIMEDOUT' }, 'network', true],
    [{ statusCode: 400, code: 'context_length_exceeded' }, 'context_overflow', false],
    [{ statusCode: 422, code: 'invalid_argument' }, 'invalid_request', false],
  ])('将结构化供应商错误分类为 %s', (raw, category, retryable) => {
    const error = normalizeProviderError(input, raw)
    expect(error.details).toMatchObject({
      category,
      retryable,
      providerId: 'provider-1',
      modelId: 'model-1',
      requestId: 'request-1',
    })
    expect(parseModelProviderError(error)).toEqual(error.details)
  })

  it('解析 Retry-After 秒数且不暴露响应正文', () => {
    const error = normalizeProviderError(input, {
      statusCode: 429,
      responseHeaders: { 'retry-after': '2' },
      responseBody: { secret: 'do-not-leak' },
    })
    expect(error.details.retryAfterMs).toBe(2_000)
    expect(error.message).not.toContain('do-not-leak')
  })
})
