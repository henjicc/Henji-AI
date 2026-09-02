/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import type { ImageEditorManagedPreviewResultV3 } from './imageEditorPreviewClientV3'
import type { ManagedImageEditorPreviewStateV3 } from './useManagedImageEditorPreviewV3'
import type { ImageEditorViewportCompositeStateV3 } from './useImageEditorViewportCompositeV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeClientV3'

const mocked = vi.hoisted(() => ({
  managed: {
    result: null,
    resultDocumentId: null,
    resultRevision: null,
    resultPreviewOverrides: null,
    diagnostic: null,
    rendering: false,
  } as ManagedImageEditorPreviewStateV3,
  viewport: {
    result: null,
    diagnostic: null,
    fallbackRequired: false,
    rendering: false,
    renderGeneration: 1,
    cameraSequence: 1,
    geometryHash: 'geometry-a',
  } as ImageEditorViewportCompositeStateV3,
}))

vi.mock('./useManagedImageEditorPreviewV3', () => ({
  useManagedImageEditorPreviewV3: () => mocked.managed,
}))

vi.mock('./useImageEditorViewportCompositeV3', () => ({
  useImageEditorViewportCompositeV3: () => mocked.viewport,
}))

import { useImageEditorDisplayPipelineV3 } from './useImageEditorDisplayPipelineV3'

const layout = {
  viewportKey: 'viewport-a',
  viewport: {
    documentX: 0,
    documentY: 0,
    width: 800,
    height: 600,
    zoom: 1,
    devicePixelRatio: 2,
  },
}

function viewportResult(revision: number, renderGeneration = 1): ImageEditorManagedViewportCompositeV3 {
  return {
    documentId: 'display-document',
    revision,
    viewportKey: layout.viewportKey,
    renderGeneration,
    cameraSequence: 1,
    geometryHash: 'geometry-a',
  } as ImageEditorManagedViewportCompositeV3
}

function managedResult(): ImageEditorManagedPreviewResultV3 {
  return {
    kind: 'bitmap',
    bitmap: {} as ImageBitmap,
    width: 320,
    height: 180,
    diagnostics: [],
    release: vi.fn(),
  }
}

function snapshot(
  revision: number,
  previewOverrides: ImageEditCommandBusSnapshotV3['previewOverrides'],
): ImageEditCommandBusSnapshotV3 {
  return {
    document: {
      ...createImageEditDocumentV3({
        width: 1_600,
        height: 1_000,
        documentId: 'display-document',
      }),
      revision,
    },
    previewOverrides,
    history: {
      undoCount: revision,
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

describe('useImageEditorDisplayPipelineV3', () => {
  beforeEach(() => {
    mocked.managed.result = null
    mocked.managed.resultDocumentId = null
    mocked.managed.resultRevision = null
    mocked.managed.resultPreviewOverrides = null
    mocked.viewport.renderGeneration = 1
    mocked.viewport.cameraSequence = 1
    mocked.viewport.geometryHash = 'geometry-a'
    mocked.viewport.result = viewportResult(0)
  })

  it('瞬态、提交与稳定帧始终保持同一个视口内核，整图预览永不抢占显示', () => {
    const firstOverride = {
      move: {
        id: 'move',
        kind: 'transform' as const,
        targetId: 'layer-a',
        baseRevision: 0,
        value: [1, 0, 0, 1, 10, 5],
      },
    }
    let currentSnapshot = snapshot(0, firstOverride)
    const rendered = renderHook(() => useImageEditorDisplayPipelineV3(
      'session-a', currentSnapshot, true, [], layout,
    ))

    expect(rendered.result.current.displaySource).toBe('viewport')
    expect(rendered.result.current.viewportResult).toBe(mocked.viewport.result)

    mocked.viewport.renderGeneration = 2
    mocked.managed.result = managedResult()
    mocked.managed.resultDocumentId = currentSnapshot.document.id
    mocked.managed.resultRevision = 0
    mocked.managed.resultPreviewOverrides = firstOverride
    rendered.rerender()
    expect(rendered.result.current.displaySource).toBe('viewport')
    expect(rendered.result.current.viewportResult?.renderGeneration).toBe(1)

    mocked.viewport.result = viewportResult(0, 2)
    rendered.rerender()
    expect(rendered.result.current.viewportResult?.renderGeneration).toBe(2)

    currentSnapshot = snapshot(0, {
      move: { ...firstOverride.move, value: [1, 0, 0, 1, 30, 15] },
    })
    rendered.rerender()
    expect(rendered.result.current.displaySource).toBe('viewport')

    currentSnapshot = snapshot(1, {})
    mocked.viewport.renderGeneration = 3
    rendered.rerender()
    expect(rendered.result.current.displaySource).toBe('viewport')

    mocked.viewport.result = viewportResult(1, 3)
    rendered.rerender()
    expect(rendered.result.current.displaySource).toBe('viewport')
    expect(rendered.result.current.viewportResult?.revision).toBe(1)
  })
})
