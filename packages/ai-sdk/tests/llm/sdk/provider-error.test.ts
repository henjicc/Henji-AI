import { describe, expect, it } from 'vitest'

import type { ModelStepInput } from '../../../src/llm/modelStep'
import { normalizeProviderError, parseModelProviderError } from '../../../src/runtime'

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
    /*
     * 传输途中被断开就是网络错误。`UND_ERR_SOCKET` 此前落到 unknown → retryable: false，
     * 最典型的可重试错误被判成不可重试：实测三维场景连续两次真跑都死在它上面，
     * 整次运行判失败、0 个 Effect。
     */
    [{ code: 'UND_ERR_SOCKET' }, 'network', true],
    [{ code: 'ECONNRESET' }, 'network', true],
    // 参数写错了重试多少次都一样，不能一并放进网络类。
    [{ code: 'UND_ERR_INVALID_ARG' }, 'unknown', false],
    [{ statusCode: 400, code: 'context_length_exceeded' }, 'context_overflow', false],
    [{ statusCode: 400, code: 'content_filter' }, 'content_filter', false],
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

  it('把供应商超时识别为可重试网络错误', () => {
    const timeout = new Error('Request timed out after 60000ms')
    timeout.name = 'TimeoutError'
    const error = normalizeProviderError(input, timeout)
    expect(error.details).toMatchObject({
      code: 'MODEL_REQUEST_TIMEOUT',
      category: 'network',
      retryable: true,
    })
  })

  it('读取包装错误 cause 中的超时码和供应商重试提示', () => {
    const error = normalizeProviderError(input, {
      message: 'AI SDK request failed',
      cause: { code: 'UND_ERR_HEADERS_TIMEOUT', isRetryable: true },
    })
    expect(error.details).toMatchObject({
      code: 'UND_ERR_HEADERS_TIMEOUT',
      category: 'network',
      retryable: true,
    })
  })

  it('尊重 SDK 的可重试提示但不覆盖明确鉴权分类', () => {
    expect(normalizeProviderError(input, { isRetryable: true }).details)
      .toMatchObject({ category: 'network', retryable: true })
    expect(normalizeProviderError(input, { statusCode: 401, isRetryable: true }).details)
      .toMatchObject({ category: 'authentication', retryable: false })
  })
})
