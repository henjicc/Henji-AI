/** @vitest-environment jsdom */

import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
} from '@/core/imageEdit/v3/documentFactory'
import i18n from '@/i18n/config'
import { requireImageEditV3LiveSession } from '../application/imageEditLiveSessionRegistry'
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

  it('StrictMode 重挂载也不把旧 managed 整图结果接回交互显示', async () => {
    const release = vi.fn()
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
      measureText: vi.fn(() => ({ width: 64 })),
    } as unknown as CanvasRenderingContext2D)
    managedPreview.state = {
      result: {
        kind: 'bitmap',
        bitmap: {} as ImageBitmap,
        width: 320,
        height: 180,
        diagnostics: [],
        release,
      },
      resultDocumentId: 'managed-frame-document',
      resultRevision: 0,
      resultPreviewOverrides: {},
      diagnostic: null,
      rendering: true,
    }
    const first = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: 'managed-frame-document',
    })
    const onDocumentChange = vi.fn()
    const rendered = render(
      <StrictMode>
        <div style={{ width: 900, height: 600 }}>
          <ImageEditorV3
            sourceImageUrl="preview.png"
            document={first}
            profileId="full"
            onDocumentChange={onDocumentChange}
          />
        </div>
      </StrictMode>,
    )

    await waitFor(() => expect(
      rendered.container.querySelector('[data-presentation-front-surface]'),
    ).toBeTruthy())
    expect(drawImage).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()

    rendered.rerender(
      <StrictMode>
        <div style={{ width: 900, height: 600 }}>
          <ImageEditorV3
            sourceImageUrl="preview.png"
            document={{ ...first, revision: 1 }}
            profileId="full"
            onDocumentChange={onDocumentChange}
          />
        </div>
      </StrictMode>,
    )
    await waitFor(() => expect(
      rendered.container.querySelector('[data-presentation-front-surface]'),
    ).toBeTruthy())
    expect(drawImage).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it('空格临时抓手只移动工作区，缩放单击适应窗口且横向拖动连续缩放', async () => {
    const document = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: 'viewport-navigation-document',
    })
    const rendered = render(
      <div style={{ width: 1_000, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={document}
          profileId="full"
          previewRenderer={() => ({
            kind: 'content',
            content: <div style={{ width: 320, height: 180 }} />,
          })}
          onDocumentChange={() => undefined}
        />
      </div>,
    )
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const content = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    if (!surface || !content) throw new Error('视口测试节点不存在')
    Object.defineProperties(surface, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          x: 0, y: 0, left: 0, top: 0, right: 1_000, bottom: 600,
          width: 1_000, height: 600, toJSON: () => undefined,
        }),
      },
    })

    const sessionId = Object.keys(useImageEditorSessionStoreV3.getState().sessions)[0]
    expect(useImageEditorSessionStoreV3.getState().sessions[sessionId].activeTool).toBe('move')
    screen.getByRole('button', { name: '移动图像或图层' }).focus()
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(surface.dataset.temporaryHand).toBe('active')
    expect(surface.dataset.activeNavigationTool).toBe('hand')
    fireEvent.pointerDown(surface, {
      pointerId: 7, isPrimary: true, button: 0, clientX: 100, clientY: 100,
    })
    fireEvent.pointerMove(surface, { pointerId: 7, clientX: 140, clientY: 120 })
    expect(content.style.transform).toContain('translate3d(40px, 20px, 0)')
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession[sessionId]).toBeUndefined()

    fireEvent.pointerUp(surface, { pointerId: 7, clientX: 140, clientY: 120 })
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession[sessionId]).toEqual({
      x: 40,
      y: 20,
    })
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(surface.dataset.temporaryHand).toBeUndefined()
    expect(useImageEditorSessionStoreV3.getState().sessions[sessionId].activeTool).toBe('move')

    const zoomIn = rendered.container.querySelector<HTMLButtonElement>(
      '[data-viewport-control] button:last-of-type',
    )
    if (!zoomIn) throw new Error('视口测试缺少底部放大按钮')
    fireEvent.click(zoomIn)
    fireEvent.click(screen.getByRole('button', { name: '缩放画布' }))
    fireEvent.pointerDown(surface, {
      pointerId: 8, isPrimary: true, button: 0, clientX: 600, clientY: 300,
    })
    fireEvent.pointerUp(surface, { pointerId: 8, clientX: 600, clientY: 300 })
    expect(useImageEditorInteractionStoreV3.getState().viewportZoomBySession[sessionId]).toBe(1)
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession[sessionId]).toEqual({ x: 0, y: 0 })

    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 600,
      clientY: 300,
      deltaY: -1,
    })
    fireEvent(surface, wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(useImageEditorInteractionStoreV3.getState().viewportZoomBySession[sessionId]).toBe(1.15)

    fireEvent.pointerDown(surface, {
      pointerId: 9, isPrimary: true, button: 0, clientX: 500, clientY: 300,
    })
    fireEvent.pointerMove(surface, { pointerId: 9, clientX: 680, clientY: 300 })
    expect(content.style.transform).toContain('scale(2.3)')
    expect(useImageEditorInteractionStoreV3.getState().viewportZoomBySession[sessionId]).toBe(1.15)
    fireEvent.pointerUp(surface, { pointerId: 9, clientX: 680, clientY: 300 })
    expect(useImageEditorInteractionStoreV3.getState().viewportZoomBySession[sessionId]).toBe(2.3)

    fireEvent.pointerDown(surface, {
      pointerId: 10, isPrimary: true, button: 0, clientX: 500, clientY: 300, altKey: true,
    })
    fireEvent.pointerUp(surface, {
      pointerId: 10, clientX: 500, clientY: 300, altKey: true,
    })
    expect(useImageEditorInteractionStoreV3.getState().viewportZoomBySession[sessionId]).toBe(1)
    expect(document.revision).toBe(0)
  })

  it('放大后的单底图移动仍按屏幕像素跟手且松手仅提交一个 revision', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600,
      width: 900, height: 600, toJSON: () => undefined,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      measureText: vi.fn(() => ({ width: 64 })),
    } as unknown as CanvasRenderingContext2D)
    managedPreview.state = {
      result: {
        kind: 'bitmap',
        bitmap: {} as ImageBitmap,
        width: 320,
        height: 180,
        diagnostics: [],
        release: vi.fn(),
      },
      resultDocumentId: 'move-feedback-document',
      resultRevision: 0,
      resultPreviewOverrides: {},
      diagnostic: null,
      rendering: false,
    }
    const document = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: 'move-feedback-document',
      sourceResourceId: 'sha256:source',
    })
    const changes = vi.fn()
    const rendered = render(
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.jpg"
          document={document}
          profileId="full"
          onDocumentChange={changes}
        />
      </div>,
    )
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const content = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    const feedback = rendered.container.querySelector<HTMLElement>('[data-move-feedback-frame]')
    if (!surface || !content || !feedback) throw new Error('移动反馈测试节点不存在')
    const rasterImage = feedback.querySelector('img')
    if (!rasterImage) throw new Error('移动反馈缺少完整源图')
    fireEvent.load(rasterImage)
    await waitFor(() => expect(feedback.dataset.rasterSourceReady).toBe('true'))
    const readViewportRect = vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360,
      width: 640, height: 360, toJSON: () => undefined,
    })

    await waitFor(() => expect(
      Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]?.selectedLayerIds,
    ).toEqual([document.layers[0].id]))
    const zoomIn = rendered.container.querySelector<HTMLButtonElement>('[data-viewport-control] button:last-of-type')
    if (!zoomIn) throw new Error('移动反馈测试缺少放大按钮')
    fireEvent.click(zoomIn)
    fireEvent.click(zoomIn)
    const liveSession = requireImageEditV3LiveSession(document.id)
    const verticalSnapGuide = rendered.container.querySelector<HTMLElement>(
      '[data-snap-guide-axis="x"]',
    )
    const horizontalSnapGuide = rendered.container.querySelector<HTMLElement>(
      '[data-snap-guide-axis="y"]',
    )
    if (!verticalSnapGuide || !horizontalSnapGuide) throw new Error('移动吸附参考线不存在')

    fireEvent.pointerDown(surface, {
      pointerId: 40, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 40, clientX: 16, clientY: 10 })
    expect(feedback.style.transform).toBe('')
    expect(verticalSnapGuide.style.visibility).toBe('visible')
    expect(horizontalSnapGuide.style.visibility).toBe('visible')
    fireEvent.pointerUp(surface, { pointerId: 40, clientX: 16, clientY: 10 })
    expect(verticalSnapGuide.style.visibility).toBe('hidden')
    expect(horizontalSnapGuide.style.visibility).toBe('hidden')
    expect(changes).not.toHaveBeenCalled()

    const snappingSwitch = screen.getByRole('switch', { name: '吸附' })
    fireEvent.click(snappingSwitch)
    fireEvent.pointerDown(surface, {
      pointerId: 39, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 39, clientX: 16, clientY: 10 })
    expect(feedback.style.transform).toBe('translate3d(6px, 0px, 0)')
    expect(verticalSnapGuide.style.visibility).toBe('hidden')
    expect(horizontalSnapGuide.style.visibility).toBe('hidden')
    fireEvent.pointerCancel(surface, { pointerId: 39 })
    fireEvent.click(snappingSwitch)

    readViewportRect.mockClear()
    fireEvent.pointerDown(surface, {
      pointerId: 41, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 41, clientX: 35, clientY: 20, ctrlKey: true })
    fireEvent.pointerMove(surface, { pointerId: 41, clientX: 45, clientY: 30, ctrlKey: true })
    expect(readViewportRect).toHaveBeenCalledTimes(1)
    expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
    expect(feedback.style.transform).toBe('translate3d(35px, 20px, 0)')

    fireEvent.pointerMove(surface, { pointerId: 41, clientX: 35, clientY: 20, ctrlKey: true })
    expect(feedback.style.transform).toBe('translate3d(25px, 10px, 0)')
    expect(changes).not.toHaveBeenCalled()

    fireEvent.pointerCancel(surface, { pointerId: 41 })
    expect(feedback.style.transform).toBe('')
    expect(changes).not.toHaveBeenCalled()
    expect(document.revision).toBe(0)

    readViewportRect.mockClear()
    fireEvent.pointerDown(surface, {
      pointerId: 42, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 42, clientX: 35, clientY: 20, ctrlKey: true })
    fireEvent.pointerUp(surface, { pointerId: 42, clientX: 35, clientY: 20 })

    await waitFor(() => expect(changes).toHaveBeenCalledTimes(1))
    expect(readViewportRect).toHaveBeenCalledTimes(1)
    expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
    expect(liveSession.bus.getSnapshot().document.revision).toBe(1)
    expect(liveSession.bus.getSnapshot().document.layers[0].transform).toEqual([
      1, 0, 0, 1, 12.5, 5,
    ])
    // 完整源图同步读取新 transform，提交后无需等待合成器补帧。
    expect(feedback.style.transform).toBe('')
    expect(rasterImage.style.transform).toBe('matrix(1, 0, 0, 1, 19.53125, 7.8125)')

    fireEvent.pointerDown(surface, {
      pointerId: 43, isPrimary: true, button: 0, clientX: 35, clientY: 20,
    })
    fireEvent.pointerMove(surface, { pointerId: 43, clientX: -15, clientY: 20, ctrlKey: true })
    expect(feedback.style.transform).toBe('translate3d(-50px, 0px, 0)')
    expect(rasterImage.style.transform).toBe('matrix(1, 0, 0, 1, 19.53125, 7.8125)')
    fireEvent.pointerCancel(surface, { pointerId: 43 })
    expect(feedback.style.transform).toBe('')
  })

})
