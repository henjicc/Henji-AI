/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
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
    render(request: unknown): Promise<never> {
      mocked.requests.push(request)
      return new Promise<never>(() => undefined)
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
      maxCommands: 200,
      maxBytes: 2 * 1024 * 1024 * 1024,
    },
  }
}

function layout(index: number): {
  viewport: ImageEditorViewportTransformV3
  viewportKey: string
} {
  return {
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
    vi.stubGlobal('Worker', class {})
    mocked.requests.length = 0
    mocked.cancel.mockClear()
    mocked.dispose.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('连续缩放只提交静止后的最新视口，不为每个滚轮事件创建任务', async () => {
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
    await act(async () => { await Promise.resolve() })
    expect(mocked.requests).toHaveLength(1)

    for (let index = 1; index <= 40; index += 1) {
      rendered.rerender({ currentLayout: layout(index) })
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    }
    expect(mocked.requests).toHaveLength(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(69) })
    expect(mocked.requests).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(mocked.requests).toHaveLength(2)
    expect(mocked.requests[1]).toMatchObject({ viewportKey: 'viewport-40' })

    rendered.unmount()
    await act(async () => { await Promise.resolve() })
  })
})
