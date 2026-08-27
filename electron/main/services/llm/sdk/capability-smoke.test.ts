import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelStepResult } from '@henjicc/ai-sdk'
import { serializeModelProviderError } from '@henjicc/ai-sdk'

// `runModelStep` 任务 4.2 起从 `@henjicc/ai-sdk` 取得（原来是本地 `./runtime`）。整包 mock 会
// 连带吞掉 `capability-smoke.ts` 自己需要的 `parseModelProviderError`/`modelStepProviderAdapters`/
// `cancelTask` 等真实导出，所以用 `importOriginal` 保留其余导出，只替换 `runModelStep` 一项。
vi.mock('@henjicc/ai-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@henjicc/ai-sdk')>()
  return { ...actual, runModelStep: vi.fn() }
})

import { runModelStep } from '@henjicc/ai-sdk'
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
      structuredOutputMode: 'json',
    })

    expect(runModelStep).toHaveBeenCalledTimes(4)
    expect(result.checks).toHaveLength(9)
    expect(result.checks.filter(check => !['image', 'video', 'audio'].includes(check.id)).every(check => check.status === 'passed')).toBe(true)
    expect(result.checks.filter(check => ['image', 'video', 'audio'].includes(check.id)).every(check => check.status === 'skipped')).toBe(true)
    expect(result.usage).toMatchObject({ inputTokens: 6, outputTokens: 3, totalTokens: 9 })
    expect(result.cost).toEqual({ status: 'unknown' })
    expect(vi.mocked(runModelStep).mock.calls[2][0].capabilities.structuredOutputMode).toBe('json')
  })

  /*
   * 取消有两种合法表示，走哪条是竞态：定时器在请求派发前触发抛 `[task_cancelled]`，派发后
   * 触发则是 `[provider_error]{category:"cancelled"}`。
   *
   * 旧实现只认前一种，于是同一份代码在 deepseek 上过、在 mimo 上挂——mimo-v2.5-pro 其余五项
   * 全过，只因这一项被判失败，主模型就被整个判为不可用（agent_model_unavailable）。
   */
  it('供应商侧的取消错误同样算 cancel 通过', async () => {
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
      .mockRejectedValueOnce(new Error(serializeModelProviderError({
        code: 'MODEL_STEP_CANCELLED',
        category: 'cancelled',
        status: null,
        retryable: false,
        retryAfterMs: null,
        providerId: 'provider',
        modelId: 'model',
        requestId: 'smoke-2:cancel',
        message: '模型请求已取消',
      })))

    const result = await verifyModelCapabilities({
      requestId: 'smoke-2',
      providerId: 'provider',
      modelId: 'model',
      adapter: 'openai',
      baseUrl: 'https://example.com/v1',
      structuredOutputMode: 'json',
    })

    expect(result.checks.find((check) => check.id === 'cancel')?.status).toBe('passed')
  })

  it('非取消类错误仍然判 cancel 失败', async () => {
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
      .mockRejectedValueOnce(new Error(serializeModelProviderError({
        code: '500', category: 'server', status: 500, retryable: true, retryAfterMs: null,
        providerId: 'provider', modelId: 'model', requestId: 'smoke-3:cancel', message: '服务器错误',
      })))

    const result = await verifyModelCapabilities({
      requestId: 'smoke-3',
      providerId: 'provider',
      modelId: 'model',
      adapter: 'openai',
      baseUrl: 'https://example.com/v1',
      structuredOutputMode: 'json',
    })

    expect(result.checks.find((check) => check.id === 'cancel')?.status).toBe('failed')
  })
})

