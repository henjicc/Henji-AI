import { describe, expect, it, vi } from 'vitest'

import type {
  ImageEditWebGpuDeviceLoss,
  ManagedWebGpuDevice,
} from '@/core/imageEdit/webgpu/deviceManager'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  type ImageEditorGpuSceneWorkerEventV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneRuntimeV3 } from './imageEditorGpuSceneRuntimeV3'
import type { ImageEditorGpuRasterCompositorV3Like } from './imageEditorGpuRasterCompositorV3'

function fakeCompositor(
  overrides: Partial<ImageEditorGpuRasterCompositorV3Like> = {},
): ImageEditorGpuRasterCompositorV3Like {
  return {
    syncScene: vi.fn(),
    updateTransientTransform: vi.fn(),
    updateViewport: vi.fn(),
    attachPresentationSurface: vi.fn(),
    memoryPressureBytes: vi.fn(() => 0),
    estimateTileGpuBytes: vi.fn(() => 4),
    uploadTile: vi.fn(() => ({ destroy: vi.fn() }) as never),
    requiredResourceKeys: vi.fn(() => []),
    missingResources: vi.fn(() => []),
    render: vi.fn(async (_resolve, surfaceGeneration) => ({
      presentation: {
        kind: 'gpu-image-bitmap' as const,
        surfaceGeneration,
        width: 16,
        height: 16,
        bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      },
      stats: {
        uploadCount: 0, pipelineCompileCount: 1, frameCount: 1,
        diagnosticReadbackCount: 0, transientUniformUpdateCount: 0,
        residentTileCount: 0, atlasPageCount: 0, allocatedAtlasBytes: 0,
        minimumPlannedMip: 0, maximumPlannedMip: 0,
        surfaceFrameCount: 0, imageBitmapFrameCount: 1, directSurfaceFailureCount: 0,
      },
      usedResourceKeys: [],
    })),
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
    sessionId: 'gpu-runtime-test',
    memoryBudgetBytes: IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  }
}

function managedDevice(device: GpuDevice, generation: number): ManagedWebGpuDevice {
  return { provider: {}, adapter: {}, device, generation } as ManagedWebGpuDevice
}

describe('ImageEditorGpuSceneRuntimeV3', () => {
  it('Reality初始化失败注入不创建GPU设备，并按最新scene发布可恢复失败', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const acquire = vi.fn(async () => managedDevice({} as GpuDevice, 1))
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: {
        onDeviceLost: vi.fn(), acquire,
        getRecoveryStatus: () => ({ generation: 0, retryAfterMs: 0 }), destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
      compositorFactory: () => fakeCompositor(),
    })
    runtime.handle({ ...initializeRequest(), diagnosticInitializationFailure: true })
    runtime.handle({
      type: 'sync-scene', sceneGeneration: 3,
      document: createImageEditDocumentV3({ width: 16, height: 16 }), resourceDescriptors: [],
    })

    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      type: 'failed', code: 'initialization-failed', sceneGeneration: 3, recoverable: true,
    })))
    expect(acquire).not.toHaveBeenCalled()
    expect(runtime.getStatus()).toBe('fallback')
    runtime.dispose()
  })

  it('Reality设备丢失注入销毁会话当前唯一GPUDevice', async () => {
    const destroyDevice = vi.fn()
    const runtime = new ImageEditorGpuSceneRuntimeV3(() => undefined, {
      deviceManager: {
        onDeviceLost: vi.fn(),
        acquire: async () => managedDevice({ destroy: destroyDevice } as unknown as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }), destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
      compositorFactory: () => fakeCompositor(),
    })
    runtime.handle(initializeRequest())
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    runtime.handle({ type: 'diagnostic-device-loss', recovery: 'success' })
    expect(destroyDevice).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it('同一会话只创建一个设备和一个 vGPU Context，并在 dispose 完整释放', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const contextDispose = vi.fn()
    const deviceDestroy = vi.fn()
    const device = { destroy: deviceDestroy } as unknown as GpuDevice
    const acquire = vi.fn(async () => managedDevice(device, 1))
    const destroy = vi.fn(() => deviceDestroy())
    const manager = {
      onDeviceLost: vi.fn(), acquire,
      getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }),
      destroy,
    }
    const contextFactory = vi.fn(async () => ({
      onError: () => vi.fn(),
      dispose: contextDispose,
    }))
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: manager,
      contextFactory,
      compositorFactory: () => fakeCompositor(),
    })

    runtime.handle(initializeRequest())
    runtime.handle(initializeRequest())
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'ready')).toHaveLength(2))

    expect(acquire).toHaveBeenCalledOnce()
    expect(contextFactory).toHaveBeenCalledOnce()
    runtime.dispose()
    expect(contextDispose).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('设备丢失后释放旧 Context、请求缺失资源并按最新 scene 恢复', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const lostHandler: {
      value?: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void
    } = {}
    let generation = 0
    const contexts: Array<{ dispose: ReturnType<typeof vi.fn> }> = []
    const compositors: ImageEditorGpuRasterCompositorV3Like[] = []
    const resourceRef = `sha256:${'c'.repeat(64)}` as const
    const resourceKey = {
      resourceRef, mip: 0, tileX: 0, tileY: 0, contentVersion: `${resourceRef}:4`,
    }
    const destroyTexture = vi.fn()
    const manager = {
      onDeviceLost: (handler: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void) => {
        lostHandler.value = handler
      },
      acquire: vi.fn(async () => managedDevice({} as GpuDevice, ++generation)),
      getRecoveryStatus: () => ({ generation, retryAfterMs: 0 }),
      destroy: vi.fn(),
    }
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: manager,
      contextFactory: async () => {
        const state = { dispose: vi.fn() }
        contexts.push(state)
        return { onError: () => vi.fn(), dispose: state.dispose }
      },
      compositorFactory: () => {
        const compositor = fakeCompositor({
          requiredResourceKeys: vi.fn(() => [resourceKey]),
          uploadTile: vi.fn(() => ({ destroy: destroyTexture }) as never),
        })
        compositors.push(compositor)
        return compositor
      },
    })
    runtime.handle(initializeRequest())
    runtime.handle({
      type: 'sync-scene',
      sceneGeneration: 4,
      document: createImageEditDocumentV3({ width: 32, height: 32 }),
      resourceDescriptors: [],
    })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    const offscreen = { width: 32, height: 32 } as OffscreenCanvas
    runtime.handle({ type: 'attach-presentation-surface', surfaceGeneration: 1, canvas: offscreen })
    const latestDocument = createImageEditDocumentV3({ width: 64, height: 64 })
    latestDocument.layers = [createImageEditRasterLayerV3('latest', '最新图层', resourceRef)]
    runtime.handle({
      type: 'sync-scene',
      sceneGeneration: 5,
      document: latestDocument,
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    })
    runtime.handle({
      type: 'upload-tiles', sceneGeneration: 5,
      tiles: [{
        key: resourceKey, estimatedGpuBytes: 4,
        tile: {
          resourceRef, mip: 0, tileX: 0, tileY: 0, halo: 0,
          width: 1, height: 1, channels: 4, bitDepth: 8,
          sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian',
          rowStride: 4, colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight',
          orientationApplied: true, originX: 0, originY: 0,
          pixels: new Uint8Array([255, 0, 0, 255]).buffer,
        },
      }],
    })
    if (!lostHandler.value) throw new Error('未注册设备丢失处理器')
    lostHandler.value('reset', {
      generation: 1,
      reason: 'reset',
      recovery: { state: 'idle', generation: 1, recentLosses: 1, retryAfterMs: 0 },
    })

    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'device-lost', sceneGeneration: 5 }),
      expect.objectContaining({ type: 'ready', sceneGeneration: 5, recovered: true }),
    ]))
    expect(contexts[0]?.dispose).toHaveBeenCalledOnce()
    expect(compositors[0]?.dispose).toHaveBeenCalledOnce()
    expect(destroyTexture).toHaveBeenCalledOnce()
    expect(compositors[1]?.syncScene).toHaveBeenCalledOnce()
    expect(compositors[1]?.attachPresentationSurface).toHaveBeenCalledOnce()
    expect(manager.acquire).toHaveBeenCalledTimes(2)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tiles-needed', sceneGeneration: 5, keys: [resourceKey],
    }))

    lostHandler.value('reset-again', {
      generation: 2,
      reason: 'reset-again',
      recovery: { state: 'idle', generation: 2, recentLosses: 2, retryAfterMs: 0 },
    })
    expect(runtime.getStatus()).toBe('fallback')
    expect(contexts[1]?.dispose).toHaveBeenCalledOnce()
    expect(compositors[1]?.dispose).toHaveBeenCalledOnce()
    expect(manager.acquire).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('Surface正常帧直接发ready事件，不创建或转移ImageBitmap且回读计数为0', async () => {
    const emit = vi.fn()
    const compositor = fakeCompositor({
      render: vi.fn(async (_resolve, surfaceGeneration) => ({
        presentation: {
          kind: 'webgpu-surface' as const,
          surfaceGeneration,
          width: 32,
          height: 24,
        },
        stats: {
          uploadCount: 0, pipelineCompileCount: 2, frameCount: 1,
          diagnosticReadbackCount: 0, transientUniformUpdateCount: 0,
          residentTileCount: 0, atlasPageCount: 0, allocatedAtlasBytes: 0,
          minimumPlannedMip: 0, maximumPlannedMip: 0,
          surfaceFrameCount: 1, imageBitmapFrameCount: 0, directSurfaceFailureCount: 0,
        },
        usedResourceKeys: [],
      })),
    })
    const runtime = new ImageEditorGpuSceneRuntimeV3(emit, {
      deviceManager: {
        onDeviceLost: vi.fn(), acquire: async () => managedDevice({} as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }), destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
      compositorFactory: () => compositor,
    })
    const offscreen = { width: 32, height: 24 } as OffscreenCanvas
    runtime.handle(initializeRequest())
    runtime.handle({ type: 'attach-presentation-surface', surfaceGeneration: 1, canvas: offscreen })
    runtime.handle({
      type: 'sync-scene', sceneGeneration: 1,
      document: createImageEditDocumentV3({ width: 32, height: 24 }), resourceDescriptors: [],
    })
    runtime.handle({
      type: 'update-viewport', sceneGeneration: 1, cameraSequence: 1,
      layout: {
        stageWidth: 32, stageHeight: 24, viewportKey: 'surface',
        viewport: { documentX: 0, documentY: 0, width: 32, height: 24, zoom: 1, devicePixelRatio: 1 },
      },
    })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    runtime.handle({
      type: 'render', requestId: 'direct', sceneGeneration: 1,
      cameraSequence: 1, interactionSequence: 0, surfaceGeneration: 1, quality: 'stable',
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'surface-frame-ready', requestId: 'direct', width: 32, height: 24,
      diagnostics: expect.objectContaining({
        surfaceFrameCount: 1, imageBitmapFrameCount: 0, diagnosticReadbackCount: 0,
      }),
    }), []))
    const directEvent = emit.mock.calls.find(([event]) => event.type === 'surface-frame-ready')?.[0]
    expect(directEvent).not.toHaveProperty('bitmap')
    expect(compositor.attachPresentationSurface).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it('render 同时校验三类序列，旧请求静默丢弃', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: {
        onDeviceLost: vi.fn(),
        acquire: async () => managedDevice({} as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }),
        destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
      compositorFactory: () => fakeCompositor(),
    })
    runtime.handle(initializeRequest())
    runtime.handle({
      type: 'sync-scene', sceneGeneration: 2,
      document: createImageEditDocumentV3({ width: 16, height: 16 }), resourceDescriptors: [],
    })
    runtime.handle({
      type: 'update-viewport', sceneGeneration: 2, cameraSequence: 3,
      layout: {
        stageWidth: 16, stageHeight: 16, viewportKey: 'viewport',
        viewport: { documentX: 0, documentY: 0, width: 16, height: 16, zoom: 1, devicePixelRatio: 1 },
      },
    })
    runtime.handle({
      type: 'update-transform', sceneGeneration: 2, interactionSequence: 5,
      layerId: 'layer', transform: [1, 0, 0, 1, 4, 6],
    })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    const eventCount = events.length
    runtime.handle({
      type: 'render', requestId: 'stale', sceneGeneration: 2,
      cameraSequence: 2, interactionSequence: 5, surfaceGeneration: 0, quality: 'draft',
    })
    expect(events).toHaveLength(eventCount)
    runtime.handle({
      type: 'render', requestId: 'current', sceneGeneration: 2,
      cameraSequence: 3, interactionSequence: 5, surfaceGeneration: 0, quality: 'draft',
    })
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
      type: 'frame-ready', requestId: 'current', diagnostics: { pipelineCompileCount: 1 },
    }))
    runtime.dispose()
  })

  it('同一资源重复上传只创建一张GPU纹理，dispose完整释放注册表资源', async () => {
    const resourceRef = `sha256:${'a'.repeat(64)}` as const
    const destroyTexture = vi.fn()
    const uploadTile = vi.fn(() => ({
      key: { resourceRef, mip: 0, tileX: 0, tileY: 0, contentVersion: `${resourceRef}:4` },
      tile: { originX: 0, originY: 0, width: 1, height: 1 },
      texture: {},
      destroy: destroyTexture,
    }) as never)
    const compositor = fakeCompositor({ uploadTile })
    const runtime = new ImageEditorGpuSceneRuntimeV3(() => undefined, {
      deviceManager: {
        onDeviceLost: vi.fn(),
        acquire: async () => managedDevice({} as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }),
        destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
      compositorFactory: () => compositor,
    })
    const document = createImageEditDocumentV3({ width: 1, height: 1 })
    document.layers = [createImageEditRasterLayerV3('layer', '图层', resourceRef)]
    runtime.handle(initializeRequest())
    runtime.handle({
      type: 'sync-scene',
      sceneGeneration: 1,
      document,
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    const key = { resourceRef, mip: 0, tileX: 0, tileY: 0, contentVersion: `${resourceRef}:4` }
    const tile = {
      resourceRef, mip: 0, tileX: 0, tileY: 0, halo: 0,
      width: 1, height: 1, channels: 4 as const, bitDepth: 8 as const,
      sampleFormat: 'uint' as const, numericRange: 'unorm8' as const,
      byteOrder: 'little-endian' as const, rowStride: 4, colorSpace: 'srgb' as const,
      transferFunction: 'srgb' as const, alphaMode: 'straight' as const,
      orientationApplied: true as const, originX: 0, originY: 0,
      pixels: new Uint8Array([255, 0, 0, 255]).buffer,
    }
    runtime.handle({ type: 'upload-tiles', sceneGeneration: 1, tiles: [{ key, tile, estimatedGpuBytes: 4 }] })
    runtime.handle({
      type: 'upload-tiles', sceneGeneration: 1,
      tiles: [{ key, tile: { ...tile, pixels: tile.pixels.slice(0) }, estimatedGpuBytes: 4 }],
    })

    expect(uploadTile).toHaveBeenCalledOnce()
    runtime.dispose()
    expect(destroyTexture).toHaveBeenCalledOnce()
    expect(compositor.dispose).toHaveBeenCalledOnce()
  })

  it('视口背板扩大后立即按LRU释放未保护atlas页，再继续GPU呈现', async () => {
    const resourceRef = `sha256:${'b'.repeat(64)}` as const
    const destroyTexture = vi.fn()
    const compositor = fakeCompositor({
      uploadTile: vi.fn(() => ({ destroy: destroyTexture }) as never),
      memoryPressureBytes: vi.fn(() => destroyTexture.mock.calls.length === 0 ? 8 : 0),
    })
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: {
        onDeviceLost: vi.fn(), acquire: async () => managedDevice({} as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }), destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
      compositorFactory: () => compositor,
    })
    const document = createImageEditDocumentV3({ width: 1, height: 1 })
    document.layers = [createImageEditRasterLayerV3('layer', '图层', resourceRef)]
    runtime.handle(initializeRequest())
    runtime.handle({
      type: 'sync-scene', sceneGeneration: 1, document,
      resourceDescriptors: [{ resourceRef, byteLength: 4, mediaType: 'image/png' }],
    })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    runtime.handle({
      type: 'upload-tiles', sceneGeneration: 1,
      tiles: [{
        key: { resourceRef, mip: 0, tileX: 0, tileY: 0, contentVersion: `${resourceRef}:4` },
        estimatedGpuBytes: 4,
        protections: ['viewport'],
        tile: {
          resourceRef, mip: 0, tileX: 0, tileY: 0, halo: 0,
          width: 1, height: 1, channels: 4, bitDepth: 8,
          sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian',
          rowStride: 4, colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight',
          orientationApplied: true, originX: 0, originY: 0,
          pixels: new Uint8Array([255, 0, 0, 255]).buffer,
        },
      }],
    })
    runtime.handle({
      type: 'update-viewport', sceneGeneration: 1, cameraSequence: 1,
      layout: {
        stageWidth: 1, stageHeight: 1, viewportKey: 'pressure',
        viewport: { documentX: 0, documentY: 0, width: 1, height: 1, zoom: 1, devicePixelRatio: 1 },
      },
    })

    expect(destroyTexture).toHaveBeenCalledOnce()
    expect(events.some((event) => event.type === 'failed')).toBe(false)
    runtime.dispose()
  })
})
