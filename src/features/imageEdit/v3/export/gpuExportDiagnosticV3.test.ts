import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { ImageEditorRenderSessionGpuBridgeV3 } from '../execution/imageEditorRenderSessionGpuBridgeV3'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@/core/logging', () => ({ createLogger: () => log }))

describe('GPU 导出故障注入诊断标记', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it.each([
    { diagnostic: true, beforeRender: true },
    { diagnostic: true, beforeRender: false },
    { diagnostic: false, beforeRender: true },
  ])('桥接保留结构化标记：%j', async ({ diagnostic, beforeRender }) => {
    let receive!: (event: ImageEditorGpuSceneWorkerEventV3) => void
    const client: ImageEditorGpuSceneClientV3Like = {
      syncScene: vi.fn(), uploadTiles: vi.fn(), updateTransientLayerTransform: vi.fn(),
      clearTransientLayerTransform: vi.fn(), updateViewport: vi.fn(), requestFrame: vi.fn(),
      subscribe: (listener) => { receive = listener; return () => undefined }, dispose: vi.fn(),
      requestExport: vi.fn(), cancelExport: vi.fn(), acknowledgeExportTile: vi.fn(),
    }
    const bridge = new ImageEditorRenderSessionGpuBridgeV3('diagnostic', client, () => undefined)
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    bridge.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable', resourceDescriptors: [] })
    const request = { document, resourceDescriptors: [], tileSize: 16, description: {
      width: 16, height: 16, bitDepth: 8 as const, sampleFormat: 'uint' as const,
      colorSpace: 'srgb' as const, transferFunction: 'srgb' as const, alphaMode: 'straight' as const,
    } }
    const fail = (): void => receive({
      type: 'failed', sceneGeneration: 1, deviceGeneration: 0, requestId: null,
      code: 'initialization-failed', message: 'Reality 注入 GPU 初始化失败', recoverable: true, diagnostic,
    })
    if (beforeRender) fail()
    const stream = bridge.renderExport(request)!
    if (!beforeRender) fail()
    try {
      await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('Reality 注入 GPU 初始化失败')
      const event = expect.objectContaining({ event: 'image_editor_v3.gpu_export.failed' })
      if (diagnostic) {
        expect(log.warn).toHaveBeenCalledWith(expect.any(String), event)
        expect(log.error).not.toHaveBeenCalled()
      } else {
        expect(log.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), event)
      }
    } finally { bridge.dispose() }
  })
})
