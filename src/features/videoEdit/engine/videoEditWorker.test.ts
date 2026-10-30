import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import type { RenderRequest, RenderResponse } from './videoEditWorker'
import type { VideoEditPresentationCapture } from './videoEditGpuCompositor'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import type { CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'
import type { VideoEditRenderer } from './videoEditRenderer'
import { VideoEditGpuDeviceLostError } from './videoEditGpuFailure'

const state = vi.hoisted(() => ({ presentation: undefined as VideoEditRenderer['onPresentation'], elements: vi.fn(), hover: vi.fn(), render: vi.fn(), readRgb: vi.fn(), performance: [] as CodeFramePerformance[], jump: vi.fn(), hasJump: false, arm: vi.fn(), supersede: vi.fn(), abandon: vi.fn() }))
vi.mock('./videoEditRenderer', () => ({ VideoEditRenderer: class {
  constructor(readonly document: unknown) {}
  set onPresentation(value: VideoEditRenderer['onPresentation']) { state.presentation = value }
  reservePresentation() { return 1 }
  observeAuthorElements = state.elements
  render = state.render
  captureHoverFrame = state.hover
  async dispose() {}
  async updateDocument() {}
  cancelPresentation() {}
  setRenderCache() {}
  retainLookahead() {}
  armPlayback = state.arm
  async prepareLookahead() { return false }
  codeDiagnostics() { return {} }
  codePerformance() { return state.performance }
  captureCodePerformance() { const frames = state.performance; return () => frames }
  settled() { return Promise.resolve() }
  async stopPlayback() {}
  hasPrerenderedFrame() { return state.hasJump }
  presentPrerenderedFrame = state.jump
  supersedePausedFrame = state.supersede
  abandonPausedFrame = state.abandon
} }))
vi.mock('./videoEditTrackingPixels', () => ({ readVideoEditTrackingRgb: state.readRgb }))

const document = createVideoEditTestDocument('联系表回读')
const composition = videoEditComposition(document, document.sequences[0].id)
const messages: RenderResponse[] = []
const postMessage = vi.fn((message: RenderResponse) => { messages.push(message) })
const worker = { onmessage: undefined as unknown as (event: { data: RenderRequest }) => void, postMessage, addEventListener: vi.fn() }
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
  postMessage.mockClear(); state.arm.mockReset(); state.hover.mockReset(); state.render.mockReset(); state.jump.mockReset(); state.supersede.mockReset(); state.abandon.mockReset(); state.hasJump = false; messages.length = 0; state.performance = []
  state.elements.mockReset()
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

it('前台帧到达立即取消后台合成，迟到字节不交回卡片', async () => {
  let finish!: () => void
  let signal!: AbortSignal
  state.hover.mockImplementation(async (_document, _frame, _allow, abort: AbortSignal) => { signal = abort; await new Promise<void>(resolve => { finish = resolve }); return new Uint8Array([1]) })
  const id = ++nextId
  worker.onmessage({ data: { id, kind: 'hoverFrame', document: composition, frame: 0, allowRender: true } })
  await vi.waitFor(() => expect(state.hover).toHaveBeenCalledOnce())
  render(bitmap())
  const foreground = send(request)
  expect(signal.aborted).toBe(true)
  finish(); await foreground
  expect(messages.find(message => message.id === id)?.hoverBytes).toBeUndefined()
})

it('渲染 Worker 入口显式注册未捕获异常与未处理拒绝的监听', () => {
  expect(worker.addEventListener).toHaveBeenCalledWith('error', expect.any(Function))
  expect(worker.addEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function))
})

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

it('播放逐帧回执保持来源信息，同来源的呈现通知只发送一次', async () => {
  await init(true)
  state.render.mockImplementation(async (frame: number) => {
    const presentedSource = frame < 32 ? 'live' : 'prerendered'
    state.presentation!(frame, presentedSource, true)
    return { presented: true, presentedSource, completion: Promise.resolve() }
  })
  for (const frame of [30, 31, 32, 33]) {
    expect(await send({ ...request, frame, sequential: true })).toMatchObject({ presented: true, presentedSource: frame < 32 ? 'live' : 'prerendered' })
  }
  expect(messages.filter(message => message.phase === 'presented').map(message => [message.frame, message.presentedSource])).toEqual([[30, 'live'], [32, 'prerendered']])
})

it('常驻关键帧被更新请求取代时回 skipped，不触发旧帧重试', async () => {
  await init(true)
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  state.render.mockImplementationOnce(async () => {
    await blocked
    return { presented: false, superseded: true, presentedSource: 'jump', completion: Promise.resolve() }
  }).mockResolvedValue({ presented: true, presentedSource: 'live', completion: Promise.resolve() })
  const older = send({ ...request, frame: 30, scrubbing: 'fast' })
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledOnce())
  const latest = send({ ...request, frame: 31, scrubbing: true })
  release()
  expect(await older).toMatchObject({ presented: false, skipped: true, presentedSource: 'jump' })
  expect(await latest).toMatchObject({ presented: true })
  expect(state.render).toHaveBeenCalledTimes(2)
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

it('缓存暂停请求在现场合成挂起时已完成，紧接着的同帧拖动、快慢拖动和新暂停都能直接上屏并完成', async () => {
  await init(true)
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  state.render.mockImplementation(async () => { await blocker; return { presented: false, superseded: true, renderCached: false, decodeMs: 0, gpuMs: 0, completion: Promise.resolve(), canvas: {} } })
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: true, presentedSource: 'prerendered', cacheHits: 1, cacheBytes: 0, gpuMs: 1, completion: Promise.resolve() })
  const exact = ++nextId
  worker.onmessage({ data: { kind: 'render', id: exact, frame: 10, sequential: false, scrubbing: false } })
  await vi.waitFor(() => {
    expect(state.render).toHaveBeenCalledOnce()
    expect(messages.find(message => message.id === exact && !message.phase)).toMatchObject({ presented: true, presentedSource: 'prerendered' })
  })
  expect(await send({ kind: 'render', frame: 10, sequential: false, scrubbing: true })).toMatchObject({ presented: true, presentedSource: 'prerendered' })
  const jump = await send({ kind: 'render', frame: 500, sequential: false, scrubbing: 'fast' })
  expect(jump).toMatchObject({ presented: true, presentedSource: 'prerendered' })
  const slow = await send({ kind: 'render', frame: 501, sequential: false, scrubbing: true })
  expect(slow).toMatchObject({ presented: true, presentedSource: 'prerendered' })
  expect(slow.approximate).toBeUndefined()
  expect(state.jump).toHaveBeenCalledWith(500, expect.any(Function), false, expect.any(Number))
  expect(state.render).toHaveBeenCalledOnce()
  const paused = await send({ kind: 'render', frame: 502, sequential: false })
  expect(paused).toMatchObject({ presented: true, presentedSource: 'prerendered' })
  expect(state.supersede).toHaveBeenLastCalledWith(502, true)
  release()
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledTimes(2))
  await send({ kind: 'render', frame: 503, sequential: false, scrubbing: true })
  expect(messages.filter(message => message.id === exact && !message.phase)).toHaveLength(1)
})

it.each([true, 'fast', false] as const)('拖动缓存仍在读取时收到新指针请求（%s），旧读取保留上屏资格且请求只完成一次', async scrubbing => {
  await init(true)
  state.hasJump = true
  state.render.mockImplementation(async () => {
    state.presentation!(11, 'live', true)
    return { presented: true, presentedSource: 'live', completion: Promise.resolve() }
  })
  const reads: Array<{ frame: number; wanted: () => boolean; release: () => void }> = []
  state.jump.mockImplementation((frame: number, wanted: () => boolean) => new Promise(resolve => {
    let done = false
    reads.push({ frame, wanted, release: () => {
      if (done) return
      done = true
      const presented = wanted()
      if (presented) state.presentation!(frame, 'prerendered', true)
      resolve({ presented, presentedSource: 'prerendered', completion: Promise.resolve() })
    } })
  }))
  const ids = [++nextId, ++nextId]
  try {
    worker.onmessage({ data: { kind: 'render', id: ids[0], frame: 10, sequential: false, scrubbing: true } })
    worker.onmessage({ data: { kind: 'render', id: ids[1], frame: 11, sequential: false, scrubbing } })
    expect(reads[0].wanted()).toBe(true)
    reads[0].release(); reads[1].release()
    await vi.waitFor(() => expect(messages.filter(message => message.phase === 'presented' && message.presentedSource === 'prerendered').map(message => message.frame)).toEqual([10, 11]))
    await vi.waitFor(() => expect(messages.filter(message => ids.includes(message.id) && !message.phase)).toHaveLength(2))
    expect(messages.filter(message => ids.includes(message.id) && !message.phase).every(message => message.presented)).toBe(true)
    if (scrubbing) expect(state.render).not.toHaveBeenCalled()
    else await vi.waitFor(() => { expect(state.render).toHaveBeenCalledOnce(); expect(messages.filter(message => message.phase === 'presented').at(-1)?.presentedSource).toBe('live') })
  } finally { for (const read of reads) read.release(); await init(true) }
})

it('旧缓存读取失败后不再回退合成已被新位置取代的画面', async () => {
  await init(true)
  state.hasJump = true
  let release!: () => void
  state.jump.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined) }))
    .mockResolvedValue({ presented: true, presentedSource: 'prerendered', completion: Promise.resolve() })
  const old = send({ kind: 'render', frame: 10, sequential: false, scrubbing: true })
  const latest = await send({ kind: 'render', frame: 20, sequential: false, scrubbing: true })
  expect(latest).toMatchObject({ presented: true })
  release()
  expect(await old).toMatchObject({ presented: false, skipped: true })
  expect(state.render).not.toHaveBeenCalled()
})

it.each([false, true] as const)('最新缓存请求（scrubbing=%s）失效时仍完成现场路径而非丢掉请求', async scrubbing => {
  await init(true)
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: false, superseded: true, presentedSource: 'prerendered', completion: Promise.resolve() })
  const authorElements = { sequenceId: composition.id, revision: composition.revision, frame: 10, clips: [] }
  state.elements.mockReturnValue(authorElements)
  state.render.mockImplementation(async () => {
    state.presentation!(10, 'live', true)
    return { presented: true, presentedSource: 'live', completion: Promise.resolve() }
  })
  const result = await send({ kind: 'render', frame: 10, sequential: false, scrubbing, observeElements: true })
  expect(result).toMatchObject({ presented: true, presentedSource: 'live', authorElements })
  expect(state.render).toHaveBeenCalledOnce()
  expect(messages.filter(message => message.id === result.id && !message.phase)).toHaveLength(1)
})

it('后台现场上屏通知携带代码元素，缓存回执和近似现场通知不安装元素，也不重复完成请求', async () => {
  await init(true)
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: true, presentedSource: 'prerendered', completion: Promise.resolve() })
  const authorElements = { sequenceId: composition.id, revision: composition.revision, frame: 10, clips: [] }
  state.elements.mockReturnValue(authorElements)
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  state.render.mockImplementation(async () => {
    await blocker
    state.presentation!(10, 'live', false)
    state.presentation!(10, 'live', true)
    return { presented: true, presentedSource: 'live', effectErrors: ['效果失败'], sceneIssues: ['素材缺失'], completion: Promise.resolve() }
  })
  const cached = await send({ kind: 'render', frame: 10, sequential: false, observeElements: true })
  expect(cached.authorElements).toBeUndefined()
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledOnce())
  expect(state.render.mock.calls[0][8]).toBe(true)
  release()
  await vi.waitFor(() => expect(messages.filter(message => message.phase === 'presented')).toHaveLength(2))
  expect(messages.filter(message => message.phase === 'presented').map(message => message.authorElements)).toEqual([undefined, authorElements])
  await vi.waitFor(() => expect(messages.find(message => message.phase === 'refined')).toMatchObject({ presented: true, frame: 10, sequenceId: composition.id, revision: composition.revision, effectErrors: ['效果失败', '素材缺失'] }))
  expect(messages.filter(message => message.id === cached.id && !message.phase)).toHaveLength(1)
})

it.each([true, 'fast'] as const)('缓存拖动（%s）后同帧松手先完成缓存回执，再由现场替换并携带代码元素', async scrubbing => {
  await init(true)
  state.hasJump = true
  const authorElements = { sequenceId: composition.id, revision: composition.revision, frame: 10, clips: [] }
  state.elements.mockReturnValue(authorElements)
  state.jump.mockImplementation(async (frame: number, wanted: () => boolean, preserveExact: boolean) => {
    // 松手复用已上屏的同帧缓存，不会再产生一次缓存呈现通知。
    if (!preserveExact && wanted()) state.presentation!(frame, 'prerendered', true)
    return { presented: wanted(), presentedSource: 'prerendered', completion: Promise.resolve() }
  })
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  state.render.mockImplementation(async (frame: number, _sequential, mode, wanted: () => boolean) => {
    expect(mode).toBe(false)
    await blocker
    const presented = wanted()
    if (presented) state.presentation!(frame, 'live', true)
    return { presented, presentedSource: 'live', completion: Promise.resolve() }
  })
  try {
    const drag = await send({ kind: 'render', frame: 10, sequential: false, scrubbing })
    expect(drag).toMatchObject({ presented: true, presentedSource: 'prerendered' })
    expect(state.render).not.toHaveBeenCalled()
    const paused = await send({ kind: 'render', frame: 10, sequential: false, scrubbing: false, observeElements: true })
    expect(paused).toMatchObject({ presented: true, presentedSource: 'prerendered' })
    expect(paused.authorElements).toBeUndefined()
    await vi.waitFor(() => expect(state.render).toHaveBeenCalledOnce())
    expect(state.render.mock.calls[0][8]).toBe(true)
    release()
    await vi.waitFor(() => expect(messages.filter(message => message.phase === 'presented')).toEqual([
      expect.objectContaining({ frame: 10, presentedSource: 'prerendered' }),
      expect.objectContaining({ frame: 10, presentedSource: 'live', authorElements }),
    ]))
    await vi.waitFor(() => expect(messages.find(message => message.phase === 'refined')).toMatchObject({ frame: 10, presented: true }))
    for (const result of [drag, paused]) expect(messages.filter(message => message.id === result.id && !message.phase)).toHaveLength(1)
  } finally { release(); await init(true) }
})

it('缓存请求已完成后，后台 GPU 丢失仍独立通知宿主，不重复回执', async () => {
  await init(true)
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: true, presentedSource: 'prerendered', completion: Promise.resolve() })
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  state.render.mockImplementation(async () => { await blocker; throw new VideoEditGpuDeviceLostError('device reset') })
  const cached = await send({ kind: 'render', frame: 10, sequential: false })
  await send({ kind: 'render', frame: 11, sequential: false, scrubbing: true })
  release()
  await vi.waitFor(() => expect(messages.find(message => message.phase === 'refined')).toMatchObject({ frame: 10, sequenceId: composition.id, revision: composition.revision, gpuDeviceLost: 'device reset', error: expect.any(String) }))
  expect(messages.filter(message => message.id === cached.id && !message.phase)).toHaveLength(1)
})

it('同帧按下拖动又松手时，旧后台取消不误报为当前画面失败', async () => {
  await init(true)
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: true, presentedSource: 'prerendered', completion: Promise.resolve() })
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  state.render.mockImplementationOnce(async () => { await blocker; throw new DOMException('已取消', 'AbortError') })
    .mockResolvedValue({ presented: true, presentedSource: 'live', completion: Promise.resolve() })
  const cached = await send({ kind: 'render', frame: 10, sequential: false })
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledOnce())
  await send({ kind: 'render', frame: 10, sequential: false, scrubbing: true })
  await send({ kind: 'render', frame: 10, sequential: false, scrubbing: false })
  release()
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledTimes(2))
  await init(true)
  expect(messages.some(message => message.phase === 'refined' && message.error)).toBe(false)
  expect(messages.filter(message => message.id === cached.id && !message.phase)).toHaveLength(1)
})

it('暂停画面请求一到就让渲染器放弃还在准备的暂停精确画面，关闭会话时无条件放弃；导出、播放帧与要回读像素的请求不放弃', async () => {
  render(bitmap())
  await send({ kind: 'render', frame: 20, sequential: false, scrubbing: 'fast' })
  await send({ kind: 'render', frame: 21, sequential: true })
  await send({ kind: 'render', frame: 22, sequential: false, deadline: performance.timeOrigin + performance.now() })
  await send({ kind: 'render', frame: 23, sequential: false, readRgb: { width: 4, height: 4 } })
  await send({ kind: 'render', frame: 24, sequential: false, history: true })
  expect(state.supersede.mock.calls).toEqual([[20, true]])
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

it('ready 缓存不排在起播预热后面；像素回读在准备时禁止缓存抢占其画布', async () => {
  await init(true)
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: true, presentedSource: 'prerendered', cacheHits: 1, cacheBytes: 0, gpuMs: 1, completion: Promise.resolve() })
  let releaseArm!: () => void
  state.arm.mockImplementation(() => new Promise<void>(resolve => { releaseArm = resolve }))
  const arm = ++nextId
  worker.onmessage({ data: { kind: 'arm', id: arm, frame: 15 } })
  await vi.waitFor(() => expect(state.arm).toHaveBeenCalledOnce())
  try {
    expect(await send({ kind: 'render', frame: 15, sequential: false, scrubbing: true })).toMatchObject({ presentedSource: 'prerendered' })
    expect(state.render).not.toHaveBeenCalled()
  } finally { releaseArm() }
  await vi.waitFor(() => expect(messages.some(message => message.id === arm)).toBe(true))
  state.jump.mockClear()
  let releasePixels!: () => void
  const pixels = new Promise<void>(resolve => { releasePixels = resolve })
  state.render.mockImplementation(async (...args: unknown[]) => {
    const capture = args[7] as VideoEditPresentationCapture | undefined
    capture?.(Promise.resolve(bitmap()))
    await pixels
    return { presented: true, presentedSource: 'live', renderCached: false, decodeMs: 0, gpuMs: 0, completion: Promise.resolve() }
  })
  const history = send({ kind: 'render', frame: 16, sequential: false, history: true })
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledOnce())
  const scrub = send({ kind: 'render', frame: 17, sequential: false, scrubbing: true })
  expect(state.jump).not.toHaveBeenCalled()
  releasePixels(); await history; await scrub
})

it.each(['fonts', 'update', 'playback'] as const)('拖动或起播前的 %s 请求到达即放弃后台现场合成', async kind => {
  await init(true)
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: true, presentedSource: 'prerendered', completion: Promise.resolve() })
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  state.abandon.mockImplementation(() => release())
  state.render.mockImplementationOnce(async () => { await blocked; return { presented: false, completion: Promise.resolve() } })
    .mockResolvedValue({ presented: true, completion: Promise.resolve() })
  try {
    await send({ kind: 'render', frame: 10, sequential: false })
    await vi.waitFor(() => expect(state.render).toHaveBeenCalledOnce())
    state.abandon.mockClear()
    const id = ++nextId
    const next: RenderRequest = kind === 'fonts' ? { kind, id, fonts: [], availableIds: [], reset: false }
      : kind === 'update' ? { kind, id, document: composition }
        : { kind: 'render', id, frame: 11, sequential: true, deadline: performance.timeOrigin + performance.now() + 1000 }
    worker.onmessage({ data: next })
    expect(state.abandon).toHaveBeenCalledOnce()
    if (kind !== 'playback') expect(await send({ kind: 'render', frame: 11, sequential: false, scrubbing: true })).toMatchObject({ presented: true, presentedSource: 'prerendered' })
    await vi.waitFor(() => expect(messages.some(message => message.id === id && !message.phase)).toBe(true))
  } finally { release(); await init(true) }
})

it('最新缓存请求在回退读取期间再次失效，回 presented:false 允许主线程重发', async () => {
  await init(true)
  state.hasJump = true
  state.jump.mockResolvedValue({ presented: false, superseded: true, completion: Promise.resolve() })
  state.render.mockResolvedValue({ presented: false, superseded: true, completion: Promise.resolve() })
  const result = await send({ kind: 'render', frame: 10, sequential: false, scrubbing: true })
  expect(result.presented).toBe(false)
  expect(result.skipped).toBeUndefined()
})

it('字体请求在缓存读取期间到达时，不再启动会挡住它的过时后台合成', async () => {
  await init(true)
  state.hasJump = true
  let release!: () => void
  state.jump.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ presented: true, presentedSource: 'prerendered', completion: Promise.resolve() }) }))
    .mockResolvedValue({ presented: true, presentedSource: 'prerendered', completion: Promise.resolve() })
  const cached = send({ kind: 'render', frame: 10, sequential: false })
  const id = ++nextId
  worker.onmessage({ data: { kind: 'fonts', id, fonts: [], availableIds: [], reset: false } })
  release(); await cached
  await vi.waitFor(() => expect(messages.some(message => message.id === id && !message.phase)).toBe(true))
  expect(state.render).not.toHaveBeenCalled()
  expect(await send({ kind: 'render', frame: 11, sequential: false, scrubbing: true })).toMatchObject({ presented: true, presentedSource: 'prerendered' })
})
