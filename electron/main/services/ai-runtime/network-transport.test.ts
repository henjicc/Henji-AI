import { afterEach, describe, expect, it, vi } from 'vitest'
const logs = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }))
vi.mock('../logging', async importOriginal => ({ ...await importOriginal<typeof import('../logging')>(), createMainLogger: () => logs }))
vi.mock('electron', () => ({ session: {} }))
import { createDiagnosticTransport, networkRequestContext, type NetworkRequestScope } from './network-transport'
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
describe('网络请求诊断', () => {
  it.each([
    ['kie', 'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=test', { code: 200, data: { state: 'fail', failCode: '500', failMsg: 'Internal Error, Please try again later.', costTime: 2, param: JSON.stringify({ model: 'elevenlabs/text-to-speech-turbo-2-5', input: JSON.stringify({ text: '聊天的叫AI，画画的也叫AI。', voice: 'EkK5I93UQWFDigLMpZcX', token: 'hidden' }), cookie: 'hidden' }) } }],
    ['ppio', 'https://api.ppinfra.com/async/task-result?task_id=test', { task: { status: 'TASK_STATUS_FAILED', reason: 'failure' } }],
    ['modelscope', 'https://api-inference.modelscope.cn/v1/tasks/test', { task_status: 'FAILED' }],
    ['fal', 'https://queue.fal.run/model/requests/test/status', { status: 'COMPLETED', error: 'failure' }],
  ])('真实 %s 轮询路径与失败返回在 SDK 解码前保留，JSON 回显也脱敏', async (providerId, url, payload) => {
    // 依据官方字段表构造；KIE 来源：https://docs.kie.ai/market/common/get-task-detail，2026-10-12。
    const response = Response.json(payload)
    const transport = createDiagnosticTransport(vi.fn().mockResolvedValue(response), vi.fn())
    const scope: NetworkRequestScope = { requestId: 'request', modelId: 'model', taskId: 'test', phase: 'poll', providerId: String(providerId) }
    expect(await networkRequestContext.run(scope, () => transport.fetch(String(url), { headers: { Authorization: 'hidden' } }))).toBe(response)
    expect(scope.lastRequest).toEqual({ route: String(url).split('?')[0], method: 'GET' })
    expect(logs.debug).toHaveBeenCalledWith('后端发起轮询请求', expect.objectContaining({ event: 'generation.runtime.request_json', context: { phase: 'poll', ...scope.lastRequest } }))
    expect(scope.lastResponse).toBeDefined()
    expect(JSON.stringify(scope)).not.toContain('hidden')
    if (providerId === 'kie') expect(scope.lastResponse).toMatchObject({ data: { state: 'fail', failCode: '500', failMsg: 'Internal Error, Please try again later.', costTime: 2, param: { model: 'elevenlabs/text-to-speech-turbo-2-5', input: { voice: 'EkK5I93UQWFDigLMpZcX', token: '***' }, cookie: '***' } } })
    expect(await response.json()).toEqual(payload)
  })
  it('错误正文或损坏 JSON 回显不影响原响应，也不带出潜在凭据', async () => {
    for (const response of [Response.json({ data: { param: '{"token":"hidden"' } }), new Response('{', { headers: { 'content-type': 'application/json' } })]) {
      const scope: NetworkRequestScope = { requestId: 'request', modelId: 'model', phase: 'poll' }
      const transport = createDiagnosticTransport(vi.fn().mockResolvedValue(response), vi.fn())
      expect(await networkRequestContext.run(scope, () => transport.fetch('https://api.kie.ai/api/v1/jobs/recordInfo'))).toBe(response)
      expect(JSON.stringify(scope)).not.toContain('hidden')
    }
  })
  it('成功透明转发，不额外查询 DNS 或改变请求内容', async () => {
    const response = new Response('ok'); const send = vi.fn().mockResolvedValue(response); const inspect = vi.fn()
    const init = { method: 'POST', body: 'private', headers: { Authorization: 'secret' } }
    expect(await createDiagnosticTransport(send, inspect).fetch('https://example.com/secret?key=secret', init)).toBe(response)
    expect(send).toHaveBeenCalledWith('https://example.com/secret?key=secret', init)
    expect(inspect).not.toHaveBeenCalled()
    expect(JSON.stringify(logs.debug.mock.calls)).not.toMatch(/secret|private/)
  })
  it('保留原始错误与请求关联，诊断不泄露正文、路径或凭据', async () => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' }) })
    const transport = createDiagnosticTransport(vi.fn().mockRejectedValue(error), vi.fn().mockResolvedValue({ transport: 'node-fetch' }))
    await expect(networkRequestContext.run({ requestId: 'request', modelId: 'model' }, () => transport.fetch('https://example.com/secret?key=secret', { body: 'private' }))).rejects.toBe(error)
    expect(logs.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ requestId: 'request', context: expect.objectContaining({ host: 'example.com', code: 'ECONNRESET', phase: 'before_tls' }) }))
    expect(JSON.stringify(logs.warn.mock.calls)).not.toMatch(/secret|private/)
  })
  it('诊断挂起最多等待 500 毫秒，取消不触发诊断', async () => {
    vi.useFakeTimers()
    const error = new Error('failure'); const inspect = vi.fn(() => new Promise<never>(() => {}))
    const transport = createDiagnosticTransport(vi.fn().mockRejectedValue(error), inspect)
    const result = transport.fetch('https://example.com').catch(value => value)
    await vi.advanceTimersByTimeAsync(500)
    expect(await result).toBe(error)
    expect(vi.getTimerCount()).toBe(0)
    const controller = new AbortController(); controller.abort()
    await expect(transport.fetch('https://example.com', { signal: controller.signal })).rejects.toBe(error)
    expect(inspect).toHaveBeenCalledOnce()
  })
})
