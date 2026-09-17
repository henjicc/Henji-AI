import { afterEach, describe, expect, it, vi } from 'vitest'
const logs = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => logs }))
vi.mock('electron', () => ({ session: {} }))
import { createDiagnosticTransport, networkRequestContext } from './network-transport'
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
describe('网络请求诊断', () => {
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
