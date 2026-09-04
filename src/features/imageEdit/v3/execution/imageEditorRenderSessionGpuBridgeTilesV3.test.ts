import { describe, expect, it, vi } from 'vitest'

import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { ImageEditorRenderSessionGpuBridgeV3 } from './imageEditorRenderSessionGpuBridgeV3'

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

describe('ImageEditorRenderSessionGpuBridgeV3 瓦片资源', () => {
  it('sparse mask通过正式Float32 brush读取链量化为r8上传内容', async () => {
    const harness = clientHarness()
    const readBrushTiles = vi.fn(async () => ({ tiles: [{
      tileKey: '0/0/0',
      tile: { storage: 'mask-float32' as const, width: 2, height: 1,
        data: new Float32Array([0.25, 1]) },
    }] }))
    const resourceRef = `sha256:${'a'.repeat(64)}` as const
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-sparse-mask', harness.client, vi.fn(), false, undefined, undefined, readBrushTiles,
    )
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 2, height: 1 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 8,
        mediaType: 'application/x-henji-brush-tile-v3' }],
    })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, resourceKind: 'sparse-mask', resourceByteLength: 8,
        mip: 0, tileX: 0, tileY: 0, contentVersion: 'mask-v1', format: 'r8unorm' }],
    })
    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledOnce())
    const upload = vi.mocked(harness.client.uploadTiles).mock.calls[0][1][0]
    expect([...new Uint8Array(upload.tile.pixels)]).toEqual([64, 64, 64, 255, 255, 255, 255, 255])
    expect(upload.key.format).toBe('r8unorm')
    expect(readBrushTiles).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('sparse brush只上传请求的变化瓦片并保持线性straight上传边界', async () => {
    const harness = clientHarness()
    const readBrushTiles = vi.fn(async () => ({ tiles: [{
      tileKey: '0/2/3',
      tile: createFloat32PremultipliedRgbaTile(
        1, 1, 'linear-light', new Float32Array([0.25, 0.125, 0, 0.5]),
      ),
    }] }))
    const resourceRef = `sha256:${'d'.repeat(64)}` as const
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-sparse-brush', harness.client, vi.fn(), false, undefined, undefined, readBrushTiles,
    )
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 2048, height: 2048 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 16,
        mediaType: 'application/x-henji-brush-tile-v3' }],
    })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, resourceKind: 'brush-tile', resourceByteLength: 16,
        mip: 0, tileX: 2, tileY: 3,
        contentVersion: 'brush-v2', format: 'rgba16float' }],
    })
    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledOnce())
    const upload = vi.mocked(harness.client.uploadTiles).mock.calls[0][1][0]
    expect([...new Float32Array(upload.tile.pixels)]).toEqual([0.5, 0.25, 0, 0.5])
    expect(upload.tile).toMatchObject({ bitDepth: 32, sampleFormat: 'float',
      numericRange: 'scene-linear', transferFunction: 'linear', alphaMode: 'straight' })
    expect(readBrushTiles).toHaveBeenCalledWith(expect.objectContaining({
      tiles: [expect.objectContaining({ tileKey: '0/2/3' })],
    }), expect.any(AbortSignal))
    bridge.dispose()
  })

  it('画笔持久化占用读取准入时有界重试且不触发CPU fallback', async () => {
    const harness = clientHarness()
    const fallback = vi.fn()
    const resourceRef = `sha256:${'b'.repeat(64)}` as const
    const tile = createFloat32PremultipliedRgbaTile(
      1, 1, 'linear-light', new Float32Array([0.2, 0.1, 0, 0.5]),
    )
    const readBrushTiles = vi.fn()
      .mockRejectedValueOnce(new Error('Image editor brush_tiles.read concurrency limit reached'))
      .mockResolvedValue({ tiles: [{ tileKey: '0/0/0', tile }] })
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-brush-contention', harness.client, vi.fn(), false, undefined, fallback, readBrushTiles,
    )
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 1, height: 1 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{ resourceRef, byteLength: 16,
        mediaType: 'application/x-henji-brush-tile-v3' }],
    })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, resourceKind: 'brush-tile', resourceByteLength: 16,
        mip: 0, tileX: 0, tileY: 0,
        contentVersion: 'brush-contention', format: 'rgba16float' }],
    })
    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledOnce())
    expect(readBrushTiles).toHaveBeenCalledTimes(2)
    expect(fallback).not.toHaveBeenCalled()
    bridge.dispose()
  })
})
