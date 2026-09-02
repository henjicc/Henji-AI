/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'
import type { ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'
import { DefaultImageEditorRenderSessionV3 } from './imageEditorRenderSessionV3'

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
    mip: request.coverage === 'document' ? 8 : 0,
    documentWidth: request.document.geometry.width,
    documentHeight: request.document.geometry.height,
    diagnostics: [],
    tiles: [],
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

  it('先建立当前 generation 的完整粗 mip，再调度目标 mip', async () => {
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
    session.attachSurface({
      surfaceId: 'surface-a',
      front: document.createElement('canvas'),
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

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ coverage: 'document', preferredMip: 30, quality: 'draft' })
    completions[0]?.resolve(result(requests[0]))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(16)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ coverage: 'viewport', viewportKey: 'viewport-1' })
    session.dispose()
  })

  it('新 generation 粗略覆盖完成前保留旧帧，完成后才原子晋升', async () => {
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
    const releaseFirst = vi.fn()
    completions[0]?.resolve(result(requests[0], releaseFirst))
    await Promise.resolve()
    expect(front.dataset.renderGeneration).toBe('1')

    session.updateSnapshot({
      document: { ...documentV3, revision: 1 }, renderGeneration: 2, geometryHash: 'geometry-a',
      quality: 'draft', resourceDescriptors: [],
    })
    expect(front.dataset.renderGeneration).toBe('1')
    expect(releaseFirst).not.toHaveBeenCalled()
    completions[1]?.resolve(result(requests[1]))
    await Promise.resolve()
    expect(front.dataset.renderGeneration).toBe('2')
    expect(releaseFirst).toHaveBeenCalledOnce()
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
    completions[0]?.resolve(result(requests[0]))
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
    expect(completions).toHaveLength(2)
    session.dispose()
  })
})
