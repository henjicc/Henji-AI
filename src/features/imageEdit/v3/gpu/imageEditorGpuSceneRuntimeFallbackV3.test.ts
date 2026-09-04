import { describe, expect, it, vi } from 'vitest'

import type { ManagedWebGpuDevice } from '@/core/imageEdit/webgpu/deviceManager'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorGpuRasterCompositorV3Like } from './imageEditorGpuRasterCompositorV3'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  type ImageEditorGpuSceneWorkerEventV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneRuntimeV3 } from './imageEditorGpuSceneRuntimeV3'

function fakeCompositor(
  overrides: Partial<ImageEditorGpuRasterCompositorV3Like> = {},
): ImageEditorGpuRasterCompositorV3Like {
  return {
    syncScene: vi.fn(), updateTransientTransform: vi.fn(), updateViewport: vi.fn(),
    attachPresentationSurface: vi.fn(), memoryPressureBytes: vi.fn(() => 0),
    estimateTileGpuBytes: vi.fn(() => 4),
    uploadTile: vi.fn(() => ({ destroy: vi.fn() }) as never),
    requiredResourceKeys: vi.fn(() => []), missingResources: vi.fn(() => []),
    render: vi.fn(async () => { throw new Error('unexpected render') }),
    readLinearPixelsForTest: vi.fn(async () => new Float32Array()),
    snapshotStats: vi.fn(() => ({
      uploadCount: 0, pipelineCompileCount: 1, frameCount: 0,
      diagnosticReadbackCount: 0, transientUniformUpdateCount: 0,
      residentTileCount: 0, atlasPageCount: 0, allocatedAtlasBytes: 0,
      minimumPlannedMip: 0, maximumPlannedMip: 0,
      surfaceFrameCount: 0, imageBitmapFrameCount: 0, directSurfaceFailureCount: 0,
    })),
    dispose: vi.fn(),
    ...overrides,
  }
}

function initializeRequest() {
  return {
    type: 'initialize' as const,
    protocolVersion: IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
    sessionId: 'gpu-runtime-fallback-test',
    memoryBudgetBytes: IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  }
}

function managedDevice(device: GpuDevice, generation: number): ManagedWebGpuDevice {
  return { provider: {}, adapter: {}, device, generation } as ManagedWebGpuDevice
}

describe('ImageEditorGpuSceneRuntimeV3 fallback', () => {
  it('效果执行失败发布可恢复失败且dispose释放合成资源', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const compositor = fakeCompositor({ render: vi.fn(async () => {
      throw new Error('effect target failed')
    }) })
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: {
        onDeviceLost: vi.fn(), acquire: async () => managedDevice({} as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }), destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
      compositorFactory: () => compositor,
    })
    runtime.handle(initializeRequest())
    runtime.handle({ type: 'sync-scene', sceneGeneration: 1,
      document: createImageEditDocumentV3({ width: 16, height: 16 }), resourceDescriptors: [] })
    runtime.handle({ type: 'update-viewport', sceneGeneration: 1, cameraSequence: 1,
      layout: { stageWidth: 16, stageHeight: 16, viewportKey: 'effect-failure',
        viewport: { documentX: 0, documentY: 0, width: 16, height: 16,
          zoom: 1, devicePixelRatio: 1 } } })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    runtime.handle({ type: 'render', requestId: 'effect-failure', sceneGeneration: 1,
      cameraSequence: 1, interactionSequence: 0, surfaceGeneration: 0, quality: 'stable' })
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
      type: 'failed', requestId: 'effect-failure', code: 'composition-not-ready',
      recoverable: true, message: 'effect target failed',
    }))
    expect(runtime.getStatus()).toBe('fallback')
    expect(compositor.dispose).toHaveBeenCalledOnce()
    runtime.dispose()
    expect(compositor.dispose).toHaveBeenCalledOnce()
  })

  it('视口真实常驻target超预算时只降级一次并立即释放GPU状态', async () => {
    const compositor = fakeCompositor({ memoryPressureBytes: vi.fn(() => 8) })
    const contextDispose = vi.fn()
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: {
        onDeviceLost: vi.fn(), acquire: async () => managedDevice({} as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }), destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: contextDispose }),
      compositorFactory: () => compositor,
    })
    runtime.handle(initializeRequest())
    runtime.handle({ type: 'sync-scene', sceneGeneration: 1,
      document: createImageEditDocumentV3({ width: 16, height: 16 }), resourceDescriptors: [] })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    const updateViewport = (cameraSequence: number) => runtime.handle({
      type: 'update-viewport', sceneGeneration: 1, cameraSequence,
      layout: { stageWidth: 16, stageHeight: 16, viewportKey: `pressure-${cameraSequence}`,
        viewport: { documentX: 0, documentY: 0, width: 16, height: 16,
          zoom: 1, devicePixelRatio: 1 } },
    })
    updateViewport(1)
    updateViewport(2)

    expect(runtime.getStatus()).toBe('fallback')
    expect(events.filter((event) => event.type === 'failed')).toEqual([
      expect.objectContaining({ type: 'failed', code: 'resource-budget-exceeded', recoverable: true }),
    ])
    expect(compositor.dispose).toHaveBeenCalledOnce()
    expect(contextDispose).toHaveBeenCalledOnce()
    runtime.dispose()
  })
})
