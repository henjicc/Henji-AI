import { describe, expect, it, vi, type Mock } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneExportRequestV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuExportSessionV3 } from './gpuExportSessionV3'

function client(): ImageEditorGpuSceneClientV3Like & {
  requestExport: Mock<[ImageEditorGpuSceneExportRequestV3], void>
  acknowledgeExportTile: Mock<[string, number, number], void>
} {
  return {
    syncScene: vi.fn(), uploadTiles: vi.fn(), updateTransientLayerTransform: vi.fn(),
    clearTransientLayerTransform: vi.fn(), updateViewport: vi.fn(), requestFrame: vi.fn(),
    subscribe: vi.fn(() => () => undefined), dispose: vi.fn(),
    requestExport: vi.fn(), cancelExport: vi.fn(), acknowledgeExportTile: vi.fn(),
  }
}

function request(document: ReturnType<typeof createImageEditDocumentV3>) {
  return {
    document,
    resourceDescriptors: [],
    description: {
      width: document.geometry.width,
      height: document.geometry.height,
      bitDepth: 8 as const,
      sampleFormat: 'uint' as const,
      colorSpace: 'srgb' as const,
      transferFunction: 'srgb' as const,
      alphaMode: 'straight' as const,
    },
    tileSize: 16,
  }
}

describe('ImageEditorGpuExportSessionV3', () => {
  it.each(['初始化失败', '设备丢失'])('%s之后的新导出立即拒绝等待，恢复ready后允许正常GPU导出', async (reason) => {
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable',
      resourceDescriptors: [] })
    if (reason === '设备丢失') session.notifyDeviceReady()
    session.notifyDeviceUnavailable(new Error(reason))
    const failed = session.render(request(document))!
    await expect(failed[Symbol.asyncIterator]().next()).rejects.toThrow(reason)
    expect(gpu.requestExport).not.toHaveBeenCalled()

    session.notifyDeviceReady()
    const recovered = session.render(request(document))!
    expect(gpu.requestExport).toHaveBeenCalledOnce()
    const exportRequest = gpu.requestExport.mock.calls[0]![0]
    session.handleEvent({ type: 'export-tile', sceneGeneration: 1, deviceGeneration: 2,
      requestId: exportRequest.requestId, tileX: 0, tileY: 0, x: 0, y: 0,
      width: 16, height: 16, rowStride: 64, pixels: new ArrayBuffer(1024), completed: true })
    const iterator = recovered[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    session.dispose()
  })

  it('初始化中的导出等待被失败唤醒，后续导出也立即失败而不是再等待', async () => {
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable',
      resourceDescriptors: [] })
    const next = session.render(request(document))![Symbol.asyncIterator]().next()
    expect(gpu.requestExport).not.toHaveBeenCalled()
    session.notifyDeviceUnavailable(new Error('adapter unavailable'))
    await expect(next).rejects.toThrow('adapter unavailable')
    await expect(session.render(request(document))![Symbol.asyncIterator]().next()).rejects.toThrow('adapter unavailable')
    expect(gpu.requestExport).not.toHaveBeenCalled()
    session.dispose()
  })

  it('把活动scene绑定到文档revision，并在消费后才确认tile', async () => {
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    document.revision = 3
    session.syncSnapshot({
      document, renderGeneration: 5, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [],
    })
    const stream = session.render(request(document))
    expect(stream).not.toBeNull()
    expect(gpu.requestExport).not.toHaveBeenCalled()
    session.notifyDeviceReady()
    const exportRequest = gpu.requestExport.mock.calls[0]?.[0]
    expect(exportRequest).toMatchObject({ sceneGeneration: 5, quality: 'export' })
    const iterator = stream![Symbol.asyncIterator]()
    session.handleEvent({
      type: 'export-tile', sceneGeneration: 5, deviceGeneration: 1,
      requestId: exportRequest!.requestId, tileX: 0, tileY: 0,
      x: 0, y: 0, width: 16, height: 16, rowStride: 64,
      pixels: new ArrayBuffer(1024), completed: true,
    })
    const first = await iterator.next()
    expect(first.value).toMatchObject({ width: 16, height: 16, rowStride: 64 })
    expect(gpu.acknowledgeExportTile).not.toHaveBeenCalled()
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(gpu.acknowledgeExportTile).toHaveBeenCalledWith(exportRequest!.requestId, 0, 0)
    session.dispose()
  })

  it('上游失败会拒绝流且不把旧job tile交给新revision', async () => {
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable',
      resourceDescriptors: [] })
    const iterator = session.render(request(document))![Symbol.asyncIterator]()
    session.notifyDeviceReady()
    const exportRequest = gpu.requestExport.mock.calls[0]![0]
    session.handleEvent({
      type: 'failed', sceneGeneration: 1, deviceGeneration: 1,
      requestId: exportRequest.requestId, code: 'export-not-ready',
      message: 'encoder upstream failed', recoverable: true,
    })
    await expect(iterator.next()).rejects.toThrow('encoder upstream failed')
    expect(gpu.cancelExport).toHaveBeenCalledWith(exportRequest.requestId)
    session.dispose()
  })

  it('编码sink消费tile后失败会取消同一job，阻止后续tile写入', async () => {
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable',
      resourceDescriptors: [] })
    const stream = session.render(request(document))!
    session.notifyDeviceReady()
    const exportRequest = gpu.requestExport.mock.calls[0]![0]
    const consume = async () => {
      for await (const _tile of stream) throw new Error('encoder write failed')
    }
    const consuming = consume()
    session.handleEvent({ type: 'export-tile', sceneGeneration: 1, deviceGeneration: 1,
      requestId: exportRequest.requestId, tileX: 0, tileY: 0, x: 0, y: 0,
      width: 16, height: 16, rowStride: 64, pixels: new ArrayBuffer(1024), completed: true })
    await expect(consuming).rejects.toThrow('encoder write failed')
    expect(gpu.cancelExport).toHaveBeenCalledWith(exportRequest.requestId)
    expect(gpu.acknowledgeExportTile).not.toHaveBeenCalled()
    session.dispose()
  })

  it('AbortSignal会拒绝等待中的导出并取消worker job', async () => {
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable',
      resourceDescriptors: [] })
    const controller = new AbortController()
    const stream = session.render({ ...request(document), signal: controller.signal })!
    session.notifyDeviceReady()
    const exportRequest = gpu.requestExport.mock.calls[0]![0]
    const next = stream[Symbol.asyncIterator]().next()
    controller.abort(new Error('user cancelled'))
    await expect(next).rejects.toThrow('user cancelled')
    expect(gpu.cancelExport).toHaveBeenCalledWith(exportRequest.requestId)
    session.dispose()
  })

  it('同revision但导出视图几何或RenderGraph不同则不误用活动scene', () => {
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable',
      resourceDescriptors: [] })
    const view = structuredClone(document)
    view.geometry.crop = { x: 0, y: 0, width: 8, height: 8 }
    expect(session.render({ ...request(view), description: { ...request(view).description,
      width: 8, height: 8 } })).toBeNull()
    expect(gpu.requestExport).not.toHaveBeenCalled()
    session.dispose()
  })

  it('Reality故障注入只让下一次导出在首tile被消费后失败', async () => {
    const diagnosticWindow = new EventTarget()
    vi.stubGlobal('window', diagnosticWindow)
    const gpu = client()
    const session = new ImageEditorGpuExportSessionV3(gpu, true)
    const document = createImageEditDocumentV3({ width: 32, height: 16 })
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable',
      resourceDescriptors: [] })
    const diagnosticEvent = new Event('henji:image-editor-gpu-scene-diagnostic')
    Object.defineProperty(diagnosticEvent, 'detail', {
      value: { failNextExportAfterTiles: 1 },
    })
    diagnosticWindow.dispatchEvent(diagnosticEvent)
    const iterator = session.render(request(document))![Symbol.asyncIterator]()
    session.notifyDeviceReady()
    const exportRequest = gpu.requestExport.mock.calls[0]![0]
    session.handleEvent({ type: 'export-tile', sceneGeneration: 1, deviceGeneration: 1,
      requestId: exportRequest.requestId, tileX: 0, tileY: 0, x: 0, y: 0,
      width: 16, height: 16, rowStride: 64, pixels: new ArrayBuffer(1024), completed: false })
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    await expect(iterator.next()).rejects.toThrow('Reality 注入')
    expect(gpu.acknowledgeExportTile).toHaveBeenCalledOnce()
    expect(gpu.cancelExport).toHaveBeenCalledWith(exportRequest.requestId)

    const second = session.render(request(document))
    expect(second).not.toBeNull()
    session.dispose()
    vi.unstubAllGlobals()
  })
})
