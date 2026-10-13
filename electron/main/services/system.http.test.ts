import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))
vi.mock('./media-recycle/queue', () => ({ registerOwnedMedia: vi.fn() }))
import { nativeFetch } from './system'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('主进程 HTTP 超时', () => {
  it('每个请求默认传入超时 signal', async () => {
    const fetchMock = vi.fn(async () => new Response('OK'))
    vi.stubGlobal('fetch', fetchMock)
    await nativeFetch({ url: 'https://example.test' })
    expect(fetchMock.mock.calls[0]).toEqual(['https://example.test', expect.objectContaining({ signal: expect.any(AbortSignal) })])
  })
  it('自定义预算覆盖默认值，并约束响应体读取', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    let reading!: () => void
    const readStarted = new Promise<void>(resolve => { reading = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => ({
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        reading()
        init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')), { once: true })
      }),
    })))
    const request = { url: 'https://example.test', timeoutMs: 10000 }
    const pending = nativeFetch(request)
    const result = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await readStarted
    controller.abort()
    await result
    expect(timeout).toHaveBeenCalledWith(10000)
  })
})
