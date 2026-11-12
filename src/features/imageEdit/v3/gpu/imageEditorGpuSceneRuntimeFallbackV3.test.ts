import { describe, expect, it, vi } from 'vitest'

import type { ManagedWebGpuDevice } from '@/core/imageEdit/webgpu/deviceManager'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createImageEditDocumentV3, createImageEditAdjustmentLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorGpuRasterCompositorV3Like } from './imageEditorGpuRasterCompositorV3'
import type { ImageEditorGpuRasterFrameV3 } from './imageEditorGpuRasterPipelineContractsV3'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  type ImageEditorGpuSceneWorkerEventV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneRuntimeV3 } from './imageEditorGpuSceneRuntimeV3'

function bitmapFrame(surfaceGeneration: number): ImageEditorGpuRasterFrameV3 {
  return {
    presentation: {
      kind: 'gpu-image-bitmap', surfaceGeneration, width: 16, height: 16,
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
  }
}

/** 第一次渲染按给定错误失败，之后正常出帧。 */
function renderFailingOnce(error: unknown) {
  const render = vi.fn(async (_resolve: unknown, surfaceGeneration: number) => bitmapFrame(surfaceGeneration))
  render.mockRejectedValueOnce(error)
  return render
}

function renderRequest(requestId: string) {
  return { type: 'render' as const, requestId, sceneGeneration: 1,
    cameraSequence: 1, interactionSequence: 0, surfaceGeneration: 0, quality: 'stable' as const }
}

/** 初始化并同步一个 16×16 场景与视口，等同客户端打开文档后的第一组消息。 */
function startRuntime(
  events: ImageEditorGpuSceneWorkerEventV3[],
  compositorFactory: () => ImageEditorGpuRasterCompositorV3Like,
  options: {
    device?: GpuDevice
    acquire?: () => Promise<ManagedWebGpuDevice>
    contextErrors?: Array<(error: unknown) => void>
  } = {},
): ImageEditorGpuSceneRuntimeV3 {
  const device = options.device ?? {} as GpuDevice
  const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
    deviceManager: {
      onDeviceLost: vi.fn(), acquire: options.acquire ?? (async () => managedDevice(device, 1)),
      getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }), destroy: vi.fn(),
    },
    contextFactory: async () => ({
      onError: (listener) => {
        options.contextErrors?.push(listener)
        return vi.fn()
      },
      dispose: vi.fn(),
    }),
    compositorFactory,
  })
  runtime.handle(initializeRequest())
  runtime.handle({ type: 'sync-scene', quality: 'stable', sceneGeneration: 1,
    document: createImageEditDocumentV3({ width: 16, height: 16 }), resourceDescriptors: [] })
  runtime.handle({ type: 'update-viewport', sceneGeneration: 1, cameraSequence: 1,
    layout: { stageWidth: 16, stageHeight: 16, viewportKey: 'frame-failure',
      viewport: { documentX: 0, documentY: 0, width: 16, height: 16, zoom: 1, devicePixelRatio: 1 } } })
  return runtime
}

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
  it('登记不支持的节点携带具体原因进入既有可恢复失败通道', () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const runtime = new ImageEditorGpuSceneRuntimeV3(event => events.push(event))
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    const resourceRef = `sha256:${'a'.repeat(64)}` as const
    document.layers = [createImageEditRasterLayerV3('source', '源', resourceRef), createImageEditAdjustmentLayerV3('unknown', '未知', 'unknown-probe', {})]
    runtime.handle({ type: 'sync-scene', quality: 'stable', sceneGeneration: 1, document, resourceDescriptors: [{ resourceRef, byteLength: 1024, mediaType: 'image/png' }] })
    expect(events).toContainEqual(expect.objectContaining({ type: 'failed', code: 'composition-not-ready', recoverable: true, message: expect.stringMatching(/GPU 不支持.*unknown-probe/) }))
    runtime.dispose()
  })
  it('单帧合成失败只丢这一帧，保留设备与合成器，下一帧正常出图', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const compositor = fakeCompositor({ render: renderFailingOnce(new Error('effect target failed')) })
    const runtime = startRuntime(events, () => compositor)
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))

    runtime.handle(renderRequest('broken'))
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
      type: 'failed', requestId: 'broken', code: 'frame-failed', recoverable: true, message: 'effect target failed',
    }))
    expect(runtime.getStatus()).toBe('ready')
    expect(compositor.dispose).not.toHaveBeenCalled()
    runtime.handle(renderRequest('next'))
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'frame-ready', requestId: 'next' }))
    runtime.dispose()
  })

  it('连续失败才交给 CPU，之后定时重新尝试并回到 GPU', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const events: ImageEditorGpuSceneWorkerEventV3[] = []
      const compositors: ImageEditorGpuRasterCompositorV3Like[] = []
      const runtime = startRuntime(events, () => {
        const compositor = fakeCompositor({ render: compositors.length === 0
          ? vi.fn(async () => { throw new Error('pipeline broken') })
          : vi.fn(async (_resolve: unknown, surfaceGeneration: number) => bitmapFrame(surfaceGeneration)) })
        compositors.push(compositor)
        return compositor
      })
      await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
      for (const requestId of ['first', 'second']) {
        runtime.handle(renderRequest(requestId))
        await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'frame-failed', requestId }))
      }
      runtime.handle(renderRequest('third'))
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'gpu-fallback', requestId: 'third' }))
      expect(runtime.getStatus()).toBe('fallback')
      expect(compositors[0]?.dispose).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(10_000)
      await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
      expect(events).toContainEqual(expect.objectContaining({ type: 'ready', recovered: true }))
      runtime.handle(renderRequest('recovered'))
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'frame-ready', requestId: 'recovered' }))
      runtime.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('设备报显存不足时让出缓存并降低预览档位，仍留在 GPU 上', async () => {
    class FakeGpuOutOfMemoryError extends Error {}
    vi.stubGlobal('GPUOutOfMemoryError', FakeGpuOutOfMemoryError)
    try {
      const events: ImageEditorGpuSceneWorkerEventV3[] = []
      const reducePreviewMemory = vi.fn(() => true)
      const compositor = Object.assign(fakeCompositor({ render: renderFailingOnce(Object.assign(
        new Error('合成目标分配失败'), { cause: new FakeGpuOutOfMemoryError('out of memory') },
      )) }), { reducePreviewMemory })
      const device = Object.assign(new EventTarget(), { destroy: vi.fn() })
      const runtime = startRuntime(events, () => compositor, { device: device as unknown as GpuDevice })
      await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))

      runtime.handle(renderRequest('oom'))
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
        type: 'failed', code: 'frame-failed', requestId: 'oom', outOfMemory: true,
      }))
      expect(reducePreviewMemory).toHaveBeenCalledOnce()
      expect(runtime.getStatus()).toBe('ready')
      runtime.handle(renderRequest('after-oom'))
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'frame-ready', requestId: 'after-oom' }))

      // 原生显存不足只通过设备的 uncapturederror 上报，同样降档而不回退。
      device.dispatchEvent(Object.assign(new Event('uncapturederror'), { error: new FakeGpuOutOfMemoryError('out of memory') }))
      expect(reducePreviewMemory).toHaveBeenCalledTimes(2)
      expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'frame-failed', requestId: null, outOfMemory: true })
      expect(runtime.getStatus()).toBe('ready')
      expect(compositor.dispose).not.toHaveBeenCalled()
      runtime.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('异步上报的非显存错误只请求重绘不计数；上一个会话迟到的错误不算到新会话', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const contextErrors: Array<(error: unknown) => void> = []
    const runtime = startRuntime(events, () => fakeCompositor({ render: renderFailingOnce(new Error('unused')) }), { contextErrors })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    runtime.handle(renderRequest('first'))
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'frame-failed', requestId: 'first' }))
    for (let index = 0; index < 3; index += 1) contextErrors[0]?.(new Error('surface validation'))
    expect(events.slice(-3)).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({
      type: 'failed', code: 'frame-failed', requestId: null,
    })))
    expect(runtime.getStatus()).toBe('ready')

    runtime.handle({ type: 'release' })
    runtime.handle({ ...initializeRequest(), sessionId: 'next-session' })
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'ready' }))
    const count = events.length
    contextErrors[0]?.(new Error('late error from previous session'))
    expect(events).toHaveLength(count)
    runtime.dispose()
  })

  it('首次初始化失败也按退避重试，设备可用后回到 GPU', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const events: ImageEditorGpuSceneWorkerEventV3[] = []
      const acquire = vi.fn(async () => managedDevice({} as GpuDevice, 1))
      acquire.mockRejectedValueOnce(new Error('adapter busy'))
      const runtime = startRuntime(events, () => fakeCompositor(), { acquire })
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'gpu-fallback' }))
      expect(runtime.getStatus()).toBe('fallback')
      await vi.advanceTimersByTimeAsync(10_000)
      await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
      expect(events.at(-1)).toMatchObject({ type: 'ready', recovered: true })
      runtime.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('视口常驻目标超出预算时仍留在 GPU 上，不进入回退', async () => {
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
    runtime.handle({ type: 'sync-scene', quality: 'stable', sceneGeneration: 1,
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

    expect(runtime.getStatus()).toBe('ready')
    expect(events.filter((event) => event.type === 'failed')).toEqual([])
    expect(compositor.dispose).not.toHaveBeenCalled()
    expect(contextDispose).not.toHaveBeenCalled()
    runtime.dispose()
  })
})
