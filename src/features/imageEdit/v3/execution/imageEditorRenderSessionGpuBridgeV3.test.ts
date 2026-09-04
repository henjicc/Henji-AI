import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3SourceTileBatchItem } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { ImageEditorRenderSessionGpuBridgeV3 } from './imageEditorRenderSessionGpuBridgeV3'

const { readSourceTile, readSourceTiles } = vi.hoisted(() => ({
  readSourceTile: vi.fn(),
  readSourceTiles: vi.fn(),
}))
vi.mock('@/commands/imageEditorV3', () => ({
  createImageEditorV3RequestId: () => 'gpu-scene-tile:test',
  readImageEditorV3BrushTiles: vi.fn(),
  readImageEditorV3SourceTile: readSourceTile,
}))
vi.mock('@/commands/imageEditorV3Tiles', () => ({ readImageEditorV3SourceTiles: readSourceTiles }))

function clientHarness(): {
  client: ImageEditorGpuSceneClientV3Like
  listener(event: ImageEditorGpuSceneWorkerEventV3): void
} {
  let subscribed: ((event: ImageEditorGpuSceneWorkerEventV3) => void) | null = null
  const client = {
    syncScene: vi.fn(), uploadTiles: vi.fn(), updateTransientLayerTransform: vi.fn(),
    clearTransientLayerTransform: vi.fn(), updateViewport: vi.fn(), requestFrame: vi.fn(),
    subscribe: vi.fn((listener) => { subscribed = listener; return vi.fn() }), dispose: vi.fn(),
  } satisfies ImageEditorGpuSceneClientV3Like
  return {
    client,
    listener: (event) => {
      if (!subscribed) throw new Error('缺少 GPU Scene 事件订阅')
      subscribed(event)
    },
  }
}

const layout = {
  stageWidth: 320,
  stageHeight: 240,
  viewportKey: 'gpu-bridge-viewport',
  viewport: {
    documentX: 0, documentY: 0, width: 320, height: 240, zoom: 1, devicePixelRatio: 1,
  },
}

function frame(interactionSequence: number, close = vi.fn()): ImageEditorGpuSceneWorkerEventV3 {
  return {
    type: 'frame-ready', requestId: `frame-${interactionSequence}`, sceneGeneration: 1,
    cameraSequence: 1, interactionSequence, surfaceGeneration: 0,
    deviceGeneration: 1, quality: 'draft',
    bitmap: { width: 320, height: 240, close } as unknown as ImageBitmap,
    diagnostics: {
      uploadCount: 1, pipelineCompileCount: 2, frameCount: interactionSequence + 1,
      diagnosticReadbackCount: 0, transientUniformUpdateCount: interactionSequence,
      residentTileCount: 1, atlasPageCount: 1, allocatedAtlasBytes: 1_056_784,
      minimumPlannedMip: 0, maximumPlannedMip: 0,
      surfaceFrameCount: 0, imageBitmapFrameCount: interactionSequence + 1,
      directSurfaceFailureCount: 0,
    },
  }
}

function surfaceFrame(interactionSequence: number): ImageEditorGpuSceneWorkerEventV3 {
  return {
    type: 'surface-frame-ready', requestId: `surface-${interactionSequence}`,
    sceneGeneration: 1, cameraSequence: 1, interactionSequence,
    surfaceGeneration: 1, deviceGeneration: 1, quality: 'draft',
    width: 320, height: 240,
    diagnostics: {
      uploadCount: 1, pipelineCompileCount: 2, frameCount: interactionSequence + 1,
      diagnosticReadbackCount: 0, transientUniformUpdateCount: interactionSequence,
      residentTileCount: 1, atlasPageCount: 1, allocatedAtlasBytes: 1_056_784,
      minimumPlannedMip: 0, maximumPlannedMip: 0,
      surfaceFrameCount: interactionSequence + 1, imageBitmapFrameCount: 0,
      directSurfaceFailureCount: 0,
    },
  }
}

describe('ImageEditorRenderSessionGpuBridgeV3', () => {
  beforeEach(() => {
    readSourceTile.mockReset()
    readSourceTiles.mockReset()
  })

  it('legacy r8 mask冻结为source-raster后仍走图片source reader', async () => {
    const harness = clientHarness()
    const resourceRef = `sha256:${'9'.repeat(64)}` as const
    const brushReader = vi.fn()
    readSourceTile.mockResolvedValue({
      resourceRef, mip: 0, tileX: 0, tileY: 0, halo: 0,
      width: 1, height: 1, channels: 4, bitDepth: 8,
      sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian',
      rowStride: 4, colorSpace: 'srgb', transferFunction: 'srgb',
      alphaMode: 'straight', orientationApplied: true,
      originX: 0, originY: 0, pixels: new Uint8Array([128, 128, 128, 255]).buffer,
    })
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-legacy-mask', harness.client, vi.fn(), false, undefined, undefined, brushReader,
    )
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 1, height: 1 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, resourceKind: 'source-raster', mip: 0, tileX: 0, tileY: 0,
        contentVersion: 'legacy-mask', format: 'r8unorm' }],
    })
    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledOnce())
    expect(readSourceTile).toHaveBeenCalledOnce()
    expect(brushReader).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('瓦片请求固定1px halo并按文档位深读取；重复请求 singleflight 去重', async () => {
    const harness = clientHarness()
    const resourceRef = `sha256:${'e'.repeat(64)}` as const
    const deferred: { resolve?: (value: unknown) => void } = {}
    readSourceTiles.mockImplementationOnce(() => new Promise((resolve) => { deferred.resolve = resolve }))
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-tile-load', harness.client, vi.fn(), false, vi.fn(() => true), vi.fn(),
    )
    const document = createImageEditDocumentV3({ width: 320, height: 240 })
    document.color.bitDepth = 'float16'
    bridge.syncSnapshot({
      document,
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    })
    const event = {
      type: 'tiles-needed' as const, sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, mip: 2, tileX: 3, tileY: 4, contentVersion: 'v1' }],
    }
    harness.listener(event)
    harness.listener(event)
    await vi.waitFor(() => expect(readSourceTiles).toHaveBeenCalledOnce())
    expect(readSourceTiles).toHaveBeenCalledWith(expect.objectContaining({
      tiles: [expect.objectContaining({
        resourceRef, mip: 2, tileX: 3, tileY: 4, halo: 1, bitDepth: 32, priority: 0,
      })],
    }), expect.any(AbortSignal))
    const tile = {
      resourceRef, mip: 2, tileX: 3, tileY: 4, halo: 1,
      width: 1, height: 1, channels: 4 as const, bitDepth: 32 as const,
      sampleFormat: 'float' as const, numericRange: 'scene-linear' as const,
      byteOrder: 'little-endian' as const, rowStride: 16, colorSpace: 'scrgb' as const,
      transferFunction: 'linear' as const, alphaMode: 'straight' as const,
      orientationApplied: true as const, originX: 0, originY: 0,
      pixels: new Float32Array([1, 0, 0, 1]).buffer,
    }
    deferred.resolve?.({ tiles: [tile] })
    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledOnce())
    bridge.dispose()
  })

  it('源瓦片读取失败时回退CPU并保留最后稳定帧', async () => {
    const harness = clientHarness()
    const publish = vi.fn()
    const fallback = vi.fn()
    const resourceRef = `sha256:${'f'.repeat(64)}` as const
    readSourceTiles.mockRejectedValueOnce(new Error('decode failed'))
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-tile-failure', harness.client, publish, false, vi.fn(() => true), fallback,
    )
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 16, height: 16 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, mip: 0, tileX: 0, tileY: 0, contentVersion: 'v1' }],
    })

    await vi.waitFor(() => expect(fallback).toHaveBeenCalledOnce())
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      compositionBackend: 'cpu', presentationBackend: 'canvas2d', deviceStatus: 'fallback',
    }))
    bridge.dispose()
  })

  it('同步生成瓦片先上传、等待事件后到时仍继续请求当前帧', async () => {
    const harness = clientHarness()
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    const resourceRef = `sha256:${'1'.repeat(64)}` as const
    const readBrushTiles = vi.fn(async () => ({ tiles: [{
      tileKey: '0/0/0',
      tile: { storage: 'mask-float32' as const, width: 16, height: 16,
        data: new Float32Array(16 * 16).fill(1) },
    }] }))
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-generated-race', harness.client, vi.fn(), false, vi.fn(() => true), vi.fn(),
      readBrushTiles,
    )
    bridge.updateViewport(1, layout)
    bridge.syncSnapshot({
      document, renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 16 * 16 * 4,
        mediaType: 'application/x-henji-brush-tile-v3' }],
    })
    harness.listener({
      type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false,
    })
    expect(harness.client.requestFrame).toHaveBeenCalledOnce()
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, resourceKind: 'sparse-mask', resourceByteLength: 16 * 16 * 4,
        mip: 0, tileX: 0, tileY: 0, contentVersion: 'generated-v1', format: 'r8unorm' }],
    })
    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledOnce())
    harness.listener({
      type: 'failed', sceneGeneration: 1, deviceGeneration: 1, requestId: 'waiting-generated',
      code: 'composition-not-ready', message: 'GPU Scene 等待源纹理', recoverable: true,
    })
    expect(harness.client.requestFrame).toHaveBeenCalledTimes(2)
    bridge.dispose()
  })

  it('新generation取消旧批次并丢弃晚到瓦片，不上传过期资源', async () => {
    const harness = clientHarness()
    const resourceRef = `sha256:${'a'.repeat(64)}` as const
    const deferred: { resolve?: (value: unknown) => void } = {}
    let oldSignal: AbortSignal | undefined
    readSourceTiles.mockImplementationOnce((_request, signal: AbortSignal) => {
      oldSignal = signal
      return new Promise((resolve) => { deferred.resolve = resolve })
    })
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-stale-tiles', harness.client, vi.fn(), false, vi.fn(() => true), vi.fn(),
    )
    const snapshot = {
      document: createImageEditDocumentV3({ width: 16, height: 16 }),
      geometryHash: 'geometry', quality: 'stable' as const,
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    }
    bridge.syncSnapshot({ ...snapshot, renderGeneration: 1 })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, mip: 0, tileX: 0, tileY: 0, contentVersion: 'v1' }],
    })
    await vi.waitFor(() => expect(readSourceTiles).toHaveBeenCalledOnce())

    bridge.syncSnapshot({ ...snapshot, renderGeneration: 2 })
    expect(oldSignal?.aborted).toBe(true)
    deferred.resolve?.({
      tiles: [{
        resourceRef, mip: 0, tileX: 0, tileY: 0, halo: 1,
        width: 1, height: 1, channels: 4, bitDepth: 8,
        sampleFormat: 'unsigned-integer', numericRange: 'full',
        byteOrder: 'little-endian', rowStride: 4, colorSpace: 'srgb',
        transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true,
        originX: 0, originY: 0, pixels: new Uint8Array([255, 0, 0, 255]).buffer,
      }],
    })
    await vi.waitFor(() => expect(oldSignal?.aborted).toBe(true))
    await Promise.resolve()
    expect(harness.client.uploadTiles).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('超过宿主上限的瓦片请求按16片串行分批上传', async () => {
    const harness = clientHarness()
    const resourceRef = `sha256:${'b'.repeat(64)}` as const
    readSourceTiles.mockImplementation(async (request: { tiles: ImageEditorV3SourceTileBatchItem[] }) => ({
      tiles: request.tiles.map((item) => ({
        resourceRef, mip: item.mip, tileX: item.tileX, tileY: item.tileY, halo: 1,
        width: 1, height: 1, channels: 4, bitDepth: 8,
        sampleFormat: 'unsigned-integer', numericRange: 'full',
        byteOrder: 'little-endian', rowStride: 4, colorSpace: 'srgb',
        transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true,
        originX: item.tileX, originY: 0, pixels: new Uint8Array([255, 0, 0, 255]).buffer,
      })),
    }))
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-batched-tiles', harness.client, vi.fn(), false, vi.fn(() => true), vi.fn(),
    )
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 8192, height: 8192 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: Array.from({ length: 17 }, (_, tileX) => ({
        resourceRef, mip: 0, tileX, tileY: 0, contentVersion: 'v1',
      })),
    })

    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledTimes(2))
    expect(readSourceTiles.mock.calls.map(([request]) => request.tiles.length)).toEqual([16, 1])
    expect(vi.mocked(harness.client.uploadTiles).mock.calls.map((call) => (
      call[1].length
    ))).toEqual([16, 1])
    bridge.dispose()
  })

  it('销毁会话时只退订并销毁唯一GPU Scene客户端', () => {
    const unsubscribe = vi.fn()
    const client = {
      syncScene: vi.fn(), uploadTiles: vi.fn(), updateTransientLayerTransform: vi.fn(),
      clearTransientLayerTransform: vi.fn(), updateViewport: vi.fn(), requestFrame: vi.fn(),
      subscribe: vi.fn(() => unsubscribe), dispose: vi.fn(),
    } satisfies ImageEditorGpuSceneClientV3Like
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-bridge-test',
      client,
      vi.fn(),
    )

    bridge.dispose()
    bridge.dispose()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(client.dispose).toHaveBeenCalledOnce()
  })

  it('将高频瞬态矩阵串行合并到实际呈现帧，不重复发送 uniform', () => {
    const harness = clientHarness()
    const present = vi.fn(() => true)
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-interaction', harness.client, vi.fn(), false, present, vi.fn(),
    )
    bridge.updateViewport(1, layout)
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 320, height: 240 }),
      renderGeneration: 1,
      geometryHash: 'geometry',
      quality: 'stable',
      resourceDescriptors: [],
    })
    harness.listener({
      type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false,
    })
    expect(harness.client.requestFrame).toHaveBeenCalledTimes(1)

    bridge.updateTransientLayerTransform('source', [1, 0, 0, 1, 2, 3], 1, 10)
    bridge.requestFrame('draft')
    bridge.updateTransientLayerTransform('source', [1, 0, 0, 1, 8, 9], 2, 20)
    bridge.requestFrame('draft')
    expect(harness.client.updateTransientLayerTransform).not.toHaveBeenCalled()

    harness.listener(frame(0))
    expect(present).toHaveBeenCalledTimes(1)
    expect(harness.client.updateTransientLayerTransform).toHaveBeenCalledOnce()
    expect(harness.client.updateTransientLayerTransform).toHaveBeenLastCalledWith(
      1, 'source', [1, 0, 0, 1, 8, 9], 2,
    )
    expect(harness.client.requestFrame).toHaveBeenCalledTimes(2)
    harness.listener(frame(2))
    expect(present).toHaveBeenCalledTimes(2)
    bridge.dispose()
  })

  it('direct-ready不携带ImageBitmap，并原子发布webgpu-surface后端', () => {
    const harness = clientHarness()
    const publish = vi.fn()
    const present = vi.fn(() => true)
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-direct', harness.client, publish, false, present, vi.fn(),
    )
    bridge.updateViewport(1, layout)
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 320, height: 240 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable', resourceDescriptors: [],
    })
    harness.listener({
      type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false,
    })
    harness.listener(surfaceFrame(0))

    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'surface-frame-ready', surfaceGeneration: 1,
        diagnostics: expect.objectContaining({
          surfaceFrameCount: 1, imageBitmapFrameCount: 0, diagnosticReadbackCount: 0,
        }),
      }),
      layout,
      null,
    )
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      compositionBackend: 'gpu', presentationBackend: 'webgpu-surface',
      fallbackRequired: false, diagnostic: null,
    }))
    bridge.dispose()
  })

  it('过期帧先关闭位图，合成失败和 device lost 都保留稳定帧并发布CPU回退', () => {
    const harness = clientHarness()
    const publish = vi.fn()
    const present = vi.fn(() => true)
    const fallback = vi.fn()
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-fallback', harness.client, publish, false, present, fallback,
    )
    bridge.updateViewport(1, layout)
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 320, height: 240 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable', resourceDescriptors: [],
    })
    harness.listener({
      type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false,
    })
    bridge.updateTransientLayerTransform('source', [1, 0, 0, 1, 5, 6], 2)
    bridge.requestFrame('draft')
    const close = vi.fn()
    harness.listener(frame(1, close))
    expect(close).toHaveBeenCalledOnce()
    expect(present).not.toHaveBeenCalled()
    const staleSceneClose = vi.fn()
    harness.listener({ ...frame(2, staleSceneClose), sceneGeneration: 0 })
    expect(staleSceneClose).toHaveBeenCalledOnce()

    harness.listener({
      type: 'failed', sceneGeneration: 1, deviceGeneration: 1, requestId: 'waiting-source',
      code: 'composition-not-ready', message: 'GPU Scene 等待源纹理', recoverable: true,
    })
    expect(fallback).not.toHaveBeenCalled()

    harness.listener({
      type: 'failed', sceneGeneration: 1, deviceGeneration: 1, requestId: 'failed',
      code: 'composition-not-ready', message: '合成失败', recoverable: true,
    })
    expect(fallback).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      compositionBackend: 'cpu', presentationBackend: 'canvas2d', deviceStatus: 'fallback',
    }))
    fallback.mockClear()
    publish.mockClear()
    harness.listener({
      type: 'device-lost', sceneGeneration: 1, deviceGeneration: 2,
      reason: 'destroyed', retryAfterMs: 0,
    })
    expect(fallback).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      compositionBackend: 'cpu', presentationBackend: 'canvas2d', deviceStatus: 'lost',
    }))
    bridge.dispose()
  })

})
