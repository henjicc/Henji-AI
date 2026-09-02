/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'
import type { ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'
import type { ImageEditorViewportCompositeRuntimeEventV3 } from './viewportCompositeProtocolV3'
import {
  DefaultImageEditorRenderSessionV3,
  type ImageEditorRenderSessionDiagnosticsV3,
} from './imageEditorRenderSessionV3'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let complete: ((value: T) => void) | undefined
  return {
    promise: new Promise<T>((resolve) => { complete = resolve }),
    resolve: (value) => complete?.(value),
  }
}

function result(
  request: ImageEditorViewportCompositeRequestV3,
  release = vi.fn(),
): ImageEditorManagedViewportCompositeV3 {
  const mip = request.preferredMip ?? 0
  const outputWidth = Math.ceil(request.document.geometry.width / (2 ** mip))
  const outputHeight = Math.ceil(request.document.geometry.height / (2 ** mip))
  const tiles = []
  for (let y = 0; y < outputHeight; y += 512) {
    for (let x = 0; x < outputWidth; x += 512) {
      const width = Math.min(512, outputWidth - x)
      const height = Math.min(512, outputHeight - y)
      tiles.push({
        bitmap: {
          width,
          height,
          close: vi.fn(),
        } as unknown as ImageBitmap,
        outputRect: { x, y, width, height },
      })
    }
  }
  return {
    documentId: request.document.id,
    revision: request.document.revision,
    renderGeneration: request.renderGeneration,
    cameraSequence: request.cameraSequence,
    geometryHash: request.geometryHash,
    geometry: {
      ...request.document.geometry,
      orientation: { ...request.document.geometry.orientation },
      crop: request.document.geometry.crop ? { ...request.document.geometry.crop } : null,
    },
    viewportKey: request.viewportKey,
    coverage: request.coverage ?? 'viewport',
    mip,
    documentWidth: request.document.geometry.width,
    documentHeight: request.document.geometry.height,
    diagnostics: [],
    tiles,
    release,
  }
}

const layout = {
  stageWidth: 800,
  stageHeight: 500,
  viewportKey: 'viewport-1',
  viewport: {
    documentX: 0,
    documentY: 0,
    width: 800,
    height: 500,
    zoom: 0.5,
    devicePixelRatio: 1,
  },
}

describe('ImageEditorRenderSessionV3', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      setTransform: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('并行调度当前可见区草稿与目标，不再等待整图粗 mip', async () => {
    const requests: ImageEditorViewportCompositeRequestV3[] = []
    const completions: Array<ReturnType<typeof deferred<ImageEditorManagedViewportCompositeV3>>> = []
    const client = {
      render: vi.fn((request: ImageEditorViewportCompositeRequestV3) => {
        requests.push(request)
        const completion = deferred<ImageEditorManagedViewportCompositeV3>()
        completions.push(completion)
        return completion.promise
      }),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'render-session-test' },
      { client },
    )
    let targetMipCoverage = 0
    const unsubscribe = session.subscribeState((state) => {
      targetMipCoverage = state.targetMipCoverage
    })
    const front = document.createElement('canvas')
    session.attachSurface({
      surfaceId: 'surface-a',
      front,
      safety: document.createElement('canvas'),
    })
    session.updateViewport(layout)
    session.updateSnapshot({
      document: createImageEditDocumentV3({ width: 1_600, height: 1_000 }),
      renderGeneration: 1,
      geometryHash: 'geometry-a',
      quality: 'stable',
      resourceDescriptors: [],
    })

    expect(requests).toHaveLength(2)
    const draftRequest = requests.find((request) => request.phase === 'coarse')
    const targetRequest = requests.find((request) => request.phase === 'target')
    expect(draftRequest).toMatchObject({
      coverage: 'viewport', preferredMip: 2, quality: 'draft',
      overscanViewports: 0, forwardPrefetchViewports: 0,
    })
    expect(targetRequest).toMatchObject({
      coverage: 'viewport', viewportKey: 'viewport-1',
      overscanViewports: 0, forwardPrefetchViewports: 0,
    })
    const drawImage = vi.mocked(front.getContext('2d')!.drawImage)
    const drawsBeforeTile = drawImage.mock.calls.length
    targetRequest?.onTileReady?.({
      renderGeneration: 1,
      cameraSequence: 1,
      geometryHash: 'geometry-a',
      mip: 0,
      tileIndex: 0,
      completedTiles: 1,
      totalTiles: 2,
      tile: {
        bitmap: { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap,
        outputRect: { x: 0, y: 0, width: 100, height: 100 },
      },
    })
    expect(targetMipCoverage).toBeGreaterThan(0)
    expect(drawImage).toHaveBeenCalledTimes(drawsBeforeTile)
    if (!targetRequest || !draftRequest) throw new Error('缺少并行显示请求')
    const targetIndex = requests.indexOf(targetRequest)
    const draftIndex = requests.indexOf(draftRequest)
    const releaseLateDraft = vi.fn()
    completions[targetIndex]?.resolve(result(targetRequest))
    await vi.advanceTimersByTimeAsync(0)
    expect(front.dataset.renderGeneration).toBe('1')
    expect(requests.find((request) => (
      request.phase === 'coarse' && request.coverage === 'document'
    ))).toMatchObject({
      viewportKey: 'backdrop:1', preferredMip: 1, quality: 'draft',
      overscanViewports: 0, forwardPrefetchViewports: 0,
    })
    completions[draftIndex]?.resolve(result(draftRequest, releaseLateDraft))
    await vi.advanceTimersByTimeAsync(0)
    expect(releaseLateDraft).toHaveBeenCalledOnce()
    unsubscribe()
    session.dispose()
  })

  it('新 generation 的可见草稿完成前保留旧帧，完成后才整帧晋升', async () => {
    const requests: ImageEditorViewportCompositeRequestV3[] = []
    const completions: Array<ReturnType<typeof deferred<ImageEditorManagedViewportCompositeV3>>> = []
    const client = {
      render: (request: ImageEditorViewportCompositeRequestV3) => {
        requests.push(request)
        const completion = deferred<ImageEditorManagedViewportCompositeV3>()
        completions.push(completion)
        return completion.promise
      },
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const front = document.createElement('canvas')
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'atomic-generation-test' },
      { client },
    )
    session.attachSurface({ surfaceId: 'surface-b', front, safety: document.createElement('canvas') })
    session.updateViewport(layout)
    const documentV3 = createImageEditDocumentV3({ width: 1_600, height: 1_000 })
    session.updateSnapshot({
      document: documentV3, renderGeneration: 1, geometryHash: 'geometry-a',
      quality: 'stable', resourceDescriptors: [],
    })
    const firstTarget = requests.find((request) => request.phase === 'target')
    if (!firstTarget) throw new Error('缺少第一代目标请求')
    const releaseFirst = vi.fn()
    completions[requests.indexOf(firstTarget)]?.resolve(result(firstTarget, releaseFirst))
    await Promise.resolve()
    expect(front.dataset.renderGeneration).toBe('1')

    session.updateSnapshot({
      document: { ...documentV3, revision: 1 }, renderGeneration: 2, geometryHash: 'geometry-a',
      quality: 'draft', resourceDescriptors: [],
    })
    expect(front.dataset.renderGeneration).toBe('1')
    expect(releaseFirst).not.toHaveBeenCalled()
    const secondDraft = requests.find((request) => (
      request.renderGeneration === 2 && request.phase === 'coarse'
    ))
    if (!secondDraft) throw new Error('缺少第二代草稿请求')
    completions[requests.indexOf(secondDraft)]?.resolve(result(secondDraft))
    await Promise.resolve()
    expect(front.dataset.renderGeneration).toBe('2')
    expect(releaseFirst).not.toHaveBeenCalled()
    session.dispose()
  })

  it('新 generation 草稿整帧替换旧画面，清晰目标随后原子接管', async () => {
    const requests: ImageEditorViewportCompositeRequestV3[] = []
    const completions: Array<ReturnType<typeof deferred<ImageEditorManagedViewportCompositeV3>>> = []
    const client = {
      render: (request: ImageEditorViewportCompositeRequestV3) => {
        requests.push(request)
        const completion = deferred<ImageEditorManagedViewportCompositeV3>()
        completions.push(completion)
        return completion.promise
      },
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const front = document.createElement('canvas')
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'retain-stable-frame-test' },
      { client },
    )
    session.attachSurface({ surfaceId: 'surface-stable', front, safety: document.createElement('canvas') })
    session.updateViewport(layout)
    const original = createImageEditDocumentV3({ width: 1_600, height: 1_000 })
    session.updateSnapshot({
      document: original, renderGeneration: 1, geometryHash: 'geometry-a',
      quality: 'stable', resourceDescriptors: [],
    })
    const firstTarget = requests.find((request) => request.phase === 'target')
    if (!firstTarget) throw new Error('缺少第一代目标请求')
    completions[requests.indexOf(firstTarget)]?.resolve(result(firstTarget))
    await Promise.resolve()
    expect(front.dataset.renderGeneration).toBe('1')

    session.updateSnapshot({
      document: { ...original, revision: 1 }, renderGeneration: 2, geometryHash: 'geometry-a',
      quality: 'draft', resourceDescriptors: [],
    })
    const secondDraft = requests.find((request) => (
      request.renderGeneration === 2 && request.phase === 'coarse'
    ))
    const secondTarget = requests.find((request) => (
      request.renderGeneration === 2 && request.phase === 'target'
    ))
    if (!secondDraft || !secondTarget) throw new Error('缺少第二代并行请求')
    completions[requests.indexOf(secondDraft)]?.resolve(result(secondDraft))
    await Promise.resolve()
    expect(front.dataset.renderGeneration).toBe('2')

    completions[requests.indexOf(secondTarget)]?.resolve(result(secondTarget))
    await Promise.resolve()
    expect(front.dataset.renderGeneration).toBe('2')
    session.dispose()
  })

  it('全局效果并行准备可见草稿与共享分析，分析完成后再启动目标', async () => {
    const requests: ImageEditorViewportCompositeRequestV3[] = []
    const completions: Array<ReturnType<typeof deferred<ImageEditorManagedViewportCompositeV3>>> = []
    const client = {
      render: (request: ImageEditorViewportCompositeRequestV3) => {
        requests.push(request)
        const completion = deferred<ImageEditorManagedViewportCompositeV3>()
        completions.push(completion)
        return completion.promise
      },
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'global-analysis-order-test' },
      { client },
    )
    session.attachSurface({
      surfaceId: 'surface-analysis',
      front: document.createElement('canvas'),
      safety: document.createElement('canvas'),
    })
    session.updateViewport(layout)
    const imageDocument = createImageEditDocumentV3({
      width: 6_000,
      height: 4_000,
      sourceResourceId: `sha256:${'a'.repeat(64)}`,
      idFactory: () => 'source',
    })
    imageDocument.layers.push(createImageEditEffectLayerV3(
      'blur', '模糊', 'image.fast-blur-v3', { radius: 64, quality: 'high', mip: 0 },
    ))
    session.updateSnapshot({
      document: imageDocument,
      renderGeneration: 1,
      geometryHash: 'geometry-analysis',
      quality: 'stable',
      resourceDescriptors: [],
    })

    expect(requests).toHaveLength(2)
    const draftRequest = requests.find((request) => request.phase === 'coarse')
    const analysisRequest = requests.find((request) => request.phase === 'analysis')
    expect(draftRequest).toMatchObject({
      coverage: 'viewport', preferredMip: 2, quality: 'draft',
    })
    expect(analysisRequest).toMatchObject({
      coverage: 'document', preferredMip: 2, analysisRequested: true,
    })
    await vi.advanceTimersByTimeAsync(32)
    expect(requests).toHaveLength(2)

    if (!draftRequest || !analysisRequest) throw new Error('缺少全局效果并行请求')
    completions[requests.indexOf(draftRequest)]?.resolve(result(draftRequest))
    await Promise.resolve()
    expect(requests).toHaveLength(2)
    completions[requests.indexOf(analysisRequest)]?.resolve(result(analysisRequest))
    await Promise.resolve()
    expect(requests).toHaveLength(3)
    const targetRequest = requests.find((request) => request.phase === 'target')
    expect(targetRequest).toMatchObject({
      coverage: 'viewport', viewportKey: 'viewport-1', preferredMip: 2,
    })
    expect(targetRequest?.analysisRequested).not.toBe(true)
    session.dispose()
  })

  it('裁剪提交后立即把旧稳定帧重投影到新几何且不等待新像素', async () => {
    const requests: ImageEditorViewportCompositeRequestV3[] = []
    const completions: Array<ReturnType<typeof deferred<ImageEditorManagedViewportCompositeV3>>> = []
    const setTransform = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      setTransform,
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const client = {
      render: (request: ImageEditorViewportCompositeRequestV3) => {
        requests.push(request)
        const completion = deferred<ImageEditorManagedViewportCompositeV3>()
        completions.push(completion)
        return completion.promise
      },
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const front = document.createElement('canvas')
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'crop-reprojection-test' },
      { client },
    )
    session.attachSurface({ surfaceId: 'surface-c', front, safety: document.createElement('canvas') })
    session.updateViewport(layout)
    const original = createImageEditDocumentV3({ width: 1_600, height: 1_000 })
    session.updateSnapshot({
      document: original, renderGeneration: 1, geometryHash: 'geometry-original',
      quality: 'stable', resourceDescriptors: [],
    })
    const firstTarget = requests.find((request) => request.phase === 'target')
    if (!firstTarget) throw new Error('缺少裁剪前目标请求')
    completions[requests.indexOf(firstTarget)]?.resolve(result(firstTarget))
    await Promise.resolve()
    setTransform.mockClear()

    const cropped = {
      ...original,
      revision: 1,
      geometry: { ...original.geometry, crop: { x: 200, y: 100, width: 800, height: 500 } },
    }
    session.updateSnapshot({
      document: cropped, renderGeneration: 2, geometryHash: 'geometry-cropped',
      quality: 'stable', resourceDescriptors: [],
    })

    expect(front.dataset.renderGeneration).toBe('1')
    expect(front.dataset.geometryHash).toBe('geometry-cropped')
    expect(setTransform).toHaveBeenCalledWith(0.5, 0, 0, 0.5, -100, -50)
    expect(completions).toHaveLength(5)
    expect(requests.filter((request) => request.renderGeneration === 2)).toEqual([
      expect.objectContaining({ phase: 'coarse', coverage: 'viewport' }),
      expect.objectContaining({ phase: 'target', coverage: 'viewport' }),
    ])
    session.dispose()
  })

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
      surfaceId: 'persistent-surface', renderBackend: 'cpu', deviceStatus: 'lost',
      diagnostic: 'adapter reset',
    })
    runtime.listener({
      type: 'runtime', requestId: 'request', sequence: 1, renderGeneration: 1,
      status: 'gpu-ready', reason: null, deviceGeneration: 4,
    })
    expect(latest).toMatchObject({
      surfaceId: 'persistent-surface', renderBackend: 'gpu', deviceStatus: 'ready',
      deviceGeneration: 4,
    })
    expect(front.isConnected).toBe(false)
    unsubscribeDiagnostics()
    session.dispose()
    expect(unsubscribeRuntime).toHaveBeenCalledOnce()
  })
})
