import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import type { RenderRequest, RenderResponse } from './videoEditWorker'
import type { VideoEditPresentationCapture } from './videoEditGpuCompositor'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import type { CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'

const state = vi.hoisted(() => ({ render: vi.fn(), readRgb: vi.fn(), performance: [] as CodeFramePerformance[], jump: vi.fn(), hasJump: false, supersede: vi.fn(), abandon: vi.fn() }))
vi.mock('./videoEditRenderer', () => ({ VideoEditRenderer: class {
  constructor(readonly document: unknown) {}
  render = state.render
  async dispose() {}
  cancelPresentation() {}
  setRenderCache() {}
  retainLookahead() {}
  async prepareLookahead() { return false }
  codeDiagnostics() { return {} }
  codePerformance() { return state.performance }
  captureCodePerformance() { const frames = state.performance; return () => frames }
  settled() { return Promise.resolve() }
  async stopPlayback() {}
  hasJumpPreview() { return state.hasJump }
  presentJumpPreviewNow = state.jump
  supersedePausedFrame = state.supersede
  abandonPausedFrame = state.abandon
} }))
vi.mock('./videoEditTrackingPixels', () => ({ readVideoEditTrackingRgb: state.readRgb }))

const document = createVideoEditTestDocument('联系表回读')
const composition = videoEditComposition(document, document.sequences[0].id)
const messages: RenderResponse[] = []
const postMessage = vi.fn((message: RenderResponse) => { messages.push(message) })
const worker = { onmessage: undefined as unknown as (event: { data: RenderRequest }) => void, postMessage }
const bitmap = () => ({ width: 1920, height: 1080, close: vi.fn() }) as unknown as ImageBitmap
let nextId = 0
async function send(request: Omit<Extract<RenderRequest, { kind: 'render' }>, 'id'>): Promise<RenderResponse> {
  const id = ++nextId
  worker.onmessage({ data: { ...request, id } })
  await vi.waitFor(() => expect(messages.some(message => message.id === id && !message.phase)).toBe(true))
  return messages.find(message => message.id === id && !message.phase)!
}
async function init(direct = false): Promise<void> {
  const id = ++nextId
  worker.onmessage({ data: { kind: 'init', id, document: composition, ...(direct ? { surface: {} as OffscreenCanvas } : {}) } })
  await vi.waitFor(() => expect(messages.some(message => message.id === id)).toBe(true))
}
beforeEach(async () => {
  vi.stubGlobal('self', worker)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap()))
  postMessage.mockClear(); state.render.mockReset(); state.jump.mockReset(); state.supersede.mockReset(); state.abandon.mockReset(); state.hasJump = false; messages.length = 0; state.performance = []
  state.readRgb.mockReset().mockReturnValue(new Uint8Array([1, 2, 3]))
  await import('./videoEditWorker')
  await init()
})
afterEach(() => { vi.unstubAllGlobals() })

function render(pixels: ImageBitmap, completion: Promise<void> = Promise.resolve(), presented = true): void {
  void completion.catch(() => {})
  state.render.mockImplementation(async (...args: unknown[]) => {
    const capture = args[7] as VideoEditPresentationCapture | undefined
    capture?.(Promise.resolve(pixels))
    // Simulates canvas expiry during the asynchronous GPU completion wait.
    return { presented, renderCached: false, decodeMs: 0, completion, canvas: { transferToImageBitmap() { throw new Error('画布纹理已过期') } }, gpuMs: 0 }
  })
}
const request = { kind: 'render', frame: 15, sequential: false } as const

it('联系表/单帧/试渲染在同次提交捕获全尺寸像素，不读已过期的画布', async () => {
  const pixels = bitmap(); render(pixels)
  const result = await send(request)
  expect(result).toMatchObject({ presented: true, bitmap: pixels })
  expect(result.error).toBeUndefined()
  expect((state.render.mock.calls[0][7] as VideoEditPresentationCapture).maxPixels).toBe(Infinity)
  expect(pixels.close).not.toHaveBeenCalled()
  expect(postMessage.mock.lastCall?.[0].bitmap).toBe(pixels)
})

it('直接预览不回读；历史图保持预算，离屏同时索取历史图不缩小正式帧', async () => {
  await init(true)
  const pixels = bitmap(); render(pixels)
  expect((await send(request)).bitmap).toBeUndefined()
  expect(state.render.mock.lastCall?.[7]).toBeUndefined()
  expect((await send({ ...request, history: true })).history).toBe(pixels)
  expect((state.render.mock.lastCall?.[7] as VideoEditPresentationCapture).maxPixels).toBe(1280 * 720)
  await init()
  const both = await send({ ...request, history: true })
  expect(both.bitmap).toBe(pixels); expect(both.history).not.toBe(pixels)
  expect(createImageBitmap).toHaveBeenCalledWith(pixels, { resizeWidth: 1280, resizeHeight: 720, resizeQuality: 'high' })
})

it('RGB 分析也从稳定快照读取，并释放不向调用方移交的位图', async () => {
  const pixels = bitmap(); render(pixels)
  const result = await send({ ...request, readRgb: { width: 1, height: 1 } })
  expect(result.rgb).toEqual(new Uint8Array([1, 2, 3]))
  expect(state.readRgb).toHaveBeenCalledWith(pixels, { width: 1, height: 1 })
  expect(result.bitmap).toBeUndefined(); expect(pixels.close).toHaveBeenCalledOnce()
})

it('GPU 完成失败、取消呈现和发送失败都关闭快照，不回报黑帧成功', async () => {
  const failed = bitmap()
  render(failed, Promise.resolve().then(() => { throw new Error('GPU 失败') }))
  expect((await send(request)).error).toContain('GPU 失败')
  await vi.waitFor(() => expect(failed.close).toHaveBeenCalledOnce())
  const cancelled = bitmap(); render(cancelled, Promise.resolve(), false)
  expect((await send(request)).bitmap).toBeUndefined(); expect(cancelled.close).toHaveBeenCalledOnce()
  const unsent = bitmap(); render(unsent)
  postMessage.mockImplementationOnce(() => { throw new Error('发送失败') })
  expect((await send(request)).error).toContain('发送失败'); expect(unsent.close).toHaveBeenCalledOnce()
})

it('两帧流水的迟到完成保留各自成本，不读下一帧重置后的统计', async () => {
  await init(true)
  let complete!: () => void
  const pending = new Promise<void>(resolve => { complete = resolve })
  state.render.mockImplementation(async (frame: number) => {
    state.performance = [{ frame, cpuMs: frame, gpuMs: frame + 1, budgetMs: 33 }]
    return { presented: true, completion: frame === 30 ? pending : Promise.resolve(), gpuMs: 1 }
  })
  const firstId = ++nextId
  worker.onmessage({ data: { id: firstId, kind: 'render', frame: 30, sequential: true, deadline: performance.now() + 1000 } })
  await vi.waitFor(() => expect(messages.some(message => message.id === firstId && message.phase === 'submitted')).toBe(true))
  const second = await send({ kind: 'render', frame: 31, sequential: true, deadline: performance.now() + 1000 })
  complete()
  await vi.waitFor(() => expect(messages.some(message => message.id === firstId && !message.phase)).toBe(true))
  expect(second.codePerformance?.[0]).toMatchObject({ frame: 31, gpuMs: 32 })
  expect(messages.find(message => message.id === firstId && !message.phase)?.codePerformance?.[0]).toMatchObject({ frame: 30, gpuMs: 31 })
})


it('逐帧回执携带预览来源与实际耗时，扣除正常呈现等待并保留阶段名', async () => {
  await init(true)
  let now = 1000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  state.render.mockImplementation(async () => {
    now += 40; recordVideoEditPreparation('presentDeadline', 40)
    now += 8; recordVideoEditPreparation('codeReady', 8)
    return { presented: true, renderCached: true, completion: Promise.resolve(), decodeMs: 8, gpuMs: 40 }
  })
  try {
    const result = await send({ ...request, sequential: true })
    expect(result).toMatchObject({ renderCached: true, renderElapsedMs: 8, renderStages: { presentDeadline: 40, codeReady: 8 } })
  } finally { clock.mockRestore() }
})

it('暂停时预渲染窗口改变：前瞻按新窗口重新看一遍暂停的帧，而不是只取消等下一帧', async () => {
  await init(true)
  const { VideoEditDecodeLookahead } = await import('./videoEditDecodeLookahead')
  const changed = vi.spyOn(VideoEditDecodeLookahead.prototype, 'windowsChanged')
  render(bitmap())
  try {
    await send(request)
    const windows = [{ key: 'opening', startFrame: 0, endFrame: 86, url: 'henji-media://local/opening.mp4', width: 3840, height: 2160, fps: 60 }]
    worker.onmessage({ data: { kind: 'renderCache', id: 0, windows, localPaths: {} } })
    expect(changed).toHaveBeenCalledWith(composition, windows)
  } finally { changed.mockRestore() }
})

it('暂停时排队中的旧画面请求在更新的请求到达时当场答复 skipped，Worker 只画最新的位置', async () => {
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  const frames: number[] = []
  state.render.mockImplementation(async (...args: unknown[]) => {
    const frame = args[0] as number; frames.push(frame)
    if (frame === 1) await blocker
    ;(args[7] as VideoEditPresentationCapture | undefined)?.(Promise.resolve(bitmap()))
    return { presented: true, renderCached: false, decodeMs: 0, gpuMs: 0, completion: Promise.resolve(), canvas: {} }
  })
  const request = (frame: number): number => { const id = ++nextId; worker.onmessage({ data: { kind: 'render', id, frame, sequential: false, scrubbing: true } }); return id }
  const ids = [request(1)]
  await vi.waitFor(() => expect(frames).toEqual([1]))
  ids.push(request(2), request(3))
  // The second request is answered while the first is still being prepared, without rendering; the third waits for the first.
  expect(messages.find(message => message.id === ids[1])?.skipped).toBe(true)
  expect(frames).toEqual([1])
  release()
  await vi.waitFor(() => expect(messages.some(message => message.id === ids[2] && !message.phase && message.presented)).toBe(true))
  expect(frames).toEqual([1, 3])
  expect(messages.filter(message => message.id === ids[1])).toHaveLength(1)
})

it('前一次点击的精确画面还在准备时，远距离跳转在队列外先画常驻关键帧，被取代的精确画面答复 skipped', async () => {
  await init(true)
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  state.render.mockImplementation(async () => { await blocker; return { presented: false, superseded: true, renderCached: false, decodeMs: 0, gpuMs: 0, completion: Promise.resolve(), canvas: {} } })
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: true, approximate: true, cacheHits: 1, cacheBytes: 0, gpuMs: 1, completion: Promise.resolve() })
  const exact = ++nextId
  worker.onmessage({ data: { kind: 'render', id: exact, frame: 10, sequential: false, scrubbing: false } })
  await vi.waitFor(() => expect(state.render).toHaveBeenCalled())
  const jump = await send({ kind: 'render', frame: 500, sequential: false, scrubbing: 'fast' })
  expect(jump).toMatchObject({ presented: true, approximate: true })
  expect(state.jump).toHaveBeenCalledWith(500, expect.any(Function))
  expect(state.render).toHaveBeenCalledOnce()
  release()
  await vi.waitFor(() => expect(messages.find(message => message.id === exact && !message.phase)).toMatchObject({ skipped: true }))
})

it('暂停画面请求一到就让渲染器放弃还在准备的暂停精确画面，关闭会话时无条件放弃；导出、播放帧与要回读像素的请求不放弃', async () => {
  render(bitmap())
  await send({ kind: 'render', frame: 20, sequential: false, scrubbing: 'fast' })
  await send({ kind: 'render', frame: 21, sequential: true })
  await send({ kind: 'render', frame: 22, sequential: false, deadline: performance.timeOrigin + performance.now() })
  await send({ kind: 'render', frame: 23, sequential: false, readRgb: { width: 4, height: 4 } })
  await send({ kind: 'render', frame: 24, sequential: false, history: true })
  expect(state.supersede.mock.calls).toEqual([[20]])
  expect(state.abandon).not.toHaveBeenCalled()
  // Closing the session abandons it unconditionally, before queueing behind its decoding. The close is answered before
  // the test ends: the next test's session opens on the same worker module.
  const closing = ++nextId
  worker.onmessage({ data: { kind: 'dispose', id: closing } })
  expect(state.abandon).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(messages.some(message => message.id === closing)).toBe(true))
})

it('停止播放当场作废还没上屏的播放帧：排队的答复 skipped 不渲染，正在等刷新的放弃呈现；之后的暂停帧照常画', async () => {
  await init(true)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const frames: number[] = []
  state.render.mockImplementation(async (...args: unknown[]) => {
    const frame = args[0] as number; const shouldPresent = args[3] as () => boolean
    frames.push(frame)
    // Frame 10 waits for its refresh while the stop arrives; it presents only if still wanted then.
    if (frame === 10 && args[1] === true) await waiting
    return { presented: shouldPresent(), renderCached: true, decodeMs: 0, gpuMs: 0, completion: Promise.resolve(), canvas: {} }
  })
  const playback = (frame: number): number => { const id = ++nextId; worker.onmessage({ data: { kind: 'render', id, frame, sequential: true, deadline: performance.timeOrigin + performance.now() + 1000 } }); return id }
  const [waitingId, queuedId] = [playback(10), playback(11)]
  await vi.waitFor(() => expect(frames).toEqual([10]))
  worker.onmessage({ data: { kind: 'stopPlayback', id: 0, frame: 9 } })
  release()
  await vi.waitFor(() => expect(messages.some(message => message.id === queuedId && !message.phase)).toBe(true))
  expect(messages.find(message => message.id === waitingId && !message.phase)).toMatchObject({ presented: false, skipped: true })
  expect(messages.find(message => message.id === queuedId && !message.phase)).toMatchObject({ presented: false, skipped: true })
  expect(frames).toEqual([10])
  // The paused frame (no deadline) and the next play run are never cancelled by the earlier stop.
  expect(await send({ kind: 'render', frame: 10, sequential: false, scrubbing: false })).toMatchObject({ presented: true })
  expect(await send({ kind: 'render', frame: 10, sequential: true, deadline: performance.timeOrigin + performance.now() })).toMatchObject({ presented: true })
  expect(frames).toEqual([10, 10, 10])
})
