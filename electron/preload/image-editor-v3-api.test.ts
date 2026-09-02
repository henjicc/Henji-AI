import { describe, expect, it, vi } from 'vitest'

import { createImageEditorV3Api } from './image-editor-v3-api'

const RESOURCE_REF = `sha256:${'a'.repeat(64)}` as const

describe('图片编辑 V3 preload 契约', () => {
  it('批量瓦片优先使用带 credit 的 MessagePort 流并接收 transferable', async () => {
    class TestPort {
      onmessage: ((event: { data: unknown }) => void) | null = null
      onmessageerror: (() => void) | null = null
      peer: TestPort | null = null
      postMessage(message: unknown, _transfer?: unknown[]): void {
        const peer = this.peer
        queueMicrotask(() => peer?.onmessage?.({ data: message }))
      }
      start(): void {}
      close(): void { this.peer = null }
    }
    class TestMessageChannel {
      port1 = new TestPort()
      port2 = new TestPort()
      constructor() {
        this.port1.peer = this.port2
        this.port2.peer = this.port1
      }
    }
    vi.stubGlobal('MessageChannel', TestMessageChannel)
    const invoke = vi.fn()
    const pixels = new Uint8Array([1, 2, 3, 4]).buffer
    const postMessage = vi.fn((_channel: string, _request: unknown, ports: unknown[] = []) => {
      const port = ports[0] as TestPort | undefined
      if (!port) throw new Error('缺少瓦片流端口')
      let sent = false
      port.onmessage = (event) => {
        if (sent || (event.data as { type?: string } | null)?.type !== 'credit') return
        sent = true
        port.postMessage({
          type: 'tile',
          index: 0,
          tile: { resourceRef: RESOURCE_REF, mip: 0, tileX: 0, tileY: 0, pixels },
        }, [pixels])
        port.postMessage({ type: 'complete', tileCount: 1 })
        port.close()
      }
      port.start()
    })
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
      postMessage,
    )
    const onTile = vi.fn()
    const result = await api.readSourceTiles!({
      requestId: 'stream',
      tiles: [{ resourceRef: RESOURCE_REF, mip: 0, tileX: 0, tileY: 0, priority: 0 }],
      onTile,
    })

    expect(result.tiles).toHaveLength(1)
    expect(result.tiles[0]?.pixels.byteLength).toBe(4)
    expect(onTile).toHaveBeenCalledWith({ index: 0, tile: result.tiles[0] })
    expect(postMessage).toHaveBeenCalledWith(
      'imageEditorV3:source:tilesStream',
      expect.objectContaining({ requestId: 'stream' }),
      expect.arrayContaining([expect.any(TestPort)]),
    )
    expect(postMessage.mock.calls[0]?.[1]).not.toHaveProperty('onTile')
    expect(invoke).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

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
    const { requestId: _requestId, ...tileItem } = tileRequest

    await api.readSourceTile(tileRequest)
    await api.readSourceTiles!({
      requestId: 'tile-batch',
      tiles: [{ ...tileItem, priority: 0 }],
    })
    await api.cancelRequest('tile-16')

    expect(invoke).toHaveBeenNthCalledWith(1, 'imageEditorV3:source:tile', tileRequest)
    expect(invoke).toHaveBeenNthCalledWith(2, 'imageEditorV3:source:tiles', {
      requestId: 'tile-batch',
      tiles: [{ ...tileItem, priority: 0 }],
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'imageEditorV3:request:cancel', { requestId: 'tile-16' })
  })

  it('粗 mip 金字塔预热使用独立可取消 IPC，不暴露路径', async () => {
    const invoke = vi.fn(async () => ({ plannedTiles: 8, completedTiles: 8, truncated: false }))
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
    )
    const request = {
      requestId: 'pyramid-prewarm',
      resourceRef: RESOURCE_REF,
      minimumMip: 4,
      maximumMip: 8,
      tileBudget: 32,
      bitDepth: 16 as const,
    }

    await api.prewarmSourcePyramid(request)

    expect(invoke).toHaveBeenCalledWith('imageEditorV3:source:pyramidPrewarm', request)
    expect(request).not.toHaveProperty('filePath')
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

  it('受管栅格物化使用独立开始和完成通道且不接收目标路径', async () => {
    const invoke = vi.fn(async () => undefined)
    const api = createImageEditorV3Api(
      invoke as unknown as Parameters<typeof createImageEditorV3Api>[0],
    )
    const request = {
      requestId: 'raster-materialize',
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

    await api.startManagedRasterExport(request)
    await api.completeManagedRasterExport({ sessionId: 'managed-session' })

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'imageEditorV3:rasterExport:startManaged',
      request,
    )
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'imageEditorV3:rasterExport:completeManaged',
      { sessionId: 'managed-session' },
    )
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
