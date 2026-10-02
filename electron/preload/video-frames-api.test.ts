import { beforeEach, describe, expect, it, vi } from 'vitest'

type Receiver = (data: { importedSharedTexture: { getVideoFrame: () => unknown; release: () => void } }, ...args: unknown[]) => Promise<void>

const electron = vi.hoisted(() => ({ receiver: null as Receiver | null }))

vi.mock('electron', () => ({
  sharedTexture: { setSharedTextureReceiver: (callback: Receiver) => { electron.receiver = callback } },
  ipcRenderer: { on: vi.fn(), removeListener: vi.fn() },
}))

class TestPort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  peer: TestPort | null = null
  readonly sent: Array<{ message: unknown; transfer: unknown[] }> = []
  closed = false
  postMessage(message: unknown, transfer: unknown[] = []): void {
    this.sent.push({ message, transfer })
    this.peer?.onmessage?.({ data: message })
  }
  close(): void {
    this.closed = true
  }
}

class TestMessageChannel {
  port1 = new TestPort()
  port2 = new TestPort()
  constructor() {
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

function frame() {
  return { close: vi.fn() }
}

const meta = (route: string, frameIndex = 0) => ({ route, streamId: 'vf-1', frameIndex, timestampUs: frameIndex * 16667 })

describe('videoFrames preload', () => {
  let announcements: Array<{ message: { type: string; route: string }; port: TestPort }>

  beforeEach(() => {
    vi.resetModules()
    electron.receiver = null
    announcements = []
    vi.stubGlobal('MessageChannel', TestMessageChannel)
    vi.stubGlobal('postMessage', (message: { type: string; route: string }, _origin: string, transfer: unknown[]) => announcements.push({ message, port: transfer[0] as TestPort }))
  })

  async function create(invoke = vi.fn()) {
    const { createVideoFramesApi } = await import('./video-frames-api')
    const api = createVideoFramesApi(invoke)
    if (!electron.receiver) throw new Error('未注册共享纹理接收端')
    return { api, receive: electron.receiver, invoke }
  }

  it('hands each frame to the connected port with a lending token and closes it on the main thread when it comes back', async () => {
    const { api, receive } = await create(vi.fn(async () => ({ streams: [], unreleasedImports: 0, orphanHandles: 0, mainCpuMicros: { user: 0, system: 0 }, native: null })))
    const route = api.connect()
    expect(announcements).toHaveLength(1)
    expect(announcements[0].message).toEqual({ type: 'henji:video-frames-port', route })
    const page = announcements[0].port
    const received: Array<{ type: string; token: number; frame: unknown; meta: unknown }> = []
    page.onmessage = (event) => received.push(event.data as never)

    const lent = frame()
    const release = vi.fn()
    await receive({ importedSharedTexture: { getVideoFrame: () => lent, release } }, meta(route, 3))
    expect(release).toHaveBeenCalledOnce()
    expect(received).toEqual([{ type: 'frame', meta: meta(route, 3), frame: lent, token: 1 }])
    expect((await api.stats()).preload).toMatchObject({ received: 1, delivered: 1, outstanding: 1 })

    // Worker 交回的是 transfer 后的新对象：按编号对账，并在这里关闭。
    const returned = frame()
    page.postMessage({ type: 'release', frame: returned, token: 1 })
    expect(returned.close).toHaveBeenCalledOnce()
    expect(lent.close).not.toHaveBeenCalled()
    expect((await api.stats()).preload).toMatchObject({ returned: 1, outstanding: 0, routes: [route] })
  })

  it('closes frames that have no connected route or no metadata instead of leaking them', async () => {
    const { api, receive } = await create()
    const orphan = frame()
    await receive({ importedSharedTexture: { getVideoFrame: () => orphan, release: vi.fn() } }, meta('vf-route-missing'))
    expect(orphan.close).toHaveBeenCalledOnce()
    const bare = frame()
    await receive({ importedSharedTexture: { getVideoFrame: () => bare, release: vi.fn() } })
    expect(bare.close).toHaveBeenCalledOnce()

    const route = api.connect()
    api.disconnect(route)
    const late = frame()
    await receive({ importedSharedTexture: { getVideoFrame: () => late, release: vi.fn() } }, meta(route))
    expect(late.close).toHaveBeenCalledOnce()
  })

  it('releases the receiver import even when creating the frame fails', async () => {
    const { receive } = await create()
    const release = vi.fn()
    await expect(receive({ importedSharedTexture: { getVideoFrame: () => { throw new Error('lost') }, release } }, meta('x'))).rejects.toThrow('lost')
    expect(release).toHaveBeenCalledOnce()
  })
})
