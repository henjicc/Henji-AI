import { describe, expect, it } from 'vitest'
import { VideoEditNativeFrameReceiver, type NativeVideoFrame } from './videoEditNativeFrames'

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null
  readonly posted: Array<{ message: { type: string; frame?: unknown; token?: number; id?: number; call?: unknown }; transfer: unknown[] }> = []
  closed = false
  postMessage(message: { type: string; frame?: unknown; token?: number; id?: number; call?: unknown }, transfer: unknown[]): void {
    this.posted.push({ message, transfer })
  }
  close(): void {
    this.closed = true
  }
  deliver(streamId: string, frameIndex: number): { id: number } {
    const frame = { id: frameIndex }
    this.onmessage?.({ data: { type: 'frame', meta: { route: 'r', streamId, frameIndex, timestampUs: frameIndex }, frame, token: frameIndex + 100 } } as MessageEvent)
    return frame
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function createReceiver() {
  const port = new FakePort()
  return { port, receiver: new VideoEditNativeFrameReceiver(port as unknown as MessagePort, () => 123) }
}

describe('VideoEditNativeFrameReceiver', () => {
  it('routes decoder schedule events to the stream subscriber without touching frames', () => {
    const { port, receiver } = createReceiver()
    const events: unknown[] = []
    const stop = receiver.subscribeSchedule('vf-1', (event) => events.push(event))
    const done = { type: 'schedule_done', route: 'r', streamId: 'vf-1', scheduleId: 's', reason: 'completed', message: null }
    port.onmessage?.({ data: { type: 'schedule', event: done } } as MessageEvent)
    port.onmessage?.({ data: { type: 'schedule', event: { ...done, streamId: 'vf-2' } } } as MessageEvent)
    expect(events).toEqual([done])
    stop()
    port.onmessage?.({ data: { type: 'schedule', event: done } } as MessageEvent)
    expect(events).toHaveLength(1)
    expect(receiver.stats()).toEqual({ received: 0, released: 0, unclaimed: 0, outstanding: 0 })
  })

  it('returns unclaimed frames to the main thread instead of dropping or closing them in the worker', async () => {
    const { port, receiver } = createReceiver()
    const frame = port.deliver('nobody', 1)
    expect(port.posted).toHaveLength(0)
    await tick()
    expect(port.posted).toEqual([{ message: { type: 'release', frame, token: 101 }, transfer: [frame] }])
    expect(receiver.stats()).toEqual({ received: 1, released: 1, unclaimed: 1, outstanding: 0 })
  })

  it('lends frames to the stream subscriber and returns each frame exactly once after the release', async () => {
    const { port, receiver } = createReceiver()
    const borrowed: NativeVideoFrame[] = []
    const unsubscribe = receiver.subscribe('s1', (frame) => borrowed.push(frame))
    const frame = port.deliver('s1', 4)
    expect(borrowed[0]).toMatchObject({ frame, meta: { streamId: 's1', frameIndex: 4 }, receivedAt: 123 })
    expect(receiver.stats().outstanding).toBe(1)
    borrowed[0].release()
    borrowed[0].release()
    await tick()
    expect(port.posted).toHaveLength(1)
    expect(receiver.stats()).toMatchObject({ released: 1, outstanding: 0 })
    unsubscribe()
    port.deliver('s1', 5)
    expect(borrowed).toHaveLength(1)
  })

  it('waits for submitted GPU work before handing a frame back', async () => {
    const { port, receiver } = createReceiver()
    let finishWork: () => void = () => undefined
    const device = { queue: { onSubmittedWorkDone: () => new Promise<void>((resolve) => { finishWork = resolve }) } }
    receiver.subscribe('s1', (frame) => frame.release(device))
    port.deliver('s1', 0)
    await tick()
    expect(port.posted).toHaveLength(0)
    finishWork()
    await tick()
    expect(port.posted).toHaveLength(1)
  })

  it('sends session requests over the same port and settles them by id; stream-ended notices reach the stream subscriber', async () => {
    const { port, receiver } = createReceiver()
    const opened = receiver.call('openDecoder', { path: 'D:/a.mov', purpose: 'seek' })
    const failed = receiver.call('frameAt', { streamId: 'vf-1', time: 1, ticket: 't1' })
    expect(port.posted.map(entry => entry.message)).toEqual([
      { type: 'request', id: 1, call: { method: 'openDecoder', params: { path: 'D:/a.mov', purpose: 'seek' } } },
      { type: 'request', id: 2, call: { method: 'frameAt', params: { streamId: 'vf-1', time: 1, ticket: 't1' } } },
    ])
    port.onmessage?.({ data: { type: 'response', id: 2, error: '解码会话已结束' } } as MessageEvent)
    port.onmessage?.({ data: { type: 'response', id: 1, result: { streamId: 'vf-1' } } } as MessageEvent)
    port.onmessage?.({ data: { type: 'response', id: 1, result: 'late duplicate' } } as MessageEvent)
    await expect(opened).resolves.toEqual({ streamId: 'vf-1' })
    await expect(failed).rejects.toThrow('解码会话已结束')
    const ended: unknown[] = []
    receiver.subscribeEnded('vf-1', payload => ended.push(payload))
    const payload = { streamId: 'vf-1', route: 'r', reason: 'error', message: '崩溃' }
    port.onmessage?.({ data: { type: 'ended', payload } } as MessageEvent)
    port.onmessage?.({ data: { type: 'ended', payload: { ...payload, streamId: 'vf-2' } } } as MessageEvent)
    expect(ended).toEqual([payload])
  })

  it('dispose rejects pending requests and closes the port only after every deferred return was sent', async () => {
    const { port, receiver } = createReceiver()
    let finishWork: () => void = () => undefined
    const device = { queue: { onSubmittedWorkDone: () => new Promise<void>((resolve) => { finishWork = resolve }) } }
    receiver.subscribe('s1', (frame) => frame.release(device))
    port.deliver('s1', 0)
    const pending = receiver.call('closeStream', { streamId: 'vf-1' })
    const disposed = receiver.dispose()
    await expect(pending).rejects.toThrow('原生帧通道已关闭')
    await tick(); await tick()
    expect(port.closed).toBe(false)
    finishWork(); await disposed
    expect(port.posted.at(-1)?.message).toMatchObject({ type: 'release', token: 100 })
    expect(port.closed).toBe(true)
    await expect(receiver.call('closeStream', { streamId: 'vf-1' })).rejects.toThrow('原生帧通道已关闭')
  })

  it('returns frames when the handler throws and on dispose', async () => {
    const { port, receiver } = createReceiver()
    receiver.subscribe('bad', () => { throw new Error('boom') })
    expect(() => port.deliver('bad', 0)).toThrow('boom')
    receiver.subscribe('held', () => undefined)
    port.deliver('held', 1)
    await receiver.dispose()
    expect(port.posted).toHaveLength(2)
    expect(port.closed).toBe(true)
    expect(receiver.stats().outstanding).toBe(0)
  })
})
