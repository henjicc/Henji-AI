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

  it('posts decoder schedule events to the port of the owning route and exposes decoder requests', async () => {
    const { ipcRenderer } = await import('electron')
    const invoke = vi.fn(async (_channel: string, _payload?: unknown) => ({}))
    const { api } = await create(invoke)
    const listener = vi.mocked(ipcRenderer.on).mock.calls.filter(([channel]) => channel === 'videoFrames:scheduleEvent').at(-1)?.[1] as unknown as (event: unknown, payload: unknown) => void
    expect(listener).toBeTypeOf('function')
    const route = api.connect()
    const consumer = announcements.find((entry) => entry.message.route === route)!.port
    const received: unknown[] = []
    consumer.onmessage = (event) => received.push(event.data)
    const missing = { type: 'frame_missing', route, streamId: 'vf-1', scheduleId: 's1', index: 3, reason: 'no_picture' }
    listener({}, missing)
    listener({}, { ...missing, route: 'vf-route-other' })
    listener({}, null)
    expect(received).toEqual([{ type: 'schedule', event: missing }])

    await api.openDecoder({ route, path: 'D:\\a.mov', purpose: 'seek' })
    await api.frameAt({ streamId: 'vf-1', time: 1, ticket: 't' })
    await api.schedule({ streamId: 'vf-1', scheduleId: 's1', times: [0] })
    await api.cancelSchedule('vf-1', 's1')
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['videoFrames:openDecoder', 'videoFrames:frameAt', 'videoFrames:schedule', 'videoFrames:cancelSchedule'])
    expect(invoke).toHaveBeenLastCalledWith('videoFrames:cancelSchedule', { streamId: 'vf-1', scheduleId: 's1' })
  })

  it('answers worker session requests on the same port; sessions opened there always belong to that route', async () => {
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      // Main-process decoder errors arrive named after their code (registerIpcHandler keeps name and message, 3.1).
      if (channel === 'videoFrames:frameAt') throw Object.assign(new Error('解码会话不存在或不属于当前窗口'), { name: 'VideoDecoderError:SESSION_GONE' })
      return { channel, payload }
    })
    const { api } = await create(invoke)
    const route = api.connect()
    const worker = announcements.find((entry) => entry.message.route === route)!.port
    const replies: Array<{ type: string; id: number; result?: unknown; error?: string }> = []
    worker.onmessage = (event) => replies.push(event.data as never)
    worker.postMessage({ type: 'request', id: 7, call: { method: 'openDecoder', params: { route: 'vf-route-other', path: 'D:/a.mov', purpose: 'playback' } } })
    worker.postMessage({ type: 'request', id: 8, call: { method: 'frameAt', params: { streamId: 'vf-1', time: 1, ticket: 't' } } })
    worker.postMessage({ type: 'request', id: 9, call: { method: 'stats', params: {} } })
    worker.postMessage({ type: 'request', id: 10, call: { method: 'closeStream', params: { streamId: 'vf-1' } } })
    await vi.waitFor(() => expect(replies).toHaveLength(4))
    expect(invoke).toHaveBeenCalledWith('videoFrames:openDecoder', { route, path: 'D:/a.mov', purpose: 'playback' })
    expect(invoke).toHaveBeenCalledWith('videoFrames:closeStream', { streamId: 'vf-1' })
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('videoFrames:stats')
    expect(replies.find((reply) => reply.id === 7)).toEqual({ type: 'response', id: 7, result: { channel: 'videoFrames:openDecoder', payload: { route, path: 'D:/a.mov', purpose: 'playback' } } })
    expect(replies.find((reply) => reply.id === 8)).toEqual({ type: 'response', id: 8, error: '解码会话不存在或不属于当前窗口', code: 'SESSION_GONE' })
    expect(replies.find((reply) => reply.id === 9)).toEqual({ type: 'response', id: 9, error: '未知的帧通道请求' })
  })

  it('routes sound sessions to the port that opened them and transfers each PCM block to the worker without another copy', async () => {
    const pcm = new Float32Array([0.25, -0.5, 0.75, 1])
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'videoFrames:readAudio') return { audioId: 'va-1', startFrame: -1, frames: 2, channels: 2, data: new Uint8Array(pcm.buffer.slice(0)), seeked: false, decodeMs: 1 }
      return { channel, payload }
    })
    const { api } = await create(invoke)
    const route = api.connect()
    const entry = announcements.find((item) => item.message.route === route)!
    const worker = entry.port
    const replies: Array<{ type: string; id: number; result?: { data?: unknown } }> = []
    worker.onmessage = (event) => replies.push(event.data as never)
    worker.postMessage({ type: 'request', id: 1, call: { method: 'openAudio', params: { route: 'vf-route-other', path: 'D:/a.mxf', audioStream: 1, sampleRate: 48000 } } })
    worker.postMessage({ type: 'request', id: 2, call: { method: 'readAudio', params: { audioId: 'va-1', startFrame: -1, frames: 2 } } })
    worker.postMessage({ type: 'request', id: 3, call: { method: 'closeAudio', params: { audioId: 'va-1' } } })
    await vi.waitFor(() => expect(replies).toHaveLength(3))
    expect(invoke).toHaveBeenCalledWith('videoFrames:openAudio', { route, path: 'D:/a.mxf', audioStream: 1, sampleRate: 48000 })
    expect(invoke).toHaveBeenCalledWith('videoFrames:closeAudio', { audioId: 'va-1' })
    const read = replies.find((reply) => reply.id === 2)!
    expect(read.result?.data).toBeInstanceOf(ArrayBuffer)
    expect([...new Float32Array(read.result!.data as ArrayBuffer)]).toEqual([0.25, -0.5, 0.75, 1])
    // The reply to the read carried its buffer in the transfer list; other replies transfer nothing.
    const sent = (entry.port.peer as TestPort).sent.filter((item) => (item.message as { type?: string }).type === 'response')
    expect(sent.map((item) => item.transfer.length)).toEqual([0, 1, 0])
    expect(sent[1].transfer[0]).toBe(read.result!.data)
  })

  it('forwards stream-ended notices to the owning port and closes the sessions of the route when it disconnects', async () => {
    const { ipcRenderer } = await import('electron')
    const invoke = vi.fn(async () => 1)
    const { api } = await create(invoke)
    const ended = vi.mocked(ipcRenderer.on).mock.calls.filter(([channel]) => channel === 'videoFrames:streamEnded').at(-1)?.[1] as unknown as (event: unknown, payload: unknown) => void
    const route = api.connect()
    const worker = announcements.find((entry) => entry.message.route === route)!.port
    const received: unknown[] = []
    worker.onmessage = (event) => received.push(event.data)
    const payload = { streamId: 'vf-1', route, reason: 'service_exited', message: null }
    ended({}, payload); ended({}, { ...payload, route: 'elsewhere' })
    expect(received).toEqual([{ type: 'ended', payload }])
    api.disconnect(route)
    expect(invoke).toHaveBeenCalledWith('videoFrames:closeRoute', { route })
  })

  it('releases the receiver import even when creating the frame fails', async () => {
    const { receive } = await create()
    const release = vi.fn()
    await expect(receive({ importedSharedTexture: { getVideoFrame: () => { throw new Error('lost') }, release } }, meta('x'))).rejects.toThrow('lost')
    expect(release).toHaveBeenCalledOnce()
  })
})
