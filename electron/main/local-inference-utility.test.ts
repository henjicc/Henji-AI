import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalInferenceEvent, LocalInferenceRequest } from './services/local-inference/protocol'
import type { ImageInpaintJob, ImageInpaintResult } from './services/local-inference/inpainting/protocol'

const fake = vi.hoisted(() => ({ run: vi.fn(), remove: vi.fn(async () => undefined) }))
vi.mock('./services/local-inference/inpainting/inpaint', () => ({ runImageInpaint: fake.run, ImageInpaintError: class extends Error { code = 'inference' } }))
vi.mock('node:fs/promises', () => ({ default: { rm: fake.remove } }))
const job = (id: string): ImageInpaintJob => ({ id, sourcePath: 'source.png', maskPath: 'mask.png', roi: { left: 0, top: 0, width: 512, height: 512 }, quality: 'blemish', algorithm: 'telea', providers: ['cpu'], outputPath: `${id}.png` })
const result = (j: ImageInpaintJob): ImageInpaintResult => ({ algorithm: j.algorithm, provider: 'wasm', roi: j.roi, outputPath: j.outputPath, decodeMs: 1, inferenceMs: 1, compositeMs: 1, durationMs: 3 })

describe('图片修补沿原 utility process 队列派发', () => {
  afterEach(() => { Reflect.deleteProperty(process, 'parentPort'); vi.resetModules(); vi.clearAllMocks() })
  async function setup(): Promise<{ send(request: LocalInferenceRequest): void; events: LocalInferenceEvent[] }> {
    const events: LocalInferenceEvent[] = []; let send!: (request: LocalInferenceRequest) => void
    Object.defineProperty(process, 'parentPort', { configurable: true, value: {
      postMessage(event: LocalInferenceEvent) { events.push(event) },
      on(_event: string, listener: (event: { data: LocalInferenceRequest }) => void) { send = request => listener({ data: request }) },
    } })
    await import('./local-inference-utility')
    return { events, send: request => send(request) }
  }

  it('逐个运行、转发进度；排队取消不执行，也不终止当前作业', async () => {
    let finish!: (result: ImageInpaintResult) => void
    fake.run.mockImplementation(async (j: ImageInpaintJob, deps: { progress(done: number, total: number): void }) => {
      deps.progress(1, 4)
      if (j.id === 'first') return new Promise<ImageInpaintResult>(resolve => { finish = resolve })
      return result(j)
    })
    const { send, events } = await setup()
    send({ type: 'inpaint', job: job('first') }); send({ type: 'inpaint', job: job('cancelled') }); send({ type: 'inpaint', job: job('last') })
    send({ type: 'cancel', id: 'cancelled' })
    expect(fake.run).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual({ type: 'failed', id: 'cancelled', code: 'cancelled', message: '分析已取消。' })
    finish(result(job('first')))
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'done', id: 'last', result: result(job('last')) }))
    expect(fake.run.mock.calls.map(call => (call[0] as ImageInpaintJob).id)).toEqual(['first', 'last'])
    expect(events).toContainEqual({ type: 'progress', id: 'first', done: 1, total: 4 })
  })

  it('当前作业取消传给 signal；失败清理临时补丁并继续下一个作业', async () => {
    let fail!: (error: Error) => void; let signal!: AbortSignal
    fake.run.mockImplementation(async (j: ImageInpaintJob, deps: { signal: AbortSignal }) => {
      if (j.id === 'first') { signal = deps.signal; return new Promise<ImageInpaintResult>((_resolve, reject) => { fail = reject }) }
      return result(j)
    })
    const { send, events } = await setup()
    send({ type: 'inpaint', job: job('first') }); send({ type: 'inpaint', job: job('last') }); send({ type: 'cancel', id: 'first' })
    expect(signal.aborted).toBe(true)
    fail(new Error('cancelled'))
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'done', id: 'last', result: result(job('last')) }))
    expect(fake.remove).toHaveBeenCalledWith('first.png', { force: true })
    expect(events.find(event => event.type === 'failed' && event.id === 'first')).toMatchObject({ code: 'cancelled' })
  })
})
