import path from 'node:path'
import { recordingCursorFixture } from '@/tests/recordingCursorFixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { RenderRequest } from './videoEditWorker'
import { recordVideoEditMaskUpdate } from '../application/videoEditMaskEditing'
import { createVideoEditSequence, videoEditClipSchema, videoEditComposition } from '@/core/videoEdit/document'
import { addLegacyVideoEditTracks, createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditRenderTransport } from './videoEditRenderTransport'
import { VideoEditRenderBusyError, VideoEditRenderWorkerError } from './videoEditGpuFailure'

const proxyState = vi.hoisted(() => ({ sources: {} as Record<string, import('@/core/videoEdit/proxy').VideoProxyResult> }))
vi.mock('../application/videoEditProxy', () => ({ verifiedVideoEditProxySources: async () => proxyState.sources }))
const platform = vi.hoisted(() => ({
  status: vi.fn(async () => ({ available: true, forcedBackend: null as 'native' | 'browser' | null })),
  connect: vi.fn(async () => ({ route: 'vf-route-1', port: { kind: 'port' } as unknown as MessagePort })),
  disconnect: vi.fn(),
  allowRoot: vi.fn(async () => undefined),
  dirname: vi.fn(async (path: string) => path.slice(0, path.lastIndexOf('/'))),
  logs: [] as Array<{ level: string; message: string; meta: unknown }>,
}))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ videoDecoder: { status: platform.status }, videoFrames: { connect: platform.connect, disconnect: platform.disconnect }, media: { allowRoot: platform.allowRoot }, system: { paths: { dirname: platform.dirname } } }) }))
vi.mock('@/services/imageSource', () => ({ toFetchableMediaUrl: (path: string) => `url:${path}`, isLikelyLocalImagePath: (path: string) => /^[A-Z]:/.test(path) }))
vi.mock('../videoEditMediaContent', () => ({ VideoEditMediaContentVerifier: class { async check() {} dispose() {} } }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: (message: string, meta: unknown) => platform.logs.push({ level: 'debug', message, meta }), info: (message: string, meta: unknown) => platform.logs.push({ level: 'info', message, meta }), warn: (message: string, meta: unknown) => platform.logs.push({ level: 'warn', message, meta }) }) }))

const workers: FakeWorker[] = []
class FakeWorker {
  respond = true
  readonly messages: Array<{ message: RenderRequest | { kind: string; port?: unknown }; transfer: unknown[] }> = []
  onmessage?: (event: MessageEvent) => void
  onerror?: unknown
  terminate = vi.fn()
  constructor() { workers.push(this) }
  postMessage(message: RenderRequest, transfer: unknown[] = []) {
    this.messages.push({ message, transfer })
    if (this.respond && 'id' in message && message.id) queueMicrotask(() => this.onmessage?.({ data: { id: message.id, presented: true, ...(message.kind === 'render' ? { bitmap: { close: vi.fn() } } : {}) } } as MessageEvent))
  }
}
vi.stubGlobal('Worker', FakeWorker)
vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return { drawImage: vi.fn() } } })

const { VideoEditRenderSession, warmVideoEditNativeDecoder } = await import('./videoEditRenderSession')
it('工作区预启动合并重复挂载，不创建帧通道或 Worker，失败后可以重试', async () => {
  let finish!: () => void
  platform.status.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ available: true, forcedBackend: null }) }))
  const first = warmVideoEditNativeDecoder()
  expect(warmVideoEditNativeDecoder()).toBe(first)
  await Promise.resolve()
  expect(platform.status).toHaveBeenCalledOnce()
  expect(workers).toHaveLength(0)
  expect(platform.connect).not.toHaveBeenCalled()
  finish(); await first
  platform.status.mockRejectedValueOnce(new Error('暂时不可用'))
  await warmVideoEditNativeDecoder()
  await warmVideoEditNativeDecoder()
  expect(platform.status).toHaveBeenCalledTimes(3)
})
function composition(): VideoEditComposition {
  return {
    id: 'sequence', name: '序列', revision: 0, width: 1920, height: 1080, frameRate: { numerator: 60, denominator: 1 }, fps: 60, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    media: [
      { id: 'pro', name: 'ProRes', kind: 'video', path: 'D:/prores.mov', width: 1920, height: 1080, durationSeconds: 3 },
      { id: 'picture', name: '图', kind: 'image', path: 'D:/a.png', width: 10, height: 10, durationSeconds: 0 },
      { id: 'remote', name: '远程', kind: 'video', path: 'https://example.com/a.mp4', width: 10, height: 10, durationSeconds: 1 },
    ],
    items: [], tracks: [], clips: [], annotations: [],
  } as unknown as VideoEditComposition
}
beforeEach(() => {
  workers.length = 0; platform.logs = []; proxyState.sources = {}
  platform.status.mockReset().mockResolvedValue({ available: true, forcedBackend: null })
  platform.connect.mockReset().mockResolvedValue({ route: 'vf-route-1', port: { kind: 'port' } as unknown as MessagePort })
  platform.disconnect.mockReset()
  platform.allowRoot.mockClear(); platform.dirname.mockClear()
})
afterEach(() => { vi.useRealTimers() })

it('字体范围展开嵌套序列时不沿用外层转场', async () => {
  const project = createVideoEditTestDocument('嵌套转场字体')
  project.items = [{ id: 'item', name: '文字', kind: 'text' }, { id: 'nested-item', name: '子序列', kind: 'sequence', sequenceId: project.sequences[0].id }]
  const child = project.sequences[0]
  const base = makeVideoEditItemClip(project, 'item', child.id, { frame: 0, duration: 30 })
  child.clips = [{ ...base, id: 'inner' }]
  const parent = createVideoEditSequence('父序列'); addLegacyVideoEditTracks(parent)
  parent.clips = [{ ...base, id: 'nested', kind: 'sequence', itemId: 'nested-item' }, { ...base, id: 'after', start: 30 }]
  parent.transitions = [{ id: 'cross', kind: 'cross_dissolve', leftClipId: 'nested', rightClipId: 'after', durationFrames: 10 }]
  project.sequences.push(parent)
  const fonts = vi.fn(async (_document: VideoEditComposition) => [])
  const session = new VideoEditRenderTransport({ fonts, proxies: async () => ({}), maskUpdateTime: () => undefined }, videoEditComposition(project, parent.id))
  await session.prepareGpu()
  await session.present(5)
  expect(fonts.mock.lastCall![0].sequences!.map(sequence => sequence.clips.map(clip => clip.id))).toEqual([['inner']])
  await session.dispose()
})
it('初始化不读取代码字体，逐帧只请求当前范围，连续帧复用字体准备', async () => {
  const project = createVideoEditTestDocument('延迟字体')
  project.items = [{ id: 'item', name: '占位', kind: 'text' }]
  const sequence = project.sequences[0]
  const base = makeVideoEditItemClip(project, 'item', sequence.id, { frame: 0, duration: 20 })
  sequence.clips = [0, 60].map((start, index) => ({ ...base, id: `clip-${index}`, kind: 'code' as const, start, code: { definitionId: 'code', versionId: `version-${index}`, parameters: {} } }))
  const fonts = vi.fn(async (_document: VideoEditComposition) => [])
  const session = new VideoEditRenderTransport({ fonts, proxies: async () => ({}), maskUpdateTime: () => undefined }, videoEditComposition(project, sequence.id))
  await session.prepareGpu()
  expect(fonts.mock.calls[0][0].clips).toEqual([])
  expect(fonts.mock.calls[0][0].items).toEqual([])
  await session.present(0)
  expect(fonts.mock.lastCall![0].clips.map(clip => clip.id)).toEqual(['clip-0'])
  const calls = fonts.mock.calls.length
  await session.present(1)
  expect(fonts).toHaveBeenCalledTimes(calls)
  await session.present(60)
  expect(fonts.mock.lastCall![0].clips.map(clip => clip.id)).toEqual(['clip-1'])
  expect(workers[0].messages.find(entry => entry.message.kind === 'init')!.message).toMatchObject({ codeSources: {} })
  await session.dispose()
})

it('作者声明由现有渲染会话读取，不创建额外 Worker 或请求画面', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.prepareGpu()
  const worker = workers[0]; worker.respond = false
  const pending = session.readAuthorMetadata('blob:author', { layers: {} })
  await Promise.resolve()
  const request = worker.messages.at(-1)!.message as Extract<RenderRequest, { kind: 'authorMetadata' }>
  expect(request).toMatchObject({ kind: 'authorMetadata', url: 'blob:author', locations: { layers: {} } })
  const metadata = { name: '原效果', kind: 'generator', mode: 'dynamic', parameters: [], types: {}, hexColors: [] }
  worker.onmessage!({ data: { id: request.id, authorMetadata: metadata } } as MessageEvent)
  expect(await pending).toEqual(metadata)
  expect(workers).toHaveLength(1)
  expect(worker.messages.some(entry => ['render', 'authorFrame'].includes(entry.message.kind))).toBe(false)
  worker.respond = true
  await session.dispose()
})

it('卡死渲染终止共享会话、释放全部等待和原生通道，显式重建可继续出画', async () => {
  const session = new VideoEditRenderSession(composition(), undefined, undefined, undefined, undefined, undefined, false, 50)
  await session.prepareGpu()
  vi.useFakeTimers()
  const old = workers[0]; old.respond = false
  const first = session.present(0), second = session.present(1)
  const failures = [expect(first).rejects.toThrow('超过时限'), expect(second).rejects.toThrow('超过时限')]
  await vi.advanceTimersByTimeAsync(50); await Promise.all(failures)
  expect(old.terminate).toHaveBeenCalledOnce()
  expect(platform.disconnect).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  await expect(session.present(2)).rejects.toThrow('超过时限')
  const close = vi.fn()
  old.onmessage!({ data: { id: 999, bitmap: { close } } } as unknown as MessageEvent)
  expect(close).toHaveBeenCalledOnce()
  await session.dispose()
  expect(platform.disconnect).toHaveBeenCalledOnce()
  vi.useRealTimers()
  const recovered = new VideoEditRenderSession(composition())
  await expect(recovered.present(0)).resolves.toMatchObject({ presented: true })
  expect(workers).toHaveLength(2)
  await recovered.dispose()
})

it('Worker 原始异常释放通道与等待，拒收迟到模块请求及画面；新会话使用新端口出帧', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.prepareGpu()
  const old = workers[0]; old.respond = false
  const pending = session.present(7)
  const rejected = expect(pending).rejects.toBeInstanceOf(VideoEditRenderWorkerError)
  const cause = new Error('原始异常')
  ;(old.onerror as (event: Partial<ErrorEvent>) => void)({ message: cause.message, filename: 'blob:author', lineno: 12, colno: 9, error: null, preventDefault: vi.fn() })
  await rejected
  expect(session.terminated).toBe(true)
  expect(session.terminalError?.cause).toBeUndefined()
  expect((session.terminalError as VideoEditRenderWorkerError).authorError().message).toBe('原始异常（blob:author:12:9）')
  const log = platform.logs.find(entry => (entry.meta as { event: string }).event === 'video_edit.render.session.failed')!.meta as { context: Record<string, unknown> }
  expect(log.context).toMatchObject({ filename: 'blob:author', line: 12, column: 9 })
  expect(log.context).not.toHaveProperty('stack')
  const messages = old.messages.length
  old.onmessage!({ data: { kind: 'code.read', token: 1, file: { location: 'memory:old' } } } as MessageEvent)
  const close = vi.fn(), historyClose = vi.fn()
  old.onmessage!({ data: { id: 1, bitmap: { close }, history: { close: historyClose } } } as unknown as MessageEvent)
  expect(close).toHaveBeenCalledOnce(); expect(historyClose).toHaveBeenCalledOnce()
  expect(old.messages).toHaveLength(messages)
  expect(platform.disconnect).toHaveBeenCalledWith('vf-route-1')
  const port = { kind: 'new-port' } as unknown as MessagePort
  platform.connect.mockResolvedValueOnce({ route: 'vf-route-2', port })
  const next = new VideoEditRenderSession(composition())
  await expect(next.present(7)).resolves.toMatchObject({ presented: true })
  expect(workers[1].messages).toContainEqual(expect.objectContaining({ message: { kind: 'nativeFrames.attach', port }, transfer: [port] }))
  await next.dispose()
})

it('Worker 内未捕获异常回报保留真实堆栈并结束请求，释放后的警告日志仍转发', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.prepareGpu()
  const worker = workers[0]; worker.respond = false
  const pending = session.present(0), rejected = expect(pending).rejects.toBeInstanceOf(VideoEditRenderWorkerError)
  const context = { message: 'missingSymbol is not defined', filename: 'blob:author', line: 7, column: 3, stack: 'ReferenceError: missingSymbol is not defined\n at blob:author:7:3' }
  worker.onmessage!({ data: { kind: 'log', level: 'warn', message: '原始线程异常', event: 'video_edit.render.worker.uncaught_error', context } } as MessageEvent)
  await rejected
  expect(session.terminated).toBe(true)
  expect(platform.logs).toContainEqual(expect.objectContaining({ meta: expect.objectContaining({ event: 'video_edit.render.worker.uncaught_error', context }) }))
  worker.onmessage!({ data: { kind: 'log', level: 'warn', message: '释放警告', event: 'video_edit.render.dispose.warning', context: {} } } as MessageEvent)
  expect(platform.logs).toContainEqual(expect.objectContaining({ message: '释放警告' }))
})
it('未处理的 Promise 拒绝只记日志，不终止会话或打断在途画面，后续仍能出帧', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.prepareGpu()
  const worker = workers[0]; worker.respond = false
  let completed = false
  const pending = session.present(4).then(result => { completed = true; return result })
  await Promise.resolve()
  const context = { message: 'Failed to fetch', stack: 'TypeError: Failed to fetch\n at blob:author:3:7' }
  worker.onmessage!({ data: { kind: 'log', level: 'warn', message: '异步拒绝', event: 'video_edit.render.worker.unhandled_rejection', context } } as MessageEvent)
  await Promise.resolve()
  expect(session.terminated).toBe(false); expect(session.terminalError).toBeUndefined()
  expect(worker.terminate).not.toHaveBeenCalled(); expect(completed).toBe(false)
  expect(platform.logs).toContainEqual(expect.objectContaining({ meta: expect.objectContaining({ event: 'video_edit.render.worker.unhandled_rejection', context }) }))
  const request = worker.messages.at(-1)!.message
  if (!('id' in request)) throw new Error('渲染请求未发送。')
  worker.onmessage!({ data: { id: request.id, presented: true } } as MessageEvent)
  expect(await pending).toMatchObject({ presented: true })
  worker.respond = true
  await expect(session.present(5)).resolves.toMatchObject({ presented: true })
  await session.dispose()
})

it('正常回执及主动释放清理请求期限，不留下延迟终止', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.prepareGpu()
  vi.useFakeTimers()
  await session.present(0)
  expect(vi.getTimerCount()).toBe(0)
  const old = workers[0]; old.respond = false
  const pending = session.present(1); const failure = expect(pending).rejects.toThrow('已关闭')
  await Promise.resolve()
  old.respond = true
  await session.dispose(); await failure
  expect(vi.getTimerCount()).toBe(0)
  expect(old.terminate).toHaveBeenCalledOnce()
})

it('请求排满时按背压拒绝（可识别的忙碌错误），不终止会话，空出位置后照常出画', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.prepareGpu()
  const worker = workers[0]; worker.respond = false
  const queued = [0, 1, 2, 3].map(frame => session.present(frame))
  await Promise.resolve(); await Promise.resolve()
  const busy = await session.present(4).catch((error: unknown) => error)
  expect(busy).toBeInstanceOf(VideoEditRenderBusyError)
  expect(worker.terminate).not.toHaveBeenCalled()
  const first = worker.messages.find(entry => entry.message.kind === 'render')!.message as Extract<RenderRequest, { kind: 'render' }>
  worker.onmessage!({ data: { id: first.id, presented: true } } as MessageEvent)
  await expect(queued[0]).resolves.toMatchObject({ presented: true })
  worker.respond = true
  await expect(session.present(5)).resolves.toMatchObject({ presented: true })
  await session.dispose()
  await Promise.allSettled(queued)
})

it('历史帧复制只随显式录制请求，过期回执释放位图', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.present(3, false, false, undefined, undefined, undefined, 'interactive', true)
  expect(workers[0].messages.find(value => value.message.kind === 'render')?.message).toMatchObject({ history: true, frame: 3 })
  const close = vi.fn()
  workers[0].onmessage!({ data: { id: 9999, history: { close } } } as unknown as MessageEvent)
  expect(close).toHaveBeenCalledOnce()
  await session.dispose()
})
it('预览请求 interactive，正式导出入口请求 final，复用同一 Worker 链路', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.present(0)
  await session.render(1, true)
  const renders = workers[0].messages.map(value => value.message).filter(value => value.kind === 'render')
  expect(renders).toEqual([
    expect.objectContaining({ kind: 'render', frame: 0, quality: 'interactive' }),
    expect.objectContaining({ kind: 'render', frame: 1, sequential: true, quality: 'final' }),
  ])
  await session.dispose()
})

it('60 effect moves send only effect deltas, without media/source/font payloads; structural edits resync', async () => {
  const document = composition()
  document.clips = [videoEditClipSchema.parse({ id: 'clip', itemId: 'item', kind: 'video', name: '片段', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', effects: [{ id: 'grade', name: '调色', enabled: true, amount: 1, builtin: { id: 'color_grade', params: {} } }] })]
  const session = new VideoEditRenderSession(document, 1280)
  await session.present(0)
  for (let i = 1; i <= 60; i++) await session.updateDocument({ ...document, revision: i, clips: [{ ...document.clips[0], x: i / 100, scale: 1 + i / 100, rotation: i, effects: [{ ...document.clips[0].effects![0], builtin: { id: 'color_grade', params: { exposure: i / 60 } } }] }] })
  const parameters = workers[0].messages.map(value => value.message).filter(value => value.kind === 'parameters')
  expect(parameters).toHaveLength(60)
  expect(parameters[59]).toMatchObject({ update: { baseRevision: 59, revision: 60, patches: [{ clipId: 'clip', layout: { x: .6, scale: 1.6, rotation: 60 }, effects: [{ id: 'grade', value: { builtin: { params: { exposure: 1 } } } }] }] } })
  expect(parameters.every(value => !('document' in value) && !('codeSources' in value))).toBe(true)
  expect(workers[0].messages.filter(value => value.message.kind === 'update')).toHaveLength(0)
  await session.updateDocument({ ...document, revision: 61, width: 3840 })
  expect(workers[0].messages.filter(value => value.message.kind === 'update')).toHaveLength(1)
  await session.dispose()
})

it('遮罩更新按序列与版本关联首次出画，日志给出帧延迟，后续重画不重复计延迟', async () => {
  const document = composition(); const session = new VideoEditRenderSession(document,1280)
  await session.present(0)
  const updated = {...document,revision:1}
  recordVideoEditMaskUpdate(updated.id,updated.revision,performance.now()-12)
  await session.updateDocument(updated)
  await session.present(0)
  const events=platform.logs.filter(value=>value.level==='debug')
  expect(events).toHaveLength(1)
  const context=(events[0].meta as {context:{durationMs:number;displayFrames:number;revision:number}}).context
  expect(context.durationMs).toBeGreaterThanOrEqual(12)
  expect(context.displayFrames).toBeCloseTo(context.durationMs*60/1000)
  expect(context.revision).toBe(1)
  await session.present(1)
  expect(platform.logs.filter(value=>value.level==='debug')).toHaveLength(1)
  await session.dispose()
})

it('离屏跟踪RGB尺寸进入既有渲染Worker请求，不开启第二条渲染路径', async () => {
  const session = new VideoEditRenderSession(composition(), 1280)
  await session.present(60, false, false, undefined, undefined, { width: 512, height: 512 })
  expect(workers[0].messages.at(-1)?.message).toMatchObject({ kind: 'render', frame: 60, sequential: false, readRgb: { width: 512, height: 512 } })
  await session.dispose()
})

it('预览与导出 Worker 接收完整嵌套图，子序列保持原始尺寸/PAR，媒体仅在共同入口转换', async () => {
  const root = composition(); const child = { ...root, id: 'child', name: '子序列', pixelAspectRatio: { numerator: 2, denominator: 1 } }
  const document = { ...root, sequences: [root, child], items: [{ id: 'nested-item', name: '嵌套', kind: 'sequence' as const, sequenceId: 'child' }] }
  for (const previewWidth of [960, undefined]) {
    const session = new VideoEditRenderSession(document, previewWidth); await session.present(0)
    const init = workers.at(-1)!.messages.find(value => value.message.kind === 'init')!.message as Extract<RenderRequest, { kind: 'init' }>
    expect(init.document.sequences).toEqual(document.sequences)
    expect(init.document.items).toEqual(document.items)
    expect(init.document.media[0].path).toBe(`url:${root.media[0].path}`)
    await session.dispose()
  }
})

it('LUT 在预览/导出共用会话边界授权并转换，新引用更新后也转换；项目路径保持原样', async () => {
  const path = resolve(sep, 'luts', 'look.cube').replace(/\\/g, '/'); const root = resolve(sep, 'luts').replace(/\\/g, '/'); const other = resolve(sep, 'other', 'input.cube').replace(/\\/g, '/')
  const document = { ...composition(), colorLuts: [{ id: 'lut', name: 'Look', path, contentIdentity: 'a'.repeat(64) }] }
  const session = new VideoEditRenderSession(document); await session.present(0)
  expect(platform.allowRoot).toHaveBeenCalledWith(root)
  const init = workers[0].messages.find(value => value.message.kind === 'init')!.message as Extract<RenderRequest, { kind: 'init' }>
  expect(init.document.colorLuts?.[0].path).toBe(`url:${path}`); expect(document.colorLuts[0].path).toBe(path)
  await session.updateDocument({ ...document, colorLuts: [...document.colorLuts, { ...document.colorLuts[0], id: 'new', path: other }] })
  expect(platform.allowRoot).toHaveBeenCalledTimes(2)
  expect(workers[0].messages.at(-1)?.message).toMatchObject({ kind: 'update', document: { colorLuts: [{ path: `url:${path}` }, { path: `url:${other}` }] } })
  await session.dispose()
})

it('跟踪结果带版本原样发送 Worker，关闭后不再发送', async () => {
  const session = new VideoEditRenderSession(composition())
  const tracks = { key: { url: 'henji-media://local/track.htrk', version: '2' } }
  session.setTracks(tracks)
  expect(workers[0].messages[0].message).toEqual({ kind: 'tracks', tracks, id: 0 })
  await session.present(0); await session.dispose()
  const count = workers[0].messages.length
  session.setTracks({}); expect(workers[0].messages.length).toBe(count)
})

it('原生可用时先把帧通道端口交给 Worker 再初始化，并附上本地源文件路径；关闭后断开通道', async () => {
  const session = new VideoEditRenderSession(composition())
  await session.present(0)
  const [attach, init] = workers[0].messages
  expect(attach.message).toEqual({ kind: 'nativeFrames.attach', port: { kind: 'port' } }); expect(attach.transfer).toEqual([{ kind: 'port' }])
  expect(init.message).toMatchObject({ kind: 'init', decode: { nativeAvailable: true, localPaths: { 'url:D:/prores.mov': 'D:/prores.mov' } } })
  expect((init.message as Extract<RenderRequest, { kind: 'init' }>).document.media.map(media => media.path)).toEqual(['url:D:/prores.mov', 'url:D:/a.png', 'url:https://example.com/a.mp4'])
  const replacement = composition(); replacement.media[0].sourceRevision = 'replacement'
  await session.updateDocument({ ...replacement, revision: 1 })
  expect(workers[0].messages.at(-1)?.message).toMatchObject({ kind: 'update', localPaths: { 'url:D:/prores.mov': 'D:/prores.mov' } })
  await session.dispose()
  expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(platform.disconnect).toHaveBeenCalledWith('vf-route-1')
})

it('诊断强制浏览器或原生不可用时不建立通道；建立失败记警告并只用后备解码', async () => {
  platform.status.mockResolvedValue({ available: true, forcedBackend: 'browser' })
  const forced = new VideoEditRenderSession(composition()); await forced.present(0)
  expect(platform.connect).not.toHaveBeenCalled()
  expect(workers[0].messages[0].message).toMatchObject({ kind: 'init', decode: { nativeAvailable: false, forced: 'browser' } })
  platform.status.mockResolvedValue({ available: true, forcedBackend: null }); platform.connect.mockRejectedValue(new Error('显卡帧通道建立超时。'))
  const failed = new VideoEditRenderSession(composition()); await failed.present(0)
  expect(workers[1].messages[0].message).toMatchObject({ kind: 'init', decode: { nativeAvailable: false } })
  expect(platform.logs.filter(entry => entry.level === 'warn')).toEqual([expect.objectContaining({ level: 'warn', meta: expect.objectContaining({ event: 'video_edit.decode.native.channel_failed' }) })])
  await Promise.all([forced.dispose(), failed.dispose()]); expect(platform.disconnect).not.toHaveBeenCalled()
})

it('Worker 的结构化日志经会话写入应用日志，不当作请求回执', async () => {
  const session = new VideoEditRenderSession(composition()); await session.present(0)
  workers[0].onmessage?.({ data: { kind: 'log', level: 'info', message: '剪辑素材解码方式已确定', event: 'video_edit.decode.backend.selected', context: { backend: 'native' } } } as MessageEvent)
  expect(platform.logs.at(-1)).toEqual({ level: 'info', message: '剪辑素材解码方式已确定', meta: { event: 'video_edit.decode.backend.selected', context: { backend: 'native' } } })
  await session.dispose()
})

it('代理进入明确预览或代理导出会话，默认导出与抓原片保持原片；声音保留原路径', async () => {
  const document = composition()
  const proxy = { path: 'D:/cache/proxy.mp4', key: 'a'.repeat(64), contentIdentity: 'b'.repeat(64), preset: '720p' as const, width: 1280, height: 720, bytes: 1024 }
  proxyState.sources = { pro: proxy }
  const preview = new VideoEditRenderSession(document, 1920, undefined, undefined, undefined, 'project')
  await preview.present(0)
  const init = workers[0].messages.find(value => value.message.kind === 'init')!.message as Extract<RenderRequest, { kind: 'init' }>
  expect(init.decode?.proxies?.pro.path).toBe('url:D:/cache/proxy.mp4')
  expect(init.decode?.localPaths?.['url:D:/cache/proxy.mp4']).toBe(proxy.path)
  expect(init.document.media[0]).toMatchObject({ path: 'url:D:/prores.mov', sourceRevision: `:proxy:${proxy.key}` })
  await preview.updateDocument(document, true)
  expect(workers[0].messages.at(-1)!.message).toMatchObject({ kind: 'update', proxies: {}, document: { media: [expect.objectContaining({ path: 'url:D:/prores.mov' }), expect.anything(), expect.anything()] } })
  proxyState.sources = {}; await preview.updateDocument(document)
  expect(workers[0].messages.at(-1)!.message).toMatchObject({ proxies: {} })
  proxyState.sources = { pro: proxy }
  const exported = new VideoEditRenderSession(document); await exported.present(0)
  const exportInit = workers[1].messages.find(value => value.message.kind === 'init')!.message as Extract<RenderRequest, { kind: 'init' }>
  expect(exportInit.decode?.proxies).toEqual({}); expect(exportInit.document.media[0].sourceRevision).toBeUndefined()
  const proxyExport = new VideoEditRenderSession(document, undefined, undefined, undefined, undefined, 'p', true); await proxyExport.present(0)
  const proxyInit = workers[2].messages.find(value => value.message.kind === 'init')!.message as Extract<RenderRequest, { kind: 'init' }>
  expect(proxyInit.decode?.proxies).toEqual({ pro: { ...proxy, path: 'url:' + proxy.path } }); expect(proxyInit.document.media[0].path).toBe('url:D:/prores.mov')
  await Promise.all([preview.dispose(), exported.dispose(), proxyExport.dispose()])
})

it('空闲会话准备 GPU 后只允许接管一次，项目接管后使用该项目的文档配置', async () => {
  const session = new VideoEditRenderSession(composition(), 32)
  await session.prepareGpu()
  expect(workers[0].messages.some(value => value.message.kind === 'prepareGpu')).toBe(true)
  session.adoptProject('project')
  expect(() => session.adoptProject('another')).toThrow('接管')
  await session.updateDocument({ ...composition(), id: 'another-sequence' })
  expect(workers).toHaveLength(1)
  await session.dispose()
  expect(platform.disconnect).toHaveBeenCalledOnce()
})

it('切换预打开在普通文档更新前发送，交给 Worker 按首帧前瞻挑选视频，重复切换合并为最新目标', async () => {
  const document = composition()
  document.items = [{ id: 'video', name: '视频', kind: 'video', mediaId: 'pro' }]
  document.tracks = [{ id: 'v', name: '视频', index: 1, kind: 'video', enabled: true, locked: false, muted: false, solo: false }]
  document.clips = [videoEditClipSchema.parse({ id: 'clip', itemId: 'video', name: '视频', kind: 'video', track: 1, start: 0, duration: 120, sourceInUs: 3500000, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' })]
  const session = new VideoEditRenderSession(composition(), 1920)
  await session.prepareGpu()
  session.preopenSequence(document, 0)
  session.preopenSequence({ ...document, id: 'latest' }, 0)
  for (let i = 0; i < 12; i++) await Promise.resolve()
  const messages = workers[0].messages.filter(value => value.message.kind === 'preopen')
  expect(messages).toHaveLength(1)
  expect(messages[0].message).toMatchObject({ frame: 0, document: { id: 'latest', media: expect.arrayContaining([expect.objectContaining({ id: 'pro', path: `url:${document.media[0].path}` })]) } })
  expect(workers[0].messages.some(value => value.message.kind === 'update')).toBe(false)
  await session.dispose()
})


it('录制日志在会话边界授权和转换，预览与导出共用原始时钟引用，原文档不写入临时地址', async () => {
  const log = await recordingCursorFixture()
  const document = composition()
  const file = path.resolve(path.sep, 'capture', 'events.json')
  document.media[0].recordingCursor = { ...log.source, pages: log.source.pages.map(page => ({ ...page, path: file })) }
  const session = new VideoEditRenderSession(document)
  try {
    await session.present(0)
    const init = workers[0].messages.find(value => value.message.kind === 'init')!.message as Extract<RenderRequest, { kind: 'init' }>
    expect(init.document.media[0].recordingCursor!.pages[0].path).toBe(`url:${file}`)
    expect(init.document.media[0].recordingCursor!.recordingStartUs).toBe(0)
    expect(document.media[0].recordingCursor!.pages[0].path).toBe(file)
    await session.render(60, true)
    expect(workers[0].messages.at(-1)!.message).toMatchObject({ kind: 'render', quality: 'final' })
  } finally { await session.dispose() }
})

it('要求原片且当前没有加载代理时，参数修改仍走增量更新；已加载代理时才整体更新并卸掉代理', async () => {
  const project = createVideoEditTestDocument('参数更新')
  project.items = [{ id: 'item', name: '画面', kind: 'text' }]
  project.sequences[0].clips = [makeVideoEditItemClip(project, 'item', project.sequences[0].id, { frame: 0 })]
  const before = videoEditComposition(project, project.sequences[0].id)
  const moved = { ...before, revision: 1, clips: [{ ...before.clips[0], opacity: .5 }] }
  const plain = new VideoEditRenderSession(before, undefined, undefined, undefined, undefined, 'project')
  await plain.prepareGpu()
  await plain.updateDocument(moved, true)
  expect(workers.at(-1)!.messages.at(-1)!.message.kind).toBe('parameters')
  await plain.dispose()
  proxyState.sources = { pro: { key: 'k', path: 'D:/proxy.mp4', width: 960, height: 540 } as unknown as import('@/core/videoEdit/proxy').VideoProxyResult }
  const proxied = new VideoEditRenderSession(before, undefined, undefined, undefined, undefined, 'project')
  await proxied.prepareGpu()
  await proxied.updateDocument(moved, true)
  const update = workers.at(-1)!.messages.at(-1)!.message as Extract<RenderRequest, { kind: 'update' }>
  expect(update.kind).toBe('update'); expect(update.proxies).toEqual({})
  await proxied.dispose()
})
