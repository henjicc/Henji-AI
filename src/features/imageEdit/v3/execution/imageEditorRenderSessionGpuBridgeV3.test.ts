import { describe, expect, it, vi } from 'vitest'

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
    cameraSequence: 1, interactionSequence, deviceGeneration: 1, quality: 'draft',
    bitmap: { width: 320, height: 240, close } as unknown as ImageBitmap,
    diagnostics: {
      uploadCount: 1, pipelineCompileCount: 2, frameCount: interactionSequence + 1,
      diagnosticReadbackCount: 0, transientUniformUpdateCount: interactionSequence,
    },
  }
}

describe('ImageEditorRenderSessionGpuBridgeV3', () => {
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

  it('sparse mask通过正式Float32 brush读取链量化为r8上传内容', async () => {
    const harness = clientHarness()
    const readBrushTiles = vi.fn(async () => ({ tiles: [{
      tileKey: '0/0/0',
      tile: { storage: 'mask-float32' as const, width: 2, height: 1, data: new Float32Array([0.25, 1]) },
    }] }))
    const resourceRef = `sha256:${'a'.repeat(64)}` as const
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-sparse-mask', harness.client, vi.fn(), false, undefined, undefined, readBrushTiles,
    )
    bridge.syncSnapshot({
      document: createImageEditDocumentV3({ width: 2, height: 1 }),
      renderGeneration: 1, geometryHash: 'geometry', quality: 'stable',
      resourceDescriptors: [{
        resourceRef, byteLength: 8, mediaType: 'application/x-henji-brush-tile-v3',
      }],
    })
    harness.listener({
      type: 'tiles-needed', sceneGeneration: 1, deviceGeneration: 1,
      keys: [{ resourceRef, mip: 0, tileX: 0, tileY: 0, contentVersion: 'mask-v1', format: 'r8unorm' }],
    })
    await vi.waitFor(() => expect(harness.client.uploadTiles).toHaveBeenCalledOnce())
    const upload = vi.mocked(harness.client.uploadTiles).mock.calls[0][1][0]
    expect([...new Uint8Array(upload.tile.pixels)]).toEqual([64, 64, 64, 255, 255, 255, 255, 255])
    expect(upload.key.format).toBe('r8unorm')
    expect(readBrushTiles).toHaveBeenCalledOnce()
    bridge.dispose()
  })
})
