import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronVideoFrames } from './videoFrames'

function stubWindow(connect: () => string) {
  const target = new EventTarget()
  const disconnect = vi.fn()
  const fakeWindow = Object.assign(target, { henjiNative: { videoFrames: { connect, disconnect } } })
  vi.stubGlobal('window', fakeWindow)
  return { target, disconnect }
}

function announce(target: EventTarget, route: string, port?: MessagePort): void {
  target.dispatchEvent(new MessageEvent('message', { data: { type: 'henji:video-frames-port', route }, ports: port ? [port] : [] }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('electron videoFrames adapter', () => {
  it('claims only the port announced for its own route', async () => {
    const own = new MessageChannel()
    const other = new MessageChannel()
    let target: EventTarget | null = null
    const window = stubWindow(() => {
      queueMicrotask(() => {
        announce(target!, 'vf-route-9', other.port2)
        announce(target!, 'vf-route-1')
        announce(target!, 'vf-route-1', own.port2)
      })
      return 'vf-route-1'
    })
    target = window.target
    const channel = await createElectronVideoFrames().connect()
    expect(channel.route).toBe('vf-route-1')
    expect(channel.port).toBe(own.port2)
    for (const port of [own.port1, own.port2, other.port1, other.port2]) port.close()
  })

  it('times out and disconnects the route when the port never arrives', async () => {
    vi.useFakeTimers()
    const { disconnect } = stubWindow(() => 'vf-route-2')
    const pending = createElectronVideoFrames().connect()
    const failure = expect(pending).rejects.toThrow('显卡帧通道建立超时')
    await vi.advanceTimersByTimeAsync(5_000)
    await failure
    expect(disconnect).toHaveBeenCalledWith('vf-route-2')
  })
})
