import { beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { RenderRequest } from './videoEditWorker'

const platform = vi.hoisted(() => ({
  status: vi.fn(async () => ({ available: true, forcedBackend: null as 'native' | 'browser' | null })),
  connect: vi.fn(async () => ({ route: 'vf-route-1', port: { kind: 'port' } as unknown as MessagePort })),
  disconnect: vi.fn(),
  logs: [] as Array<{ level: string; message: string; meta: unknown }>,
}))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ videoDecoder: { status: platform.status }, videoFrames: { connect: platform.connect, disconnect: platform.disconnect } }) }))
vi.mock('@/services/imageSource', () => ({ toFetchableMediaUrl: (path: string) => `url:${path}`, isLikelyLocalImagePath: (path: string) => /^[A-Z]:/.test(path) }))
vi.mock('../videoEditMediaContent', () => ({ VideoEditMediaContentVerifier: class { async check() {} dispose() {} } }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: (message: string, meta: unknown) => platform.logs.push({ level: 'info', message, meta }), warn: (message: string, meta: unknown) => platform.logs.push({ level: 'warn', message, meta }) }) }))

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
  workers.length = 0; platform.logs = []
  platform.status.mockReset().mockResolvedValue({ available: true, forcedBackend: null })
  platform.connect.mockReset().mockResolvedValue({ route: 'vf-route-1', port: { kind: 'port' } as unknown as MessagePort })
  platform.disconnect.mockReset()
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
