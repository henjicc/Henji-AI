import { beforeEach, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { RenderRequest } from './videoEditWorker'
import { recordVideoEditMaskUpdate } from '../application/videoEditMaskEditing'

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
  readonly messages: Array<{ message: RenderRequest | { kind: string; port?: unknown }; transfer: unknown[] }> = []
  onmessage?: (event: MessageEvent) => void
  onerror?: unknown
  terminate = vi.fn()
  constructor() { workers.push(this) }
  postMessage(message: RenderRequest, transfer: unknown[] = []) {
    this.messages.push({ message, transfer })
    if ('id' in message && message.id) queueMicrotask(() => this.onmessage?.({ data: { id: message.id, presented: true } } as MessageEvent))
  }
}
vi.stubGlobal('Worker', FakeWorker)
vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} })

const { VideoEditRenderSession } = await import('./videoEditRenderSession')
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
  const document = { ...composition(), lumetriLuts: [{ id: 'lut', name: 'Look', path, contentIdentity: 'a'.repeat(64) }] }
  const session = new VideoEditRenderSession(document); await session.present(0)
  expect(platform.allowRoot).toHaveBeenCalledWith(root)
  const init = workers[0].messages.find(value => value.message.kind === 'init')!.message as Extract<RenderRequest, { kind: 'init' }>
  expect(init.document.lumetriLuts?.[0].path).toBe(`url:${path}`); expect(document.lumetriLuts[0].path).toBe(path)
  await session.updateDocument({ ...document, lumetriLuts: [...document.lumetriLuts, { ...document.lumetriLuts[0], id: 'new', path: other }] })
  expect(platform.allowRoot).toHaveBeenCalledTimes(2)
  expect(workers[0].messages.at(-1)?.message).toMatchObject({ kind: 'update', document: { lumetriLuts: [{ path: `url:${path}` }, { path: `url:${other}` }] } })
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
  await session.updateDocument({ ...composition(), revision: 1 })
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
  expect(platform.logs).toEqual([expect.objectContaining({ level: 'warn', meta: expect.objectContaining({ event: 'video_edit.decode.native.channel_failed' }) })])
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
