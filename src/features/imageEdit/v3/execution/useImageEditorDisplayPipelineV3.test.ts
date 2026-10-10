/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import type { ImageEditorManagedPreviewResultV3 } from './imageEditorPreviewClientV3'
import type { ManagedImageEditorPreviewStateV3 } from './useManagedImageEditorPreviewV3'
import type { ImageEditorViewportCompositeStateV3 } from './useImageEditorViewportCompositeV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

const mocked = vi.hoisted(() => ({
  descriptors: vi.fn(),
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
  useImageEditorViewportCompositeV3: (...args: unknown[]) => { mocked.descriptors(args[3]); return mocked.viewport },
}))

import { useImageEditorDisplayPipelineV3 } from './useImageEditorDisplayPipelineV3'

const layout = {
  stageWidth: 800,
  stageHeight: 600,
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
    selection: null, selectionRevision: 0,
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
    },
  }
}

describe('useImageEditorDisplayPipelineV3', () => {
  it('暂存补丁从权威预览元数据进入同一 GPU 资源描述，取消立即移除而不污染作品', () => {
    const resourceId = `sha256:${'f'.repeat(64)}`, bytes = 256, first = snapshot(0, {})
    first.document.layers = [createImageEditRasterLayerV3('layer', '像素')]
    let current = { ...first, previewOverrides: { fill: { id: 'fill', kind: 'brush' as const, targetId: 'layer', baseRevision: 0, value: { tiles: { '0/0/0': resourceId } }, resourceByteSizes: { [resourceId]: bytes } } } } as ImageEditCommandBusSnapshotV3
    const rendered = renderHook(() => useImageEditorDisplayPipelineV3('session', current, true, [], layout))
    expect(mocked.descriptors).toHaveBeenLastCalledWith([{ resourceRef: resourceId, byteLength: bytes, mediaType: 'application/x-henji-brush-tile-v3' }])
    expect(first.document.layers[0]).toMatchObject({ tiles: {} }); expect(first.document.revision).toBe(0)
    current = first; rendered.rerender(); expect(mocked.descriptors).toHaveBeenLastCalledWith([])
  })
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
