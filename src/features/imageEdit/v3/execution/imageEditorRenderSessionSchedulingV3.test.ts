/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorManagedViewportCompositeV3, ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'
import type { ImageEditorViewportCompositeRuntimeEventV3 } from './viewportCompositeProtocolV3'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { DefaultImageEditorRenderSessionV3, type ImageEditorRenderSessionDiagnosticsV3 } from './imageEditorRenderSessionV3'
import { result, layout, installImageEditorRenderSessionTestSurface } from './imageEditorRenderSessionTestFixtures'

describe('ImageEditorRenderSessionV3 调度与恢复', () => {
  installImageEditorRenderSessionTestSurface()
  it('同一动画帧内 1000 次连续相机事件只合成最新快照', async () => {
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'camera-coalescing-test' },
      { client: { render: vi.fn(), cancel: vi.fn(), dispose: vi.fn() } },
    )
    let cameraSequence = 0
    session.subscribeDiagnostics((diagnostics) => {
      cameraSequence = diagnostics.cameraSequence
    })
    session.updateViewport(layout)
    expect(cameraSequence).toBe(1)

    for (let index = 1; index <= 1_000; index += 1) {
      session.updateViewport({
        ...layout,
        viewportKey: `viewport-${index + 1}`,
        viewport: { ...layout.viewport, documentX: index },
      })
    }
    expect(cameraSequence).toBe(1)

    await vi.advanceTimersByTimeAsync(16)
    expect(cameraSequence).toBe(2)
    session.dispose()
  })

  it('放大后的可见区仍被 mip0 成品覆盖时在当前绘制帧直接复用', async () => {
    const requests: ImageEditorViewportCompositeRequestV3[] = []
    const client = {
      render: vi.fn(async (request: ImageEditorViewportCompositeRequestV3) => {
        requests.push(request)
        return result(request)
      }),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'clear-zoom-reuse-test' },
      { client },
    )
    session.attachSurface({
      surfaceId: 'surface-clear-zoom',
      front: document.createElement('canvas'),
      safety: document.createElement('canvas'),
    })
    session.updateViewport(layout)
    session.updateSnapshot({
      document: createImageEditDocumentV3({ width: 1_600, height: 1_000 }),
      renderGeneration: 1,
      geometryHash: 'geometry-clear-zoom',
      quality: 'stable',
      resourceDescriptors: [],
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(requests.some((request) => request.phase === 'target')).toBe(true)
    requests.length = 0
    let targetMipCoverage = 0
    const unsubscribe = session.subscribeDiagnostics((value) => {
      targetMipCoverage = value.targetMipCoverage
    })

    session.updateViewport({
      ...layout,
      viewportKey: 'viewport-zoomed',
      viewport: { ...layout.viewport, documentX: 400, documentY: 250, zoom: 1 },
    })
    await vi.advanceTimersByTimeAsync(16)

    expect(requests).toHaveLength(0)
    expect(targetMipCoverage).toBe(1)
    unsubscribe()
    session.dispose()
  })

  it('GPU 丢失和 CPU 后备只更新会话状态，不卸载最后显示表面', () => {
    const runtime = {
      listener: null as ((event: ImageEditorViewportCompositeRuntimeEventV3) => void) | null,
    }
    const unsubscribeRuntime = vi.fn()
    const client = {
      render: vi.fn(() => new Promise<ImageEditorManagedViewportCompositeV3>(() => undefined)),
      cancel: vi.fn(),
      dispose: vi.fn(),
      subscribeRuntime: vi.fn((listener: typeof runtime.listener) => {
        runtime.listener = listener
        return unsubscribeRuntime
      }),
    }
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'runtime-recovery-test' },
      { client },
    )
    const front = document.createElement('canvas')
    session.attachSurface({
      surfaceId: 'persistent-surface',
      front,
      safety: document.createElement('canvas'),
    })
    session.updateViewport(layout)
    session.updateSnapshot({
      document: createImageEditDocumentV3({ width: 1_600, height: 1_000 }),
      renderGeneration: 1,
      geometryHash: 'geometry-runtime',
      quality: 'stable',
      resourceDescriptors: [],
    })
    let latest: ImageEditorRenderSessionDiagnosticsV3 | null = null
    const unsubscribeDiagnostics = session.subscribeDiagnostics((value) => { latest = value })

    if (!runtime.listener) throw new Error('缺少运行时状态订阅')
    runtime.listener({
      type: 'runtime', requestId: 'request', sequence: 1, renderGeneration: 1,
      status: 'device-lost', reason: 'adapter reset', deviceGeneration: null,
    })
    expect(latest).toMatchObject({
      surfaceId: 'persistent-surface', effectBackend: 'cpu', deviceStatus: 'lost',
      diagnostic: 'adapter reset',
    })
    runtime.listener({
      type: 'runtime', requestId: 'request', sequence: 1, renderGeneration: 1,
      status: 'gpu-ready', reason: null, deviceGeneration: 4,
    })
    expect(latest).toMatchObject({
      surfaceId: 'persistent-surface', effectBackend: 'gpu', deviceStatus: 'ready',
      deviceGeneration: 4,
    })
    expect(front.isConnected).toBe(false)
    unsubscribeDiagnostics()
    session.dispose()
    expect(unsubscribeRuntime).toHaveBeenCalledOnce()
  })

  it('权威快照、相机和瞬态变换只转发到会话唯一 GPU Scene，帧间只发送最新矩阵', () => {
    const gpuSubscription: {
      listener?: (event: ImageEditorGpuSceneWorkerEventV3) => void
    } = {}
    const gpuScene = {
      syncScene: vi.fn((snapshot) => gpuSubscription.listener?.({
        type: 'scene-resources-ready', sceneGeneration: snapshot.renderGeneration, deviceGeneration: 0,
      })),
      uploadTiles: vi.fn(),
      updateTransientLayerTransform: vi.fn(),
      clearTransientLayerTransform: vi.fn(),
      updateViewport: vi.fn(),
      requestFrame: vi.fn(),
      subscribe: vi.fn((listener) => {
        gpuSubscription.listener = listener
        return vi.fn()
      }),
      dispose: vi.fn(),
    } satisfies ImageEditorGpuSceneClientV3Like
    const client = {
      render: vi.fn(() => new Promise<ImageEditorManagedViewportCompositeV3>(() => undefined)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'gpu-scene-contract-test' },
      { client, gpuSceneClient: gpuScene },
    )
    session.updateViewport(layout)
    const imageDocument = createImageEditDocumentV3({ width: 64, height: 64 })
    const snapshot = {
      document: imageDocument,
      renderGeneration: 7,
      geometryHash: 'geometry-gpu-scene',
      quality: 'stable' as const,
      resourceDescriptors: [],
    }
    session.updateSnapshot(snapshot)
    let diagnostics: ImageEditorRenderSessionDiagnosticsV3 | null = null
    session.subscribeDiagnostics((value) => { diagnostics = value })
    if (!gpuSubscription.listener) throw new Error('缺少 GPU Scene 事件订阅')
    gpuSubscription.listener({
      type: 'ready', sceneGeneration: 7, deviceGeneration: 2, recovered: false,
    })
    session.updateTransientLayerTransform('source', [1, 0, 0, 1, 5, 8], 11)
    session.requestFrame('draft')
    session.clearTransientLayerTransform('source', 12)

    expect(gpuScene.syncScene).toHaveBeenCalledOnce()
    expect(gpuScene.syncScene).toHaveBeenCalledWith(snapshot)
    expect(gpuScene.updateViewport).toHaveBeenCalledWith(7, 1, expect.objectContaining({
      viewportKey: 'viewport-1',
    }))
    expect(gpuScene.updateTransientLayerTransform).not.toHaveBeenCalled()
    expect(gpuScene.requestFrame).toHaveBeenCalledWith(7, 1, 0, 'stable')
    expect(diagnostics).toMatchObject({
      compositionBackend: 'cpu',
      presentationBackend: 'canvas2d',
      deviceStatus: 'ready',
      deviceGeneration: 2,
    })
    const closeInitialFrame = vi.fn()
    gpuSubscription.listener({
      type: 'frame-ready', requestId: 'hidden-frame', sceneGeneration: 7,
      cameraSequence: 1, interactionSequence: 0, deviceGeneration: 2,
      surfaceGeneration: 0,
      quality: 'stable', bitmap: { close: closeInitialFrame } as unknown as ImageBitmap,
      diagnostics: {
        uploadCount: 1, pipelineCompileCount: 2, frameCount: 1, diagnosticReadbackCount: 0,
        surfaceFrameCount: 0, imageBitmapFrameCount: 1, directSurfaceFailureCount: 0,
        transientUniformUpdateCount: 0,
        residentTileCount: 1, atlasPageCount: 1, allocatedAtlasBytes: 1_056_784,
        minimumPlannedMip: 0, maximumPlannedMip: 0,
      },
    })
    expect(closeInitialFrame).toHaveBeenCalledOnce()
    expect(gpuScene.updateTransientLayerTransform).not.toHaveBeenCalled()
    expect(gpuScene.clearTransientLayerTransform).toHaveBeenCalledWith(7, 'source', 12)
    expect(gpuScene.requestFrame).toHaveBeenLastCalledWith(7, 1, 12, 'draft')
    expect(diagnostics).toMatchObject({
      compositionBackend: 'cpu', presentationBackend: 'canvas2d',
    })
    session.dispose()
    expect(gpuScene.dispose).toHaveBeenCalledOnce()
  })
})
