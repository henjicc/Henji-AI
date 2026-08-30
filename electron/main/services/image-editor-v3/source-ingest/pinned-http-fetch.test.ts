import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPinnedLookup,
  fetchPinnedHttpSource,
  type PinnedHttpFetchDependencies,
} from './pinned-http-fetch'

class FakeRequest extends EventEmitter {
  destroyedWith: Error | undefined

  end(): void {}

  destroy(error?: Error): this {
    this.destroyedWith = error
    queueMicrotask(() => this.emit('error', error ?? new Error('request destroyed')))
    return this
  }
}

function requestFactory(request: FakeRequest): NonNullable<PinnedHttpFetchDependencies['requestHttp']> {
  return (() => request) as unknown as NonNullable<PinnedHttpFetchDependencies['requestHttp']>
}

function resolvePinned(
  lookup: ReturnType<typeof createPinnedLookup>,
  all: boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup('rebound.example', { all }, (error, address, family) => {
      if (error) reject(error)
      else resolve(all ? address : { address, family })
    })
  })
}

describe('V3 pinned HTTP lookup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('连接只使用安全检查阶段选定的地址，不重新解析 hostname', async () => {
    const lookup = createPinnedLookup(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])

    await expect(resolvePinned(lookup, false)).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    })
    await expect(resolvePinned(lookup, true)).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ])
  })

  it('拒绝空地址或未验证的 hostname', () => {
    expect(() => createPinnedLookup([])).toThrow('validated IP address')
    expect(() => createPinnedLookup(['localhost'])).toThrow('validated IP address')
  })

  it('连接在预算内没有建立时销毁请求并清理计时器', async () => {
    vi.useFakeTimers()
    const request = new FakeRequest()
    const pending = fetchPinnedHttpSource(
      'http://example.test/image.png',
      { method: 'GET' },
      {
        resolvedAddresses: ['93.184.216.34'],
        connectTimeoutMs: 25,
        responseHeadersTimeoutMs: 50,
      },
      { requestHttp: requestFactory(request) },
    )
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Remote image connection timed out after 25ms',
    })

    await vi.advanceTimersByTimeAsync(25)

    await rejection
    expect(request.destroyedWith).toMatchObject({ name: 'TimeoutError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('连接成功但响应头迟迟未到时使用独立响应头预算', async () => {
    vi.useFakeTimers()
    const request = new FakeRequest()
    const socket = new EventEmitter() as EventEmitter & { connecting: boolean }
    socket.connecting = true
    const pending = fetchPinnedHttpSource(
      'http://example.test/image.png',
      { method: 'GET' },
      {
        resolvedAddresses: ['93.184.216.34'],
        connectTimeoutMs: 25,
        responseHeadersTimeoutMs: 40,
      },
      { requestHttp: requestFactory(request) },
    )
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Remote image response headers timed out after 40ms',
    })
    request.emit('socket', socket)
    socket.connecting = false
    socket.emit('connect')

    await vi.advanceTimersByTimeAsync(39)
    expect(request.destroyedWith).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)

    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
})
