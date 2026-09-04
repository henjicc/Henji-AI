/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
} from '@/core/imageEdit/v3/documentFactory'
import i18n from '@/i18n/config'
import type { ImageEditorManagedPreviewResultV3 } from '../execution/imageEditorPreviewClientV3'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'

interface ManagedPreviewTestStateV3 {
  result: ImageEditorManagedPreviewResultV3 | null
  resultDocumentId: string | null
  resultRevision: number | null
  resultPreviewOverrides: Readonly<Record<string, unknown>> | null
  diagnostic: string | null
  rendering: boolean
}

const managedPreview = vi.hoisted(() => ({
  state: {
    result: null,
    resultDocumentId: null,
    resultRevision: null,
    resultPreviewOverrides: null,
    diagnostic: null,
    rendering: false,
  } as ManagedPreviewTestStateV3,
}))
const renderSession = vi.hoisted(() => ({
  attachSurface: vi.fn(() => vi.fn()),
  updateSnapshot: vi.fn(),
  updateViewport: vi.fn(),
  updateTransientLayerTransform: vi.fn(),
  clearTransientLayerTransform: vi.fn(),
  requestFrame: vi.fn(),
  subscribeDiagnostics: vi.fn(() => vi.fn()),
  setVisibility: vi.fn(),
  dispose: vi.fn(),
}))
const viewportBackend = vi.hoisted(() => ({
  composition: 'cpu' as 'cpu' | 'gpu',
  presentation: 'canvas2d' as 'canvas2d' | 'webgpu-surface' | 'gpu-image-bitmap',
}))
const rasterPasteboardResources = vi.hoisted(() => ({
  readFastProxy: vi.fn(),
  readSourceMetadata: vi.fn(),
}))

vi.mock('@/commands/imageEditorV3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/commands/imageEditorV3')>()
  return {
    ...original,
    readImageEditorV3FastProxy: rasterPasteboardResources.readFastProxy,
    readImageEditorV3SourceMetadata: rasterPasteboardResources.readSourceMetadata,
  }
})

vi.mock('../execution', async (importOriginal) => {
  const original = await importOriginal<typeof import('../execution')>()
  return {
    ...original,
    useImageEditorDisplayPipelineV3: () => ({
      hasPreviewOverrides: false,
      displaySource: 'managed',
      managedPreview: managedPreview.state,
      viewportComposite: {
        result: null,
        diagnostic: null,
        fallbackRequired: true,
        rendering: false,
        renderGeneration: 1,
        cameraSequence: 1,
        geometryHash: 'test-geometry',
        coverage: 0,
        targetMipCoverage: 0,
        targetMip: null,
        eventToPresentMs: null,
        surfaceId: null,
        compositionBackend: viewportBackend.composition,
        effectBackend: 'cpu',
        presentationBackend: viewportBackend.presentation,
        deviceStatus: 'idle',
        deviceGeneration: 0,
        session: renderSession,
      },
      viewportResult: null,
    }),
  }
})

import { ImageEditorV3 } from './ImageEditorV3'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('ImageEditorPreviewV3 managed frame ownership', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    useImageEditorSessionStoreV3.setState({ sessions: {} })
    useImageEditorInteractionStoreV3.setState({
      layerDragBySession: {},
      viewportZoomBySession: {},
      viewportPanBySession: {},
      annotationSelectionBySession: {},
      annotationPreviewBySession: {},
    })
    managedPreview.state = {
      result: null,
      resultDocumentId: null,
      resultRevision: null,
      resultPreviewOverrides: null,
      diagnostic: null,
      rendering: false,
    }
    viewportBackend.composition = 'cpu'
    viewportBackend.presentation = 'canvas2d'
    vi.clearAllMocks()
    rasterPasteboardResources.readFastProxy.mockReset()
    rasterPasteboardResources.readSourceMetadata.mockReset()
    rasterPasteboardResources.readFastProxy.mockImplementation(async (
      request: { resourceRef: `sha256:${string}` },
    ) => ({
      resourceRef: request.resourceRef,
      width: 320,
      height: 180,
      mediaType: 'image/webp',
      bytes: new Uint8Array([1, 2, 3]).buffer,
    }))
    rasterPasteboardResources.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: `sha256:${string}` },
    ) => ({
      resourceRef: request.resourceRef,
      width: 320,
      height: 180,
      encodedWidth: 320,
      encodedHeight: 180,
      format: 'png',
      channels: 4,
      depth: 'uchar',
      bitsPerSample: 8,
      colorSpace: 'srgb',
      orientation: 1,
      orientationApplied: true,
      density: null,
      pages: 1,
      hasAlpha: true,
      hasIccProfile: false,
      iccProfileResourceRef: null,
      cicp: null,
      hdr: false,
    }))
    let objectUrlSequence = 0
    const NativeUrl = URL
    class RasterPasteboardUrl extends NativeUrl {}
    Object.assign(RasterPasteboardUrl, {
      createObjectURL: vi.fn(() => `blob:raster-pasteboard-${objectUrlSequence += 1}`),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('URL', RasterPasteboardUrl)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    'webgpu-surface',
    'gpu-image-bitmap',
  ] as const)('GPU %s 稳定帧接管后隐藏单层 DOM 回退且不闪黑', async (presentation) => {
    viewportBackend.composition = 'gpu'
    viewportBackend.presentation = presentation
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600,
      width: 900, height: 600, toJSON: () => undefined,
    })
    const document = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: `gpu-${presentation}-handoff-document`,
      sourceResourceId: 'sha256:source',
    })
    managedPreview.state = {
      result: {
        kind: 'url',
        url: `blob:${presentation}-stable-frame`,
        width: 320,
        height: 180,
        diagnostics: [],
        release: vi.fn(),
      },
      resultDocumentId: document.id,
      resultRevision: document.revision,
      resultPreviewOverrides: {},
      diagnostic: null,
      rendering: false,
    }
    const rendered = render(
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.jpg"
          document={document}
          profileId="full"
          onDocumentChange={() => undefined}
        />
      </div>,
    )

    const image = await waitFor(() => {
      const candidate = rendered.container.querySelector<HTMLImageElement>(
        '[data-raster-pasteboard-layer] img',
      )
      if (!candidate) throw new Error('单层 DOM 回退尚未挂载')
      return candidate
    })
    fireEvent.load(image)
    const stableDisplay = rendered.container.querySelector<HTMLElement>(
      '[data-raster-display-frame]',
    )
    const pasteboard = rendered.container.querySelector<HTMLElement>(
      '[data-raster-pasteboard-stack]',
    )
    if (!stableDisplay || !pasteboard) throw new Error('栅格展示表面不存在')
    await waitFor(() => expect(pasteboard.dataset.rasterSourceReady).toBe('true'))
    expect(stableDisplay.style.visibility).toBe('visible')
    expect(pasteboard.style.visibility).toBe('hidden')
    expect(pasteboard.dataset.rasterPasteboardStack).toBe('multi')
  })

  it('GPU 失败回到 Canvas2D 时只显示已就绪 DOM 回退并保持稳定帧兜底', async () => {
    viewportBackend.composition = 'cpu'
    viewportBackend.presentation = 'canvas2d'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600,
      width: 900, height: 600, toJSON: () => undefined,
    })
    const document = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: 'gpu-failed-dom-fallback-document',
      sourceResourceId: 'sha256:source',
    })
    managedPreview.state = {
      result: {
        kind: 'url',
        url: 'blob:canvas2d-stable-frame',
        width: 320,
        height: 180,
        diagnostics: [],
        release: vi.fn(),
      },
      resultDocumentId: document.id,
      resultRevision: document.revision,
      resultPreviewOverrides: {},
      diagnostic: null,
      rendering: false,
    }
    const rendered = render(
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.jpg"
          document={document}
          profileId="full"
          onDocumentChange={() => undefined}
        />
      </div>,
    )

    const stableDisplay = rendered.container.querySelector<HTMLElement>(
      '[data-raster-display-frame]',
    )
    const pasteboard = rendered.container.querySelector<HTMLElement>(
      '[data-raster-pasteboard-stack]',
    )
    const image = pasteboard?.querySelector('img')
    if (!stableDisplay || !pasteboard || !image) throw new Error('CPU 回退表面不存在')
    expect(stableDisplay.style.visibility).toBe('visible')
    expect(pasteboard.style.visibility).toBe('hidden')
    fireEvent.load(image)
    await waitFor(() => expect(pasteboard.style.visibility).toBe('visible'))
    expect(stableDisplay.style.visibility).toBe('hidden')
    expect(pasteboard.dataset.rasterPasteboardStack).toBe('single')
  })
})
