import { describe, expect, it, vi } from 'vitest'

import { createImageEditorV3Api } from './image-editor-v3-api'

const RESOURCE_REF = `sha256:${'a'.repeat(64)}` as const

describe('图片编辑 V3 preload 契约', () => {
  it('源导入与包打开不接收渲染层本地路径', async () => {
    const invoke = vi.fn(async () => undefined)
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
    )

    await api.importSource({ requestId: 'source-import' })
    await api.openPackage({ requestId: 'package-open' })

    expect(invoke).toHaveBeenNthCalledWith(1, 'imageEditorV3:source:import', { requestId: 'source-import' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'imageEditorV3:package:open', { requestId: 'package-open' })
  })

  it('瓦片精度、坐标与取消 requestId 原样进入独立 IPC', async () => {
    const invoke = vi.fn(async () => undefined)
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
    )
    const tileRequest = {
      requestId: 'tile-16',
      resourceRef: RESOURCE_REF,
      mip: 2,
      tileX: 4,
      tileY: 5,
      halo: 96,
      bitDepth: 16 as const,
    }

    await api.readSourceTile(tileRequest)
    await api.cancelRequest('tile-16')

    expect(invoke).toHaveBeenNthCalledWith(1, 'imageEditorV3:source:tile', tileRequest)
    expect(invoke).toHaveBeenNthCalledWith(2, 'imageEditorV3:request:cancel', { requestId: 'tile-16' })
  })

  it('已有宿主来源只返回受管资源契约，不把主进程落盘路径带回渲染层', async () => {
    const invoke = vi.fn(async () => ({
      resource: { resourceRef: RESOURCE_REF, byteLength: 4, mediaType: 'image/png' },
      metadata: { resourceRef: RESOURCE_REF, width: 1, height: 1 },
    }))
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
    )
    const request = {
      requestId: 'source-ingest',
      source: { kind: 'http-url' as const, url: 'https://example.test/image.png' },
    }

    const result = await api.ingestSource(request)

    expect(invoke).toHaveBeenCalledWith('imageEditorV3:source:ingest', request)
    expect(result).not.toHaveProperty('filePath')
    expect(result.resource).not.toHaveProperty('filePath')
  })

  it('栅格导出只传快照与瓦片，不暴露目标文件路径', async () => {
    const invoke = vi.fn(async () => ({ status: 'cancelled' as const }))
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
    )
    const request = {
      requestId: 'raster-export',
      documentRef: 'image-edit-v3:document' as const,
      revision: 3,
      sourceFingerprint: `sha256:${'b'.repeat(64)}` as const,
      format: 'png8' as const,
      description: {
        width: 1,
        height: 1,
        bitDepth: 8 as const,
        sampleFormat: 'uint' as const,
        colorSpace: 'srgb' as const,
        transferFunction: 'srgb' as const,
        alphaMode: 'straight' as const,
      },
    }

    await api.startRasterExport(request)

    expect(invoke).toHaveBeenCalledWith('imageEditorV3:rasterExport:start', request)
    expect(request).not.toHaveProperty('targetPath')
  })

  it('画笔瓦片批量持久化与读取使用独立可取消 IPC 通道', async () => {
    const invoke = vi.fn(async () => ({ tiles: [] }))
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
    )
    const persistRequest = {
      requestId: 'brush-persist',
      tiles: [{
        tileKey: '0:0:0',
        tile: {
          storage: 'mask-float32' as const,
          width: 1,
          height: 1,
          data: new Float32Array([1]).buffer,
        },
      }],
    }
    const readRequest = {
      requestId: 'brush-read',
      tiles: [{ tileKey: '0:0:0', resource: { resourceRef: RESOURCE_REF, byteSize: 120 } }],
    }

    await api.persistBrushTiles(persistRequest)
    await api.readBrushTiles(readRequest)
    await api.cancelRequest('brush-read')

    expect(invoke).toHaveBeenNthCalledWith(1, 'imageEditorV3:brushTiles:persist', persistRequest)
    expect(invoke).toHaveBeenNthCalledWith(2, 'imageEditorV3:brushTiles:read', readRequest)
    expect(invoke).toHaveBeenNthCalledWith(3, 'imageEditorV3:request:cancel', { requestId: 'brush-read' })
  })
})
