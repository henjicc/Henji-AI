/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import type { ImageEditorViewportTransformV3 } from './viewportTilePlannerV3'

const EMPTY_RESOURCE_DESCRIPTORS: readonly [] = []

const mocked = vi.hoisted(() => ({
  requests: [] as unknown[],
  cancel: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('./viewportCompositeClientV3', () => {
  class MockViewportCompositeClientV3 {
    render(request: {
      document: { id: string; revision: number; geometry: { width: number; height: number } }
      renderGeneration: number
      cameraSequence: number
      geometryHash: string
      viewportKey: string
      coverage?: 'viewport' | 'document'
    }): Promise<unknown> {
      mocked.requests.push(request)
      return Promise.resolve({
        documentId: request.document.id,
        revision: request.document.revision,
        renderGeneration: request.renderGeneration,
        cameraSequence: request.cameraSequence,
        geometryHash: request.geometryHash,
        viewportKey: request.viewportKey,
        coverage: request.coverage ?? 'viewport',
        mip: request.coverage === 'document' ? 8 : 0,
        documentWidth: request.document.geometry.width,
        documentHeight: request.document.geometry.height,
        diagnostics: [],
        tiles: [],
        release: vi.fn(),
      })
    }

    cancel(): void {
      mocked.cancel()
    }

    dispose(): void {
      mocked.dispose()
    }
  }

  return {
    ImageEditorViewportCompositeClientV3: MockViewportCompositeClientV3,
    ImageEditorViewportCompositeDisposedErrorV3: class extends Error {},
    ImageEditorViewportCompositeSupersededErrorV3: class extends Error {},
  }
})

import { useImageEditorViewportCompositeV3 } from './useImageEditorViewportCompositeV3'

function snapshot(): ImageEditCommandBusSnapshotV3 {
  return {
    selection: null, selectionRevision: 0,
    document: createImageEditDocumentV3({
      width: 1_600,
      height: 1_000,
      documentId: 'viewport-settle-document',
    }),
    previewOverrides: {},
    history: {
      undoCount: 0,
      redoCount: 0,
      retainedBytes: 0,
      retainedResourceCount: 0,
      retainedResourceBytes: 0,
      unknownResourceCount: 0,
    },
  }
}

function layout(index: number): {
  viewport: ImageEditorViewportTransformV3
  viewportKey: string
  stageWidth: number
  stageHeight: number
} {
  return {
    stageWidth: 1_600,
    stageHeight: 1_000,
    viewport: {
      documentX: index,
      documentY: index,
      width: 1_000,
      height: 600,
      zoom: 1 + index / 100,
      devicePixelRatio: 2,
    },
    viewportKey: `viewport-${index}`,
  }
}

describe('useImageEditorViewportCompositeV3', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage(): void {}
      terminate(): void {}
    })
    mocked.requests.length = 0
    mocked.cancel.mockClear()
    mocked.dispose.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([['stable', true], [undefined, false]] as const)('完成候选质量 %s 决定是否请求清晰目标，连续拖动保持草稿', async (quality, target) => {
    const current = snapshot()
    current.document.layers = [createImageEditRasterLayerV3('preview', '预览图层')]
    current.previewOverrides = { candidate: { id: 'candidate', kind: 'transform', targetId: 'preview', baseRevision: current.document.revision, value: [1, 0, 0, 1, 10, 20], quality } }
    const rendered = renderHook(() => useImageEditorViewportCompositeV3('candidate-quality', current, true, EMPTY_RESOURCE_DESCRIPTORS, layout(0)))
    await act(async () => { await vi.advanceTimersByTimeAsync(32) })
    expect(mocked.requests.some(request => (request as { phase?: string }).phase === 'target')).toBe(target)
    expect(current.document.layers[0].transform).toEqual([1, 0, 0, 1, 0, 0])
    rendered.unmount()
  })

  it('同一动画帧内的连续相机变化只提交最新视口，不再等待 80ms', async () => {
    const stableSnapshot = snapshot()
    const rendered = renderHook(
      ({ currentLayout }) => useImageEditorViewportCompositeV3(
        'viewport-settle-session',
        stableSnapshot,
        true,
        EMPTY_RESOURCE_DESCRIPTORS,
        currentLayout,
      ),
      { initialProps: { currentLayout: layout(0) } },
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(16) })
    expect(mocked.requests).toHaveLength(3)
    expect(mocked.requests.slice(0, 2)).toEqual([
      expect.objectContaining({ coverage: 'viewport', phase: 'coarse' }),
      expect.objectContaining({ coverage: 'viewport', phase: 'target' }),
    ])
    expect(mocked.requests[2]).toMatchObject({
      coverage: 'document', phase: 'coarse', preferredMip: 1,
    })

    for (let index = 1; index <= 40; index += 1) {
      rendered.rerender({ currentLayout: layout(index) })
    }
    expect(mocked.requests).toHaveLength(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(16) })
    expect(mocked.requests).toHaveLength(5)
    expect(mocked.requests.slice(3)).toEqual([
      expect.objectContaining({
        coverage: 'viewport', phase: 'coarse', viewportKey: 'viewport-40',
      }),
      expect.objectContaining({
        coverage: 'viewport', phase: 'target', viewportKey: 'viewport-40',
      }),
    ])

    rendered.unmount()
    await act(async () => { await Promise.resolve() })
  })

  it('受管资源描述刷新会推进renderGeneration，隔离旧画笔瓦片请求', async () => {
    const stableSnapshot = snapshot()
    const source = `sha256:${'1'.repeat(64)}` as const
    const brush = `sha256:${'2'.repeat(64)}` as const
    const initial: readonly ImageEditorV3ResourceDescriptor[] = [{
      resourceRef: source, byteLength: 128, mediaType: 'image/png',
    }]
    const refreshed: readonly ImageEditorV3ResourceDescriptor[] = [
      ...initial,
      { resourceRef: brush, byteLength: 256, mediaType: 'application/x-henji-brush-tile-v3' },
    ]
    const rendered = renderHook(
      ({ descriptors }) => useImageEditorViewportCompositeV3(
        'descriptor-generation-session', stableSnapshot, true, descriptors, layout(0),
      ),
      { initialProps: { descriptors: initial } },
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(16) })
    expect(mocked.requests.at(-1)).toMatchObject({ renderGeneration: 1 })

    rendered.rerender({ descriptors: initial.map((descriptor) => ({ ...descriptor })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(16) })
    expect(mocked.requests.at(-1)).toMatchObject({ renderGeneration: 1 })

    rendered.rerender({ descriptors: refreshed })
    await act(async () => { await vi.advanceTimersByTimeAsync(16) })
    expect(mocked.requests.at(-1)).toMatchObject({ renderGeneration: 2 })

    rendered.unmount()
    await act(async () => { await Promise.resolve() })
  })
})
