import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { WebSourceSession } from './session'

const boundary = vi.hoisted(() => ({ request: vi.fn(), cookies: { on: vi.fn() }, serviceWorkers: { on: vi.fn(), getAllRunning: () => ({}) } }))
vi.mock('electron', () => ({ session: { fromPartition: () => ({ protocol: { handle: vi.fn() }, setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: boundary.request }, cookies: boundary.cookies, serviceWorkers: boundary.serviceWorkers }) } }))

it('全协议监听将 WebSocket/HTTP/文件站外依赖作废，仍放行原请求且不留 URL', () => {
  for (const url of ['ws://example.invalid/socket', 'wss://example.invalid/socket', 'http://example.invalid/a', 'file:///outside.txt']) {
    const session = new WebSourceSession(url)
    const callback = vi.fn()
    boundary.request.mock.calls.at(-1)![0]({ url }, callback)
    expect(callback).toHaveBeenCalledWith({})
    expect(session.reason).toBe('external-request')
  }
  const session = new WebSourceSession('local')
  for (const url of ['about:blank', 'data:text/plain,hello', 'https://web-source.henji.invalid/index.html', 'blob:https://web-source.henji.invalid/id']) session.observeRequest(url)
  expect(session.reason).toBeUndefined()
})

it('共享存储事件和观察断线使环境失效，正常关页清监听；不能观察的存储回退', async () => {
  const session = new WebSourceSession('storage')
  const debuggerApi = Object.assign(new EventEmitter(), { sendCommand: vi.fn(async () => ({ usageBreakdown: [] as Array<{ storageType: string; usage: number }> })) })
  const contents = { id: 1, debugger: debuggerApi, isDestroyed: () => false } as unknown as WebContents
  await session.observe(contents)
  expect(await session.validate(contents)).toBe(true)
  for (const method of ['DOMStorage.domStorageItemAdded', 'Storage.indexedDBContentUpdated', 'Storage.cacheStorageContentUpdated']) {
    const before = session.storageSignature
    debuggerApi.emit('message', {}, method)
    expect(session.storageSignature).not.toBe(before)
  }
  session.release(contents)
  expect(debuggerApi.listenerCount('message')).toBe(0)
  await session.observe(contents)
  debuggerApi.sendCommand.mockResolvedValue({ usageBreakdown: [{ storageType: 'file_systems', usage: 16 }] })
  expect(await session.validate(contents)).toBe(false)
  expect(session.reason).toBe('unobserved-storage')
  debuggerApi.emit('detach')
  expect(debuggerApi.listenerCount('message')).toBe(0)
})
