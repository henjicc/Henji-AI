// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createImageVideoApis } from '../../../../electron/preload/image-video-api'
import { registerVideoIpc } from '../../../../electron/main/ipc/video'
import { compressFirstVideoIfNeeded, trimFirstVideoIfSelected } from '@/core/services/generationRequestPreflight'
import { createElectronVideo } from './video'
import { compressVideoToFit } from '@/commands/video'
import type { IpcMainInvokeEvent } from 'electron'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { ModelDefinition } from '@/core/types'

const clipPath = path.resolve(path.sep, 'media', 'clip.mp4')
const compressedPath = path.resolve(path.sep, 'media', 'compressed.mp4')

type Handler = (payload: unknown, event: IpcMainInvokeEvent) => unknown
const mock = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), compress: vi.fn(), trim: vi.fn(), warn: vi.fn() }))
vi.mock('electron', () => ({ ipcRenderer: { on: vi.fn(), removeListener: vi.fn() } }))
vi.mock('../../../../electron/main/ipc/registry', () => ({
  parseRecord: (input: unknown) => input,
  parseStringField: (input: Record<string, unknown>, key: string) => input[key],
  registerIpcHandler: (id: string, parse: (input: unknown) => unknown, handler: Handler) => mock.handlers.set(id, (input, event) => handler(parse(input), event)),
}))
vi.mock('../../../../electron/main/services/video/ops', () => ({ compressVideoToFit: mock.compress, trimVideoSource: mock.trim, readVideoInfo: vi.fn(), generateVideoThumbnail: vi.fn(), generateVideoThumbnailBytes: vi.fn() }))
vi.mock('../../../../electron/main/services/video/frame-export', () => ({ startVideoFrameExport: vi.fn(), appendVideoFrameExport: vi.fn(), finishVideoFrameExport: vi.fn(), cancelVideoFrameExport: vi.fn() }))
vi.mock('../../../../electron/main/services/video/preview-cache', () => ({ clearLegacyVideoPreviewCache: vi.fn() }))
vi.mock('../../../../electron/main/services/asset-library/thumbnailService', () => ({ ensureAssetThumbnail: vi.fn() }))
vi.mock('../../../../electron/main/protocol', () => ({ allowMediaRoot: vi.fn(), isPathWithinAllowedMediaRoots: vi.fn() }))
vi.mock('../../../../electron/main/services/image/source', () => ({ normalizeLocalSource: (value: string) => value }))
vi.mock('../../../../electron/main/services/video/filmstrip', () => ({ filmstripService: vi.fn() }))
vi.mock('@/core/inputs/inputLimits', () => ({ resolveInputLimits: () => ({ videoConstraints: { maxSizeMB: 10 } }) }))
vi.mock('@/commands/image', () => ({ cropImageSource: vi.fn(), readImageInfo: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ video: createElectronVideo() }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: mock.warn, error: vi.fn() }) }))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); mock.handlers.clear() })

it('取消请求发送失败通过命令返回并记录，不无限等待原处理或吞掉失败', async () => {
  const failure = new Error('取消 IPC 发送失败')
  const native = {
    compressVideoToFit: vi.fn(() => new Promise<never>(() => undefined)),
    cancelProcessing: vi.fn().mockRejectedValue(failure),
  }
  vi.stubGlobal('window', { henjiNative: { video: native } })
  const controller = new AbortController()
  const pending = compressVideoToFit(clipPath, 10, controller.signal)
  const rejected = expect(pending).rejects.toBe(failure)
  controller.abort()
  await rejected
  expect(mock.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error: failure }))
}, 1000)

it('已取消不启动原生处理，迟到成功也不能返回给已取消调用者', async () => {
  const invoke = vi.fn(async <T,>(): Promise<T> => ({} as T))
  const native = createImageVideoApis(<T,>() => invoke() as Promise<T>).videoApi
  vi.stubGlobal('window', { henjiNative: { video: native } })
  const controller = new AbortController(); controller.abort()
  await expect(createElectronVideo().compressVideoToFit({ source: clipPath, maxSizeMB: 10 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(invoke).not.toHaveBeenCalled()
  const active = new AbortController()
  let complete!: (value: { path: string; sizeBytes: number }) => void
  native.compressVideoToFit = () => new Promise(resolve => { complete = resolve })
  const pending = createElectronVideo().compressVideoToFit({ source: clipPath, maxSizeMB: 10 }, active.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  active.abort(); complete({ path: compressedPath, sizeBytes: 3 })
  await rejected
})

it.each(['compress', 'trim'] as const)('%s 预检取消沿 commands/platform/preload/IPC 到达进程，不发送 signal 对象', async kind => {
  registerVideoIpc()
  const sender = Object.assign(new EventEmitter(), { id: 105 })
  const event = { sender } as unknown as IpcMainInvokeEvent
  const invoke = vi.fn(async <T,>(id: string, payload?: unknown): Promise<T> => await mock.handlers.get(id)!(payload, event) as T)
  vi.stubGlobal('window', { henjiNative: { video: createImageVideoApis(async <T,>(id: string, payload?: unknown) => await invoke(id, payload) as T).videoApi } })
  const operation = kind === 'compress' ? mock.compress : mock.trim
  let processSignal: AbortSignal | undefined
  operation.mockImplementation((_payload, signal: AbortSignal) => {
    processSignal = signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const controller = new AbortController()
  const params = { uploadedVideoFilePaths: [clipPath], uploadedVideoTrimStart: 0, uploadedVideoTrimEnd: 5 }
  const pending = kind === 'compress'
    ? compressFirstVideoIfNeeded({ meta: { id: 'test' } } as ModelDefinition, params, controller.signal)
    : trimFirstVideoIfSelected(params, controller.signal)
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(processSignal).toBeDefined())
  controller.abort()
  await vi.waitFor(() => expect(processSignal?.aborted).toBe(true))
  await rejection
  const payload = invoke.mock.calls[0][1] as Record<string, unknown>
  expect(payload.requestId).toEqual(expect.any(String)); expect(payload).not.toHaveProperty('signal')
  expect(invoke).toHaveBeenCalledWith('video:cancelProcessing', { requestId: payload.requestId })
  sender.emit('destroyed')
})
