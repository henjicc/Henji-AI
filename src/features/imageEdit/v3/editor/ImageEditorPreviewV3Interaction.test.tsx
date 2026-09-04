/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
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
  it('完整源图层始终位于文档裁切层内，越界部分只显示透明底', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1_000, bottom: 600,
      width: 1_000, height: 600, toJSON: () => undefined,
    })
    const document = createImageEditDocumentV3({
      width: 1_600,
      height: 1_000,
      documentId: 'pasteboard-document',
      sourceResourceId: 'sha256:source',
    })
    document.layers[0].transform = [1, 0, 0, 1, 100, -240]
    const rendered = render(
      <div style={{ width: 1_000, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.jpg"
          document={document}
          profileId="full"
          onDocumentChange={() => undefined}
        />
      </div>,
    )
    const rasterFrame = await waitFor(() => {
      const element = rendered.container.querySelector('[data-raster-display-frame]')
      if (!element) throw new Error('文档内栅格显示框尚未挂载')
      return element
    })
    const rasterSource = rendered.container.querySelector<HTMLElement>('[data-raster-pasteboard-layer]')
    const rasterImage = rasterSource?.querySelector('img')
    if (!rasterSource || !rasterImage) throw new Error('完整源图层尚未挂载')
    fireEvent.load(rasterImage)
    await waitFor(() => expect(rasterSource.dataset.rasterSourceReady).toBe('true'))
    expect(rasterFrame.className).toContain('overflow-hidden')
    expect(rasterFrame.className).toContain('invisible')
    const documentClip = rendered.container.querySelector<HTMLElement>('[data-document-clip]')
    const transparencyGrid = rendered.container.querySelector<HTMLElement>(
      '[data-document-transparency-grid]',
    )
    expect(documentClip?.contains(rasterFrame)).toBe(true)
    expect(documentClip?.contains(rasterSource)).toBe(true)
    expect(documentClip?.style.clipPath).toContain('polygon(')
    expect(transparencyGrid?.className).toContain('image-editor-transparency-grid')
    expect(rendered.container.querySelector('[data-document-boundary]')).toBeNull()
  })
  it('普通多栅格拖动只移动目标叶子且连续 pointermove 不发布草稿', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 180,
      width: 320, height: 180, toJSON: () => undefined,
    })
    const resourceA = `sha256:${'a'.repeat(64)}` as const
    const resourceB = `sha256:${'b'.repeat(64)}` as const
    const resourceC = `sha256:${'c'.repeat(64)}` as const
    const document = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: 'direct-multi-raster-move-document',
      sourceResourceId: resourceA,
    })
    document.layers.push(
      createImageEditRasterLayerV3('foreground-layer', '前景', resourceB),
      createImageEditRasterLayerV3('top-layer', '顶层', resourceC),
    )
    let latestDocument = document
    const changes = vi.fn((nextDocument: typeof document) => { latestDocument = nextDocument })
    managedPreview.state = {
      result: {
        kind: 'url',
        url: 'blob:stable-multi-raster-revision-0',
        width: 320,
        height: 180,
        diagnostics: [],
        release: vi.fn(),
      },
      resultDocumentId: document.id,
      resultRevision: 0,
      resultPreviewOverrides: {},
      diagnostic: null,
      rendering: false,
    }
    const editor = () => (
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="composite-preview.jpg"
          document={latestDocument}
          resourceDescriptors={[resourceA, resourceB, resourceC].map((resourceRef) => ({
            resourceRef,
            byteLength: 4_096,
            mediaType: 'image/png',
          }))}
          profileId="full"
          initialSelectedLayerId={document.layers[1].id}
          onDocumentChange={changes}
        />
      </div>
    )
    const rendered = render(editor())
    await waitFor(() => expect(rasterPasteboardResources.readFastProxy).toHaveBeenCalledTimes(3))
    const stack = await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>(
        '[data-raster-pasteboard-stack="multi"]',
      )
      if (!element || element.querySelectorAll('[data-raster-pasteboard-layer]').length !== 3) {
        throw new Error('多栅格反馈栈尚未准备完成')
      }
      return element
    })
    const layerFrames = [...stack.querySelectorAll<HTMLElement>('[data-raster-pasteboard-layer]')]
    expect(layerFrames.map(({ dataset }) => dataset.rasterPasteboardLayer)).toEqual(
      document.layers.map(({ id }) => id),
    )
    for (const image of stack.querySelectorAll('img')) fireEvent.load(image)
    await waitFor(() => expect(stack.dataset.rasterSourceReady).toBe('true'))
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const content = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    const stableDisplay = rendered.container.querySelector<HTMLElement>('[data-raster-display-frame]')
    if (!surface || !content || !stableDisplay) throw new Error('多栅格移动测试节点不存在')
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 180,
      width: 320, height: 180, toJSON: () => undefined,
    })
    await waitFor(() => expect(
      Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]?.selectedLayerIds,
    ).toEqual([document.layers[1].id]))
    const liveSession = requireImageEditV3LiveSession(document.id)
    const targetFeedback = layerFrames[1]
    const untouchedFeedback = [layerFrames[0], layerFrames[2]]
    fireEvent.pointerDown(surface, {
      pointerId: 50, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    expect(stack.style.visibility).toBe('visible')
    expect(stableDisplay.style.visibility).toBe('hidden')
    for (let index = 1; index <= 100; index += 1) {
      fireEvent.pointerMove(surface, {
        pointerId: 50,
        clientX: 10 + index,
        clientY: 10 + Math.floor(index / 2),
        ctrlKey: true,
      })
      expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
      expect(liveSession.bus.getSnapshot().document.revision).toBe(0)
    }
    expect(targetFeedback.style.transform).toBe('translate3d(100px, 50px, 0)')
    expect(untouchedFeedback.every(({ style }) => style.transform === '')).toBe(true)
    expect(changes).not.toHaveBeenCalled()
    fireEvent.pointerCancel(surface, { pointerId: 50 })
    expect(targetFeedback.style.transform).toBe('')
    expect(stack.style.visibility).toBe('hidden')
    expect(stableDisplay.style.visibility).toBe('visible')
    expect(liveSession.bus.getSnapshot().document.revision).toBe(0)
    fireEvent.pointerDown(surface, {
      pointerId: 52, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, {
      pointerId: 52, clientX: 110, clientY: 60, ctrlKey: true,
    })
    fireEvent.pointerUp(surface, { pointerId: 52, clientX: 110, clientY: 60 })
    await waitFor(() => expect(changes).toHaveBeenCalledTimes(1))
    expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
    expect(liveSession.bus.getSnapshot().document.revision).toBe(1)
    expect(liveSession.bus.getSnapshot().document.layers[1].transform).toEqual([
      1, 0, 0, 1, 100, 50,
    ])
    expect(targetFeedback.style.transform).toBe('')
    expect(targetFeedback.querySelector('img')?.style.transform).toBe(
      'matrix(0.733333, 0, 0, 0.733333, 73.333333, 36.666667)',
    )
    expect(stack.style.visibility).toBe('visible')
    expect(stableDisplay.style.visibility).toBe('hidden')
    expect(rasterPasteboardResources.readFastProxy).toHaveBeenCalledTimes(3)
    managedPreview.state = {
      result: {
        kind: 'bitmap',
        bitmap: {} as ImageBitmap,
        width: 320,
        height: 180,
        diagnostics: [],
        release: vi.fn(),
      },
      resultDocumentId: document.id,
      resultRevision: 1,
      resultPreviewOverrides: {},
      diagnostic: null,
      rendering: false,
    }
    rendered.rerender(editor())
    await waitFor(() => expect(stack.style.visibility).toBe('hidden'))
    expect(stableDisplay.style.visibility).toBe('visible')
    expect(targetFeedback.style.transform).toBe('')
    expect(targetFeedback.querySelector('img')?.style.transform).toBe(
      'matrix(0.733333, 0, 0, 0.733333, 73.333333, 36.666667)',
    )
  })
  it('含标注的复杂图层移动继续按动画帧合并受管草稿', async () => {
    const scheduledFrame = { current: null as FrameRequestCallback | null }
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrame.current = callback
      return 17
    })
    const cancelFrame = vi.fn(() => { scheduledFrame.current = null })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    const document = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: 'draft-move-document',
      sourceResourceId: 'sha256:source',
    })
    document.layers.push(createImageEditAnnotationLayerV3('annotation-layer', '标注'))
    const changes = vi.fn()
    const rendered = render(
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.jpg"
          document={document}
          profileId="full"
          initialSelectedLayerId={document.layers[0].id}
          onDocumentChange={changes}
        />
      </div>,
    )
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const content = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    const feedback = rendered.container.querySelector<HTMLElement>('[data-move-feedback-frame]')
    if (!surface || !content) throw new Error('多图层移动测试节点不存在')
    expect(feedback).toBeNull()
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 180,
      width: 320, height: 180, toJSON: () => undefined,
    })
    await waitFor(() => expect(
      Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]?.selectedLayerIds,
    ).toEqual([document.layers[0].id]))
    const liveSession = requireImageEditV3LiveSession(document.id)
    fireEvent.pointerDown(surface, {
      pointerId: 51, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 51, clientX: 20, clientY: 15 })
    fireEvent.pointerMove(surface, { pointerId: 51, clientX: 35, clientY: 20 })
    fireEvent.pointerMove(surface, { pointerId: 51, clientX: 45, clientY: 30 })
    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
    const publishDraft = scheduledFrame.current
    if (!publishDraft) throw new Error('多图层移动没有安排草稿帧')
    publishDraft(16)
    expect(Object.keys(liveSession.bus.getSnapshot().previewOverrides)).toEqual([
      `${liveSession.sessionId}:${document.layers[0].id}:move`,
    ])
    fireEvent.pointerMove(surface, { pointerId: 51, clientX: 55, clientY: 35 })
    expect(requestFrame).toHaveBeenCalledTimes(2)
    fireEvent.pointerUp(surface, { pointerId: 51, clientX: 55, clientY: 35 })
    await waitFor(() => expect(changes).toHaveBeenCalledTimes(1))
    expect(cancelFrame).toHaveBeenCalledWith(17)
    expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
    expect(liveSession.bus.getSnapshot().document.layers[0].transform).toEqual([
      1, 0, 0, 1, 45, 25,
    ])
  })
  it('GPU 已接管时 pointermove 立即更新会话并由GPU帧合并且不发布 PreviewOverride', async () => {
    viewportBackend.composition = 'gpu'
    viewportBackend.presentation = 'webgpu-surface'
    const document = createImageEditDocumentV3({
      width: 320,
      height: 180,
      documentId: 'gpu-move-document',
      sourceResourceId: 'sha256:source',
    })
    document.layers.push(createImageEditRasterLayerV3(
      'gpu-second-layer', '第二层', 'sha256:source',
    ))
    const changes = vi.fn()
    const rendered = render(
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.jpg"
          document={document}
          profileId="full"
          initialSelectedLayerId={document.layers[0].id}
          onDocumentChange={changes}
        />
      </div>,
    )
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const content = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    if (!surface || !content) throw new Error('GPU 拖动测试节点不存在')
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 180,
      width: 320, height: 180, toJSON: () => undefined,
    })
    await waitFor(() => expect(
      Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]?.selectedLayerIds,
    ).toEqual([document.layers[0].id]))
    const liveSession = requireImageEditV3LiveSession(document.id)
    fireEvent.pointerDown(surface, {
      pointerId: 71, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 71, clientX: 20, clientY: 15 })
    fireEvent.pointerMove(surface, { pointerId: 71, clientX: 35, clientY: 25 })
    fireEvent.pointerMove(surface, { pointerId: 71, clientX: 50, clientY: 35 })
    expect(renderSession.updateTransientLayerTransform).toHaveBeenCalledTimes(3)
    expect(renderSession.requestFrame).toHaveBeenCalledTimes(3)
    expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
    expect(liveSession.bus.getSnapshot().document.revision).toBe(0)
    fireEvent.pointerUp(surface, { pointerId: 71, clientX: 50, clientY: 35 })
    await waitFor(() => expect(changes).toHaveBeenCalledTimes(1))
    expect(renderSession.clearTransientLayerTransform).toHaveBeenCalledOnce()
    expect(renderSession.requestFrame).toHaveBeenCalledTimes(4)
    expect(liveSession.bus.getSnapshot().previewOverrides).toEqual({})
    expect(liveSession.bus.getSnapshot().document.revision).toBe(1)
  })
})
