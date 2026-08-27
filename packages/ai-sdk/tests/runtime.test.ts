import { describe, expect, it, vi } from 'vitest'

import {
  cancelTask,
  clearCancelFlag,
  isCancelled,
  noopLogger,
  noopTracer,
  registerAbortController,
  resolveRuntimeContext,
  type CredentialStore,
  type Logger,
  type MediaReader,
  type RuntimeContext,
  type Tracer,
  type Transport,
} from '../src/runtime'

/**
 * 5 个运行时接口 + task-registry + RuntimeContext 聚合的最小契约测试。
 * 用假实现验证「接口形状可用、调用方按约定使用能得到预期行为」，不测试任何具体宿主实现
 * （Electron 实现的测试属于 `electron/main/services/ai-runtime/sdk-runtime.ts` 的范围）。
 */

describe('Transport', () => {
  it('假实现满足 fetch(url, init) 契约', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const transport: Transport = {
      fetch: async (url, init) => {
        calls.push({ url, init })
        return new Response('ok', { status: 200 })
      },
    }

    const response = await transport.fetch('https://example.com/api', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(calls).toEqual([{ url: 'https://example.com/api', init: { method: 'POST' } }])
  })
})

describe('CredentialStore', () => {
  it('内置 scope 与可扩展 scope 都能取值', async () => {
    const store: CredentialStore = {
      get: (scope, providerId) => {
        if (scope === 'generation' && providerId === 'ppio') return 'gen-key'
        if (scope === 'llm' && providerId === 'openai') return 'llm-key'
        if (scope === 'speech-recognition' && providerId === 'bailian') return 'asr-key'
        if (scope === 'translation' && providerId === 'bailian') return 'translation-key'
        if (scope === 'custom-scope' && providerId === 'x') return 'custom-key'
        return undefined
      },
    }

    expect(await store.get('generation', 'ppio')).toBe('gen-key')
    expect(await store.get('llm', 'openai')).toBe('llm-key')
    expect(await store.get('speech-recognition', 'bailian')).toBe('asr-key')
    expect(await store.get('translation', 'bailian')).toBe('translation-key')
    // 可扩展 scope：不要求 scope 是闭合联合的成员也能编译通过、也能取到值
    expect(await store.get('custom-scope', 'x')).toBe('custom-key')
    expect(await store.get('generation', 'unknown')).toBeUndefined()
  })

  it('允许同步返回值，调用方统一 await 即可', async () => {
    const store: CredentialStore = {
      get: () => 'sync-key',
    }
    expect(await store.get('generation', 'ppio')).toBe('sync-key')
  })
})

describe('MediaReader', () => {
  it('read(ref) 返回 bytes/mimeType/filename', async () => {
    const reader: MediaReader = {
      read: async (ref) => ({
        bytes: new TextEncoder().encode(ref),
        mimeType: 'image/png',
        filename: 'test.png',
      }),
    }

    const result = await reader.read('data:image/png;base64,AAAA')
    expect(result.mimeType).toBe('image/png')
    expect(result.filename).toBe('test.png')
    expect(result.bytes).toBeInstanceOf(Uint8Array)
  })
})

describe('Logger / noopLogger', () => {
  it('noopLogger 三个方法调用均安全、无返回值', () => {
    expect(() => noopLogger.info('msg')).not.toThrow()
    expect(() => noopLogger.warn('msg', { event: 'x' })).not.toThrow()
    expect(() => noopLogger.error('msg', { error: new Error('boom') })).not.toThrow()
  })

  it('假实现能接收对齐 MainLoggerMeta 的字段', () => {
    const received: unknown[] = []
    const logger: Logger = {
      info: (message, ctx) => received.push({ message, ctx }),
      warn: () => undefined,
      error: () => undefined,
    }
    logger.info('hello', {
      event: 'test.event',
      requestId: 'req-1',
      taskId: 'task-1',
      modelId: 'model-1',
      providerId: 'provider-1',
      context: { foo: 'bar' },
    })
    expect(received).toHaveLength(1)
  })
})

describe('Tracer / noopTracer', () => {
  it('noopTracer.startSpan 返回可安全 end() 的句柄', () => {
    const span = noopTracer.startSpan('test-span', { foo: 'bar' })
    expect(() => span.end()).not.toThrow()
    expect(() => span.end(new Error('boom'))).not.toThrow()
  })

  it('假实现能记录 span 的开始与结束', () => {
    const events: string[] = []
    const tracer: Tracer = {
      startSpan: (name) => {
        events.push(`start:${name}`)
        return { end: () => events.push(`end:${name}`) }
      },
    }
    const span = tracer.startSpan('generate')
    span.end()
    expect(events).toEqual(['start:generate', 'end:generate'])
  })
})

describe('task-registry', () => {
  it('未取消的任务 isCancelled 为 false', () => {
    expect(isCancelled('generation', 'never-touched-task')).toBe(false)
  })

  it('cancelTask 会标记取消，并触发已注册的 AbortController', () => {
    const taskId = 'task-cancel-1'
    clearCancelFlag('generation', taskId)
    const controller = new AbortController()
    registerAbortController('generation', taskId, controller)

    expect(isCancelled('generation', taskId)).toBe(false)
    cancelTask('generation', taskId)
    expect(isCancelled('generation', taskId)).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('clearCancelFlag 会重置取消标记与已注册的 controller', () => {
    const taskId = 'task-cancel-2'
    cancelTask('generation', taskId)
    expect(isCancelled('generation', taskId)).toBe(true)

    clearCancelFlag('generation', taskId)
    expect(isCancelled('generation', taskId)).toBe(false)
  })

  it('cancelTask 对空白 taskId 是安全的空操作', () => {
    expect(() => cancelTask('generation', '   ')).not.toThrow()
    expect(isCancelled('generation', '   ')).toBe(false)
  })

  it('同名任务在 generation 与 llm 命名空间中互不影响', () => {
    const taskId = 'shared-task-id'
    clearCancelFlag('generation', taskId)
    clearCancelFlag('llm', taskId)

    cancelTask('generation', taskId)

    expect(isCancelled('generation', taskId)).toBe(true)
    expect(isCancelled('llm', taskId)).toBe(false)
    clearCancelFlag('generation', taskId)
  })
})

describe('RuntimeContext / resolveRuntimeContext', () => {
  const transport: Transport = { fetch: vi.fn(async () => new Response()) }
  const credentials: CredentialStore = { get: () => undefined }
  const media: MediaReader = { read: async () => ({ bytes: new Uint8Array(), mimeType: 'application/octet-stream', filename: 'f' }) }

  it('聚合类型可用：只提供必需字段也能构造', () => {
    const context: RuntimeContext = { transport, credentials, media }
    expect(context.logger).toBeUndefined()
    expect(context.tracer).toBeUndefined()
    expect(context.realtime).toBeUndefined()
  })

  it('resolveRuntimeContext 用 noop 实现补齐缺省的 logger/tracer', () => {
    const context: RuntimeContext = { transport, credentials, media }
    const resolved = resolveRuntimeContext(context)
    expect(resolved.logger).toBe(noopLogger)
    expect(resolved.tracer).toBe(noopTracer)
    expect(resolved.transport).toBe(transport)
    expect(resolved.realtime).toBeUndefined()
  })

  it('已提供 logger/tracer 时保留原值，不被 noop 覆盖', () => {
    const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined }
    const tracer: Tracer = { startSpan: () => ({ end: () => undefined }) }
    const resolved = resolveRuntimeContext({ transport, credentials, media, logger, tracer })
    expect(resolved.logger).toBe(logger)
    expect(resolved.tracer).toBe(tracer)
  })
})
