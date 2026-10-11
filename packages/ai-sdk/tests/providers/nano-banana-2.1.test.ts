import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as apimart from '../../src/providers/apimart'
import * as kie from '../../src/providers/kie'
import * as fal from '../../src/providers/fal'
import * as grsai from '../../src/providers/grsai'
import type { JsonValue } from '../../src/types/runtime'
import { fakeRuntimeContext } from './test-helpers'

interface ProtocolFixture {
  route: string; submit: JsonValue; waiting: JsonValue[]; final: JsonValue; completed?: JsonValue
  failed: JsonValue; resultError?: JsonValue; otherFailures?: JsonValue[]
}
const providers = { apimart, kie, fal, grsai }
const fixture = (provider: string): ProtocolFixture => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/nano-banana-2.1', `${provider}-protocol.json`), 'utf8'))
const negative: Record<string, { empty: JsonValue; missingId: JsonValue; invalidId: JsonValue }> = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/nano-banana-2.1/negative.json'), 'utf8')).cases
const literal = (name: string): { examples: JsonValue[] } => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/nano-banana-2.1', `${name}.json`), 'utf8'))
const response = (value: JsonValue) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

describe('Nano Banana 2.1 官方状态链与共享parser', () => {
  it.each(Object.entries(providers))('%s逐状态查询并保留全部结果，不重复提交', async (provider, adapter) => {
    const f = fixture(provider)
    const values = [f.submit, f.waiting[0], ...f.waiting, ...(f.completed ? [f.completed] : []), f.final]
    const fetch = vi.fn(async () => response(values.shift()!))
    const runtime = fakeRuntimeContext(fetch)
    const created = await adapter.execute({ apiKey: 'fixture-key', route: f.route, method: 'POST', body: { prompt: 'fixture' }, requestId: `${provider}-submit`, runtime })
    expect(created.status).toBe('pending')
    expect(created.taskId).toBeTruthy()
    const result = await adapter.continuePolling({ apiKey: 'fixture-key', route: f.route, taskId: created.taskId!, requestId: `${provider}-poll`, polling: { interval: 1 }, runtime })
    expect(result.status).toBe('completed')
    expect(result.url.split('|||')).toEqual(['https://example.invalid/a.png', 'https://example.invalid/b.png'])
    expect(fetch.mock.calls.length).toBe(3 + f.waiting.length + (f.completed ? 1 : 0))
  })

  it.each(Object.entries(providers))('%s拒绝空成功终态、错误和缺任务标识', async (provider, adapter) => {
    const f = fixture(provider)
    const empty = negative[provider].empty
    const failures = [f.completed ? [f.completed, empty] : [empty], f.resultError ? [f.failed, f.resultError] : [f.failed], ...(f.otherFailures ?? []).map(value => [value])]
    for (const values of failures) {
      const fetch = vi.fn(async () => response(values.shift()!))
      await expect(adapter.continuePolling({ apiKey: 'fixture-key', route: f.route, taskId: 'fixture-task', requestId: `${provider}-negative`, polling: { interval: 1 }, runtime: fakeRuntimeContext(fetch) })).rejects.toMatchObject({ code: expect.stringMatching(/empty_result|provider_task_failed/) })
    }
    for (const sample of [negative[provider].missingId, negative[provider].invalidId]) {
      await expect(adapter.execute({ apiKey: 'fixture-key', route: f.route, method: 'POST', body: {}, requestId: `${provider}-missing-id`, runtime: fakeRuntimeContext(async () => response(sample)) })).rejects.toMatchObject({ code: 'empty_result' })
    }
  })

  it('APIMart、Grsai与Fal直接解析官方字面结果，不补齐必需字段', async () => {
    const cases = [
      { adapter: apimart, route: fixture('apimart').route, responses: literal('apimart-poll').examples },
      { adapter: grsai, route: fixture('grsai').route, responses: literal('grsai').examples.filter(value => typeof value === 'object' && value !== null && !Array.isArray(value) && value.status === 'succeeded') },
      { adapter: fal, route: fixture('fal').route, responses: [literal('fal-queue').examples.find(value => typeof value === 'object' && value !== null && !Array.isArray(value) && value.status === 'COMPLETED')!, ...literal('fal-generation').examples.filter(value => typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray(value.images))] },
    ]
    for (const { adapter, route, responses } of cases) {
      expect(responses.length).toBeGreaterThan(0)
      const values = [...responses]
      const result = await adapter.continuePolling({ apiKey: 'fixture-key', route, taskId: 'fixture-task', requestId: 'literal-result', polling: { interval: 1 }, runtime: fakeRuntimeContext(async () => response(values.shift()!)) })
      expect(result).toMatchObject({ status: 'completed', url: 'https://example.invalid/fixture.png' })
    }
  })

  it('Grsai官方异步200和失败400字面响应与传输边界一致', async () => {
    const examples = literal('grsai').examples
    const running = examples.find(value => typeof value === 'object' && value !== null && !Array.isArray(value) && value.status === 'running')!
    const failed = examples.find(value => typeof value === 'object' && value !== null && !Array.isArray(value) && value.status === 'failed')!
    expect(running).toBeTruthy()
    expect(failed).toBeTruthy()
    const fetch = vi.fn(async () => response(running))
    const args = { apiKey: 'fixture-key', route: fixture('grsai').route, method: 'POST' as const, body: { model: 'nano-banana-2.1', prompt: 'fixture' }, requestId: 'grsai-literal' }
    expect(await grsai.execute({ ...args, runtime: fakeRuntimeContext(fetch) })).toMatchObject({ status: 'pending', taskId: 'fixture-task' })
    await expect(grsai.execute({ ...args, runtime: fakeRuntimeContext(async () => new Response(JSON.stringify(failed), { status: 400, headers: { 'Content-Type': 'application/json' } })) })).rejects.toMatchObject({ code: 'provider_http_error' })
  })

  it.each(Object.entries(providers))('%s取消后不再轮询', async (provider, adapter) => {
    const f = fixture(provider)
    const controller = new AbortController()
    const fetch = vi.fn(async () => { controller.abort(); return response(f.waiting[0]) })
    await expect(adapter.continuePolling({ apiKey: 'fixture-key', route: f.route, taskId: 'fixture-task', requestId: `${provider}-cancel`, signal: controller.signal, polling: { interval: 1 }, runtime: fakeRuntimeContext(fetch) })).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
