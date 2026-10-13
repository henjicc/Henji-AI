// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronSystem } from './system'

const fetchNative = vi.fn()
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
function installBridge() { vi.stubGlobal('window', { henjiNative: { http: { fetch: fetchNative } } }) }
describe('Electron HTTP 取消', () => {
  it('已取消的请求不会进入桥接', async () => {
    installBridge()
    const controller = new AbortController()
    controller.abort()
    await expect(createElectronSystem().http.fetch('https://example.test', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchNative).not.toHaveBeenCalled()
  })
  it('桥接挂起时取消立即拒绝，并清理监听器', async () => {
    installBridge()
    fetchNative.mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = createElectronSystem().http.fetch('https://example.test', { signal: controller.signal })
    const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(fetchNative).toHaveBeenCalledOnce()
    controller.abort()
    await result
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  })
  it('成功与桥接失败也清理取消监听器', async () => {
    installBridge()
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    fetchNative.mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: [], body: new Uint8Array([65]) })
    expect(await (await createElectronSystem().http.fetch('https://example.test', { signal: controller.signal })).text()).toBe('A')
    fetchNative.mockRejectedValueOnce(new Error('offline'))
    await expect(createElectronSystem().http.fetch('https://example.test', { signal: controller.signal })).rejects.toThrow('offline')
    expect(removed).toHaveBeenCalledTimes(2)
  })
  it('把调用方的超时预算透传给主进程', async () => {
    installBridge()
    fetchNative.mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: [], body: new Uint8Array() })
    const init: RequestInit & { timeoutMs: number } = { timeoutMs: 10000 }
    await createElectronSystem().http.fetch('https://example.test', init)
    expect(fetchNative).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 10000 }))
  })
})
