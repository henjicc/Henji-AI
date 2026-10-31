import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CodeWebReference } from '@/core/imaging/parameterTypes'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { WebSourceCaptureRequest, WebSourceCaptureResult } from '@/platform/contracts/videoFrames'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { installVideoEditWebChannel, VideoEditWebInputs, type WebPictureOptions } from './videoEditWebInputs'

const reference: CodeWebReference = { kind: 'web', path: '/site', width: 100, height: 100, region: [0, 0, 100, 100], scale: 4 }
const handlers = new Map<string, (frame: NativeVideoFrame) => void>()
const requests: Array<{ params: WebSourceCaptureRequest; resolve: (result: WebSourceCaptureResult) => void }> = []
const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
const contentHandlers = new Set<(change: { path: string; contentHash: string }) => void>()
let inputs: VideoEditWebInputs
let stream = 0
const call = vi.fn(async (method: string, params: WebSourceCaptureRequest) => {
  if (method === 'openWeb') return { streamId: 'stream-' + ++stream, pixelWidth: 400, pixelHeight: 400, contentHash: 'hash', duration: 100, route: 'route' }
  if (method === 'captureWeb') return new Promise<WebSourceCaptureResult>(resolve => requests.push({ params, resolve }))
  return true
})
const copy = vi.fn(async (frame: NativeVideoFrame, _width: number, _height: number, target?: GpuTexture) => {
  frame.release()
  if (target) return { texture: target, owner: {} as GpuDevice }
  const texture = { destroy: vi.fn() }; textures.push(texture)
  return { texture: texture as unknown as GpuTexture, owner: {} as GpuDevice }
})
function finish(index: number, width = 100, height = 100): ReturnType<typeof vi.fn> {
  const { params, resolve } = requests[index]
  const release = vi.fn()
  handlers.get(params.streamId)?.({ meta: { request: { id: params.ticket } }, release } as unknown as NativeVideoFrame)
  resolve({ boxes: null, duration: 100, contentHash: 'hash', pixelWidth: width * params.scale!, pixelHeight: height * params.scale! })
  return release
}
function renderPicture(time: number, options: WebPictureOptions = {}, source = reference) {
  const frame = {}
  return inputs.picture(source, time, frame, copy, [], options).finally(() => inputs.trim(frame))
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); handlers.clear(); contentHandlers.clear(); requests.length = 0; textures.length = 0; stream = 0
  installVideoEditWebChannel(() => ({ call, subscribeWebContent: (handler: (change: { path: string; contentHash: string }) => void) => { contentHandlers.add(handler); return () => contentHandlers.delete(handler) }, subscribe: (id: string, handler: (frame: NativeVideoFrame) => void) => { handlers.set(id, handler); return () => handlers.delete(id) } }) as unknown as VideoEditNativeFrameReceiver)
  inputs = new VideoEditWebInputs()
})
afterEach(() => { inputs.dispose(); installVideoEditWebChannel(() => undefined); vi.restoreAllMocks(); vi.useRealTimers() })

it('慢网页到预算即交回，后台只追最新目标且保留上一幅，精确观察仍等待', async () => {
  const approximate = vi.fn()
  const picture = (time: number) => renderPicture(time, { deadline: performance.now() + 16, approximate })
  const first = picture(1); await vi.advanceTimersByTimeAsync(16)
  expect(await first).toBeUndefined()
  const second = picture(2); await vi.advanceTimersByTimeAsync(16); await second
  const third = picture(3); await vi.advanceTimersByTimeAsync(16); await third
  expect(requests.map(request => request.params.time)).toEqual([1])
  finish(0); await vi.advanceTimersByTimeAsync(0)
  expect(requests.map(request => request.params.time)).toEqual([1, 3])
  const fourth = picture(4); await vi.advanceTimersByTimeAsync(16)
  expect((await fourth)?.web.time).toBe(1)
  const exact = renderPicture(9)
  let settled = false; void exact.then(() => { settled = true })
  await vi.advanceTimersByTimeAsync(20)
  expect(settled).toBe(false)
  finish(2)
  expect((await exact)?.web.time).toBe(9)
  expect(approximate).toHaveBeenCalledTimes(4)
})

it('取消立即放弃慢回执，迟到帧归还；重新拖动不等待旧回执', async () => {
  const controller = new AbortController()
  const pending = inputs.picture(reference, 1, {}, copy, [], { signal: controller.signal })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(0)
  controller.abort(); await rejected
  expect(call).toHaveBeenCalledWith('cancelWeb', { streamId: 'stream-1', ticket: requests[0].params.ticket })
  const newer = inputs.picture(reference, 2, {}, copy, [])
  await vi.advanceTimersByTimeAsync(0)
  const release = finish(0); finish(1)
  expect((await newer)?.web.time).toBe(2)
  expect(release).toHaveBeenCalledOnce()
  expect(copy).toHaveBeenCalledOnce()
})

it('同帧同源两时刻隔离，倍率切换保留实例，前视回执乱序不串帧', async () => {
  const frame = {}
  const first = inputs.picture(reference, 1, frame, copy, [], { outputScale: 0.25, ahead: [1.1, 1.2] })
  const other = inputs.picture(reference, 20, frame, copy, [], { outputScale: 0.25 })
  await vi.advanceTimersByTimeAsync(0)
  expect(stream).toBe(2)
  expect(requests.map(request => request.params.time)).toEqual([1, 1.1, 1.2, 20])
  finish(2); finish(3); finish(1); finish(0)
  expect((await first)?.web.time).toBe(1)
  expect((await other)?.web.time).toBe(20)
  const next = inputs.picture(reference, 1.1, {}, copy, [], { outputScale: 0.25, ahead: [1.2] })
  expect((await next)?.web.time).toBe(1.1)
  expect(requests).toHaveLength(4)
  const scaled = inputs.picture(reference, 1.2, {}, copy, [], { outputScale: 2 })
  await vi.advanceTimersByTimeAsync(0); finish(4)
  expect((await scaled)?.width).toBe(400)
  expect(requests[4].params.scale).toBe(4)
  expect(stream).toBe(2)
  for (const handler of contentHandlers) handler({ path: reference.path, contentHash: 'changed' })
  const updated = inputs.picture(reference, 1.2, {}, copy, [], { outputScale: 2 })
  await vi.advanceTimersByTimeAsync(0); finish(5); await updated
  inputs.dispose()
  expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true)
})

it('结构编辑保留回退画面，内容重载让在途精确消费者换票据重排', async () => {
  const first = inputs.picture(reference, 1, {}, copy, [])
  await vi.advanceTimersByTimeAsync(0); finish(0); const saved = await first
  inputs.invalidate()
  const preview = inputs.picture(reference, 2, {}, copy, [], { deadline: performance.now() + 16 })
  await vi.advanceTimersByTimeAsync(16)
  expect(await preview).toBe(saved)
  const exact = inputs.picture(reference, 2, {}, copy, [])
  await vi.advanceTimersByTimeAsync(0)
  for (const handler of contentHandlers) handler({ path: reference.path, contentHash: 'updated' })
  requests[1].resolve({ dropped: true, boxes: null, duration: 100, contentHash: 'updated', pixelWidth: 400, pixelHeight: 400 })
  await vi.advanceTimersByTimeAsync(0)
  expect(requests[2].params.time).toBe(2)
  expect(requests[2].params.latest).toBe(false)
  expect(requests[2].params.ticket).not.toBe(requests[1].params.ticket)
  finish(2)
  expect((await exact)?.web.time).toBe(2)
  expect(stream).toBe(1)
})

it('同帧重复取样只分配一次，跨帧复用不覆盖本帧回退画面', async () => {
  const frame = {}
  const first = inputs.picture(reference, 1, frame, copy, [], { ahead: [2, 3] })
  const same = inputs.picture(reference, 1, frame, copy, [], { ahead: [2, 3] })
  await vi.advanceTimersByTimeAsync(0)
  expect(requests).toHaveLength(3)
  finish(0); finish(1); finish(2)
  expect(await same).toBe(await first)
  const bytes = 400 * 400 * 4
  expect(inputs.bytes).toBe(3 * bytes)
  inputs.trim(frame)
  const next = renderPicture(4)
  await vi.advanceTimersByTimeAsync(0); finish(3); await next
  expect(inputs.bytes).toBe(4 * bytes)
  const reused = renderPicture(5)
  await vi.advanceTimersByTimeAsync(0); finish(4); await reused
  expect(copy.mock.calls.at(-1)?.[3]).toBeDefined()
  expect(textures).toHaveLength(4)
  inputs.dispose()
  expect(inputs.bytes).toBe(0)
  expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true)
})

it('慢帧中的五个网页轨道不被闲置清理提前销毁', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  const frame = {}
  const pictures = Array.from({ length: 5 }, (_, index) => inputs.picture(reference, index, frame, copy, []))
  await vi.advanceTimersByTimeAsync(2100)
  for (let index = 0; index < pictures.length; index++) finish(index)
  await Promise.all(pictures)
  inputs.trim(frame)
  expect(textures.every(texture => texture.destroy.mock.calls.length === 0)).toBe(true)
  inputs.trim({})
  expect(textures.filter(texture => texture.destroy.mock.calls.length === 1)).toHaveLength(1)
})

it.each([false, true])('同帧同源同时间的不同选择器保留各自读请求，preview=%s', async preview => {
  const frame = {}, options = preview ? { deadline: performance.now() + 16 } : {}
  const first = inputs.picture({ ...reference, boxes: ['.a'] }, 1, frame, copy, [], options)
  const second = inputs.picture({ ...reference, boxes: ['.b'] }, 1, frame, copy, [], options)
  await vi.advanceTimersByTimeAsync(0)
  finish(0); await vi.advanceTimersByTimeAsync(0); finish(1)
  expect((await first)?.web.boxes).toHaveProperty('.a', null)
  expect((await second)?.web.boxes).toHaveProperty('.b', null)
  expect(call.mock.calls.filter(([method]) => method === 'cancelWeb')).toHaveLength(0)
  expect(stream).toBe(1)
})

it('叠化或画中画结束后延续 B 页面时刻，回退也属于 B，不远跳到 A 槽', async () => {
  const frame = {}
  const a = inputs.picture(reference, 1, frame, copy, [])
  const b = inputs.picture(reference, 70, frame, copy, [])
  await vi.advanceTimersByTimeAsync(0); finish(0); finish(1)
  await Promise.all([a, b])
  const bStream = requests[1].params.streamId
  const next = inputs.picture(reference, 70.04, {}, copy, [], { deadline: performance.now() + 16 })
  await vi.advanceTimersByTimeAsync(16)
  expect(requests[2].params.streamId).toBe(bStream)
  expect((await next)?.web.time).toBe(70)
  finish(2); await vi.advanceTimersByTimeAsync(0)
  const following = inputs.picture(reference, 70.08, {}, copy, [])
  await vi.advanceTimersByTimeAsync(0); finish(3)
  expect((await following)?.web.time).toBe(70.08)
  expect(requests[3].params.streamId).toBe(bStream)
  expect(stream).toBe(2)
})

it('4 倍网页连续帧与视频共享预算，压力先回收前视、池、上一幅和闲置页', async () => {
  const large: CodeWebReference = { ...reference, width: 1920, height: 1080, region: [0, 0, 1920, 1080] }
  const availableBytes = () => 512 * 1024 ** 2 - 3840 * 2160 * 8
  const idle = renderPicture(1, {}, { ...large, path: '/idle' })
  await vi.advanceTimersByTimeAsync(0); finish(0, 1920, 1080); await idle
  for (let frame = 0; frame < 8; frame++) {
    const before = requests.length
    const current = renderPicture(frame, { ahead: [frame + 1, frame + 2], availableBytes }, large)
    await vi.advanceTimersByTimeAsync(0)
    for (let index = before; index < requests.length; index++) finish(index, 1920, 1080)
    expect((await current)?.web.time).toBe(frame)
    await vi.advanceTimersByTimeAsync(0)
    expect(inputs.bytes).toBeLessThanOrEqual(availableBytes())
  }
  expect(call.mock.calls.some(([method, params]) => method === 'closeWeb' && params.streamId === 'stream-1')).toBe(true)
  inputs.dispose()
  expect(inputs.bytes).toBe(0)
  expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true)
})

it('本帧必需画面可超过缓存预算，同帧已交出的纹理不能被压力回收', async () => {
  const frame = {}, bytes = 400 * 400 * 4
  const first = inputs.picture(reference, 1, frame, copy, [], { availableBytes: () => bytes })
  await vi.advanceTimersByTimeAsync(0); finish(0); await first
  const second = inputs.picture(reference, 2, frame, copy, [], { availableBytes: () => bytes })
  await vi.advanceTimersByTimeAsync(0); finish(1)
  expect((await second)?.web.time).toBe(2)
  expect(textures[0].destroy).not.toHaveBeenCalled()
})


it('持续压力只回收纹理，慢预览和导出前视最终取完，优先保留上一幅', async () => {
  const bytes = 400 * 400 * 4
  const initial = renderPicture(0, { ahead: [1] })
  await vi.advanceTimersByTimeAsync(0); finish(0); finish(1); await initial
  const last = textures[0], ahead = textures[1]
  const slow = renderPicture(2, { deadline: performance.now() + 16, availableBytes: () => bytes })
  await vi.advanceTimersByTimeAsync(16)
  expect((await slow)?.web.time).toBe(0)
  expect(ahead.destroy).toHaveBeenCalledOnce()
  expect(last.destroy).not.toHaveBeenCalled()
  for (let index = 0; index < 5; index++) {
    const frame = {}
    inputs.checkBudget(frame, 0); inputs.trim(frame)
  }
  expect(call.mock.calls.filter(([method]) => method === 'cancelWeb')).toHaveLength(0)
  finish(2); await vi.advanceTimersByTimeAsync(0)
  const next = renderPicture(3, { deadline: performance.now() + 16, availableBytes: () => bytes })
  await vi.advanceTimersByTimeAsync(16)
  expect((await next)?.web.time).toBe(2)
  finish(3); await vi.advanceTimersByTimeAsync(0)

  const exact = renderPicture(4, { ahead: [5], availableBytes: () => bytes })
  await vi.advanceTimersByTimeAsync(0); finish(4); await exact
  for (let index = 0; index < 5; index++) {
    const frame = {}; inputs.checkBudget(frame, 0); inputs.trim(frame)
  }
  expect(call.mock.calls.filter(([method, params]) => method === 'cancelWeb' && params.ticket === requests[5].params.ticket)).toHaveLength(0)
  finish(5); await vi.advanceTimersByTimeAsync(0)
  expect((await renderPicture(5, { availableBytes: () => bytes }))?.web.time).toBe(5)
  expect(requests).toHaveLength(6)
})

it.each([false, true])('重叠帧在提交前保护纹理免于回收与复用，预算回调各归其帧，压力=%s', async pressure => {
  const bytes = 400 * 400 * 4, firstFrame = {}, secondFrame = {}
  const first = inputs.picture(reference, 1, firstFrame, copy, [], { availableBytes: () => bytes * 3 })
  await vi.advanceTimersByTimeAsync(0); finish(0); const held = await first
  const second = inputs.picture(reference, 2, secondFrame, copy, [], { availableBytes: () => pressure ? bytes : bytes * 8 })
  await vi.advanceTimersByTimeAsync(0); finish(1); await second
  inputs.trim(secondFrame)
  for (const time of [3, 4]) {
    const pending = renderPicture(time, { availableBytes: () => pressure ? bytes : bytes * 8 })
    await vi.advanceTimersByTimeAsync(0); finish(time - 1); await pending
    expect(textures[0].destroy).not.toHaveBeenCalled()
    expect(copy.mock.calls.at(-1)?.[3]).not.toBe(held?.texture)
  }
  inputs.checkBudget(firstFrame, bytes * 3)
  inputs.trim(firstFrame)
  const reclaimFrame = {}; inputs.checkBudget(reclaimFrame, 0); inputs.trim(reclaimFrame)
  expect(textures[0].destroy).toHaveBeenCalledOnce()

  const slowFrame = {}, tightFrame = {}
  const slow = inputs.picture(reference, 5, slowFrame, copy, [], { ahead: [6], availableBytes: () => bytes * 3 })
  await vi.advanceTimersByTimeAsync(0)
  const tight = inputs.picture({ ...reference, path: '/tight' }, 1, tightFrame, copy, [], { availableBytes: () => bytes })
  await vi.advanceTimersByTimeAsync(0); finish(6); await tight
  finish(4); await slow
  finish(5); await vi.advanceTimersByTimeAsync(0)
  expect((await inputs.picture(reference, 6, {}, copy, []))?.web.time).toBe(6)
  expect(requests).toHaveLength(7)
})
