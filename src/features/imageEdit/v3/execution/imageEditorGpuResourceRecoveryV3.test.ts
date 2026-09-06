import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3PyramidDescriptor, ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuSceneClientV3 } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3, ImageEditorGpuSceneWorkerPortV3, ImageEditorGpuSceneWorkerRequestV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { ImageEditorRenderSessionGpuBridgeV3 } from './imageEditorRenderSessionGpuBridgeV3'
import { description } from '../export/renderExportTestFixtures'

const { readTiles } = vi.hoisted(() => ({ readTiles: vi.fn() }))
vi.mock('@/commands/imageEditorV3Tiles', () => ({ readImageEditorV3SourceTiles: readTiles }))
const REF = `sha256:${'a'.repeat(64)}` as const
const pyramid: ImageEditorV3PyramidDescriptor = {
  tileSize: 512, levels: [{ mip: 0, width: 8, height: 8, columns: 1, rows: 1 }],
}
const layout = { stageWidth: 8, stageHeight: 8, viewportKey: 'test',
  viewport: { documentX: 0, documentY: 0, width: 8, height: 8, zoom: 1, devicePixelRatio: 1 } }
const tile: ImageEditorV3SourceTile = {
  resourceRef: REF, mip: 0, tileX: 0, tileY: 0, halo: 0, width: 8, height: 8, channels: 4,
  bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian',
  rowStride: 32, colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight',
  orientationApplied: true, originX: 0, originY: 0, pixels: new ArrayBuffer(256),
}
const tilesNeeded = (deviceGeneration = 1): ImageEditorGpuSceneWorkerEventV3 => ({
  type: 'tiles-needed', sceneGeneration: 1, deviceGeneration,
  keys: [{ resourceRef: REF, mip: 0, tileX: 0, tileY: 0, contentVersion: '1' }],
})
function snapshot(generation = 1) {
  return { document: createImageEditDocumentV3({ width: 8, height: 8, sourceResourceId: REF }),
    renderGeneration: generation, geometryHash: 'geometry', quality: 'stable' as const,
    resourceDescriptors: [{ resourceRef: REF, mediaType: 'image/png', byteLength: 256 }] }
}
function deferred() {
  let resolve!: (value: ImageEditorV3PyramidDescriptor) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ImageEditorV3PyramidDescriptor>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const disposers: Array<() => void> = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.useRealTimers(); readTiles.mockReset() })
function harness(reader: () => Promise<ImageEditorV3PyramidDescriptor>) {
  const messages: ImageEditorGpuSceneWorkerRequestV3[] = []
  const port: ImageEditorGpuSceneWorkerPortV3 = {
    onmessage: null, onerror: null, postMessage: (message) => { messages.push(message) }, terminate: vi.fn(),
  }
  const client = new ImageEditorGpuSceneClientV3({ sessionId: 'resource-recovery', workerFactory: () => port, sourcePyramidReader: reader })
  const publish = vi.fn()
  const bridge = new ImageEditorRenderSessionGpuBridgeV3('resource-recovery', client, publish)
  disposers.push(() => bridge.dispose())
  const emit = (event: ImageEditorGpuSceneWorkerEventV3) => port.onmessage?.({ data: event } as MessageEvent<ImageEditorGpuSceneWorkerEventV3>)
  const ready = (generation = 1, recovered = false) => emit({ type: 'ready', sceneGeneration: 0, deviceGeneration: generation, recovered })
  const lost = () => emit({ type: 'device-lost', sceneGeneration: 0, deviceGeneration: 1, reason: 'test loss', retryAfterMs: 1 })
  bridge.updateViewport(1, layout)
  const sync = (generation = 1) => { const current = snapshot(generation); bridge.syncSnapshot(current); return current }
  const renders = () => messages.filter((message) => message.type === 'render')
  return { bridge, client, messages, publish, emit, ready, lost, sync, renders }
}

describe('正式 GPU client + bridge 的资源与设备独立恢复', () => {
  it.each([true, false])('元数据失败与 ready 顺序（readyFirst=%s）不丢设备，下一快照自行恢复绘制', async (readyFirst) => {
    const first = deferred()
    const reader = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(pyramid)
    const h = harness(reader)
    h.sync()
    if (readyFirst) h.ready()
    first.reject(new Error('资源暂不可读'))
    await vi.waitFor(() => expect(h.publish).toHaveBeenCalledWith(expect.objectContaining({ compositionBackend: 'cpu' })))
    if (!readyFirst) h.ready()
    expect(h.renders()).toHaveLength(0)
    h.sync(2)
    await vi.waitFor(() => expect(h.renders()).toHaveLength(1))
    expect(h.renders()[0]).toMatchObject({ sceneGeneration: 2 })
    expect(h.messages.filter((message) => message.type === 'initialize')).toHaveLength(1)
  })

  it('暂态元数据自动只重试一次，成功后不需要新快照或第二个 device', async () => {
    vi.useFakeTimers()
    const reader = vi.fn().mockRejectedValueOnce(new Error('temporary I/O busy')).mockResolvedValue(pyramid)
    const h = harness(reader)
    h.sync(); h.ready()
    await vi.advanceTimersByTimeAsync(300)
    expect(reader).toHaveBeenCalledTimes(2)
    expect(h.renders()).toHaveLength(1)
    expect(h.messages.filter((message) => message.type === 'initialize')).toHaveLength(1)
  })

  it.each(['temporary I/O busy', 'EACCES permission denied', 'invalid image format'])('失败不会无限重试或重试永久错误（%s）', async (message) => {
    vi.useFakeTimers()
    const reader = vi.fn().mockRejectedValue(new Error(message))
    const h = harness(reader)
    h.sync(); h.ready()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reader).toHaveBeenCalledTimes(message.startsWith('temporary') ? 2 : 1)
    expect(h.renders()).toHaveLength(0)
  })

  it.each(['lost', 'dispose', 'new-scene'] as const)('资源重试前 %s 取消旧工作，旧完成不得启动绘制', async (action) => {
    vi.useFakeTimers()
    const reader = vi.fn().mockRejectedValueOnce(new Error('temporary I/O busy')).mockResolvedValue(pyramid)
    const h = harness(reader)
    h.sync(); h.ready()
    await vi.advanceTimersByTimeAsync(1)
    if (action === 'lost') h.lost()
    if (action === 'dispose') h.bridge.dispose()
    if (action === 'new-scene') h.sync(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(reader).toHaveBeenCalledTimes(action === 'new-scene' ? 2 : 1)
    expect(h.renders()).toHaveLength(action === 'new-scene' ? 1 : 0)
    if (action === 'lost') {
      h.ready() // 丢失设备的迟到 ready 不能复活它。
      expect(h.renders()).toHaveLength(0)
      h.ready(2, true)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.renders()).toHaveLength(1)
    }
  })

  it('资源失败立即终止排队导出；资源恢复后同一设备允许新的导出', async () => {
    const first = deferred()
    const h = harness(vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(pyramid))
    const current = h.sync(); h.ready()
    const request = { document: current.document, resourceDescriptors: current.resourceDescriptors, description: description(8, 8) }
    const stream = h.bridge.renderExport(request)!
    const next = stream[Symbol.asyncIterator]().next()
    const rejected = expect(next).rejects.toThrow('读取图片资源几何失败')
    first.reject(new Error('资源缺失'))
    await rejected
    h.bridge.syncSnapshot({ ...current, renderGeneration: 2 })
    await vi.waitFor(() => expect(h.renders()).toHaveLength(1))
    const iterator = h.bridge.renderExport(request)![Symbol.asyncIterator]()
    const result = iterator.next()
    const message = [...h.messages].reverse().find((entry) => entry.type === 'export')!
    expect(message).toMatchObject({ type: 'export', sceneGeneration: 2 })
    if (message.type !== 'export') throw new Error('缺少导出请求')
    h.emit({ type: 'export-tile', sceneGeneration: 2, deviceGeneration: 1,
      requestId: message.requestId, tileX: 0, tileY: 0, x: 0, y: 0, width: 8, height: 8,
      rowStride: 32, pixels: new ArrayBuffer(256), completed: true })
    expect((await result).value).toMatchObject({ width: 8, height: 8 })
    await iterator.return?.()
  })

  it('上一场景设备已就绪时，新场景导出仍等待自己的资源门禁', async () => {
    const second = deferred()
    const h = harness(vi.fn().mockResolvedValueOnce(pyramid).mockImplementationOnce(() => second.promise))
    h.sync(); h.ready()
    await vi.waitFor(() => expect(h.renders()).toHaveLength(1))
    const startExport = vi.spyOn(h.client, 'requestExport')
    const current = h.sync(2)
    const iterator = h.bridge.renderExport({ document: current.document,
      resourceDescriptors: current.resourceDescriptors, description: description(8, 8) })![Symbol.asyncIterator]()
    expect(startExport).not.toHaveBeenCalled()
    const next = iterator.next()
    second.resolve(pyramid)
    await vi.waitFor(() => expect(startExport).toHaveBeenCalledOnce())
    const request = startExport.mock.calls[0][0]
    h.emit({ type: 'export-tile', sceneGeneration: 2, deviceGeneration: 1,
      requestId: request.requestId, tileX: 0, tileY: 0, x: 0, y: 0, width: 8, height: 8,
      rowStride: 32, pixels: new ArrayBuffer(256), completed: true })
    expect((await next).value).toMatchObject({ width: 8, height: 8 })
    await iterator.return?.()
  })

  it.each([true, false])('资源 pending=%s 的设备恢复保留最新场景、相机和手势消息顺序', async (pending) => {
    const second = deferred()
    const h = harness(vi.fn().mockResolvedValueOnce(pyramid)
      .mockImplementationOnce(() => second.promise).mockResolvedValue(pyramid))
    h.sync(); h.ready()
    await vi.waitFor(() => expect(h.renders()).toHaveLength(1))
    const current = h.sync(2)
    const layerId = current.document.layers[0].id
    const movedLayout = { ...layout, viewport: { ...layout.viewport, documentX: 7, documentY: 3 } }
    h.bridge.updateViewport(2, movedLayout)
    h.bridge.updateTransientLayerTransform(layerId, [1, 0, 0, 1, 4, 6], 2)
    h.bridge.requestFrame()
    if (!pending) {
      second.resolve(pyramid)
      await vi.waitFor(() => expect(h.messages.filter((entry) => entry.type === 'sync-scene')).toHaveLength(2))
    }
    h.lost()
    h.ready(2, true)
    if (pending) second.resolve(pyramid) // 被取消的旧 reader 故意在恢复后才结束。
    await vi.waitFor(() => expect(h.renders().length).toBeGreaterThan(pending ? 1 : 2))
    const relevant = h.messages.filter((entry) => 'sceneGeneration' in entry && entry.sceneGeneration === 2)
    const types = relevant.map((entry) => entry.type)
    expect(types.slice(0, 4)).toEqual(['sync-scene', 'update-viewport', 'update-transform', 'render'])
    expect(relevant[1]).toMatchObject({ cameraSequence: 2, layout: movedLayout })
    expect(relevant[2]).toMatchObject({ interactionSequence: 2, transform: [1, 0, 0, 1, 4, 6] })
    expect(relevant[relevant.length - 1]).toMatchObject({ type: 'render', cameraSequence: 2, interactionSequence: 2 })
    expect(relevant.filter((entry) => entry.type === 'sync-scene')).toHaveLength(1)
    const count = h.messages.length
    h.client.updateViewport(2, 1, layout)
    h.bridge.clearTransientLayerTransform(layerId, 1)
    expect(h.messages).toHaveLength(count)
  })

  it.each(['lost', 'dispose', 'new-scene'] as const)('元数据 reader 忽略 abort 时 %s 后迟到结果不能发布旧资源', async (action) => {
    const first = deferred()
    const reader = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(pyramid)
    const h = harness(reader)
    h.sync(); h.ready()
    if (action === 'lost') { h.lost(); h.ready(2, true) }
    if (action === 'dispose') h.bridge.dispose()
    if (action === 'new-scene') h.sync(2)
    first.resolve({ ...pyramid, levels: [{ ...pyramid.levels[0], width: 1 }] })
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(action === 'dispose' ? 1 : 2))
    await vi.waitFor(() => expect(h.messages.filter((entry) => entry.type === 'sync-scene'))
      .toHaveLength(action === 'dispose' ? 0 : 1))
    const syncs = h.messages.filter((entry) => entry.type === 'sync-scene')
    expect(syncs).toHaveLength(action === 'dispose' ? 0 : 1)
    if (action !== 'dispose') expect(syncs[0]).toMatchObject({ sourcePyramids: { [REF]: pyramid } })
  })

  it('真正初始化失败不因资源成功而假恢复，新的设备 ready 才重新绘制', async () => {
    const h = harness(async () => pyramid)
    h.sync()
    h.emit({ type: 'failed', sceneGeneration: 0, deviceGeneration: 0, requestId: null,
      code: 'initialization-failed', recoverable: true, message: 'GPU init failed' })
    await Promise.resolve()
    expect(h.renders()).toHaveLength(0)
    h.ready(1, true)
    await vi.waitFor(() => expect(h.renders()).toHaveLength(1))
  })

  it('已就绪设备的暂态瓦片失败自动重试，成功上传后恢复派帧', async () => {
    vi.useFakeTimers()
    readTiles.mockRejectedValueOnce(new Error('temporary file busy')).mockResolvedValue({ tiles: [tile] })
    const h = harness(async () => pyramid)
    h.sync(); h.ready()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.renders()).toHaveLength(1)
    h.emit(tilesNeeded())
    await vi.advanceTimersByTimeAsync(300)
    expect(readTiles).toHaveBeenCalledTimes(2)
    expect(h.messages.filter((message) => message.type === 'upload-tiles')).toHaveLength(1)
    expect(h.renders()).toHaveLength(2)
    expect(h.messages.filter((message) => message.type === 'initialize')).toHaveLength(1)
  })

  it.each(['temporary file busy', 'invalid image format'])('瓦片重试同样有界且不重试永久错误（%s）', async (message) => {
    vi.useFakeTimers()
    readTiles.mockRejectedValue(new Error(message))
    const h = harness(async () => pyramid)
    h.sync(); h.ready()
    await vi.advanceTimersByTimeAsync(1)
    h.emit(tilesNeeded())
    await vi.advanceTimersByTimeAsync(10_000)
    expect(readTiles).toHaveBeenCalledTimes(message.startsWith('temporary') ? 2 : 1)
    expect(h.messages.filter((entry) => entry.type === 'upload-tiles')).toHaveLength(0)
  })

  it('旧 reader 忽略 abort 时不堵住新设备，旧 finally 不得删除新加载的去重标记', async () => {
    let resolveOld!: (result: { tiles: ImageEditorV3SourceTile[] }) => void
    let resolveNew!: (result: { tiles: ImageEditorV3SourceTile[] }) => void
    readTiles.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve }))
    const h = harness(async () => pyramid)
    h.sync(); h.ready()
    await vi.waitFor(() => expect(h.renders()).toHaveLength(1))
    h.emit(tilesNeeded())
    await vi.waitFor(() => expect(readTiles).toHaveBeenCalledTimes(1))
    h.lost()
    const closeOldFrame = vi.fn()
    h.emit({ type: 'frame-ready', sceneGeneration: 1, deviceGeneration: 1, cameraSequence: 1,
      interactionSequence: 0, surfaceGeneration: 0, quality: 'draft', requestId: 'old-device-frame',
      bitmap: { close: closeOldFrame } as unknown as ImageBitmap })
    expect(closeOldFrame).toHaveBeenCalledOnce()
    h.ready(2, true)
    h.emit({ type: 'frame-ready', sceneGeneration: 1, deviceGeneration: 1, cameraSequence: 1,
      interactionSequence: 0, surfaceGeneration: 0, quality: 'draft', requestId: 'old-device-frame',
      bitmap: { close: closeOldFrame } as unknown as ImageBitmap })
    expect(closeOldFrame).toHaveBeenCalledTimes(2)
    h.emit(tilesNeeded(2))
    await vi.waitFor(() => expect(readTiles).toHaveBeenCalledTimes(2))
    resolveOld({ tiles: [tile] })
    await Promise.resolve(); await Promise.resolve()
    h.emit(tilesNeeded(2))
    await Promise.resolve()
    expect(readTiles).toHaveBeenCalledTimes(2)
    expect(h.messages.filter((entry) => entry.type === 'upload-tiles')).toHaveLength(0)
    resolveNew({ tiles: [tile] })
    await vi.waitFor(() => expect(h.messages.filter((entry) => entry.type === 'upload-tiles')).toHaveLength(1))
  })
})
