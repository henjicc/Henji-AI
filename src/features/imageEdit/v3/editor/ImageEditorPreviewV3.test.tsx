/** @vitest-environment jsdom */

import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import i18n from '@/i18n/config'
import type { ImageEditorManagedPreviewResultV3 } from '../execution/imageEditorPreviewClientV3'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'

interface ManagedPreviewTestStateV3 {
  result: ImageEditorManagedPreviewResultV3 | null
  resultDocumentId: string | null
  resultRevision: number | null
  diagnostic: string | null
  rendering: boolean
}

const managedPreview = vi.hoisted(() => ({
  state: {
    result: null,
    resultDocumentId: null,
    resultRevision: null,
    diagnostic: null,
    rendering: false,
  } as ManagedPreviewTestStateV3,
}))

vi.mock('../execution', async (importOriginal) => {
  const original = await importOriginal<typeof import('../execution')>()
  return {
    ...original,
    useImageEditorDisplayPipelineV3: () => ({
      hasPreviewOverrides: false,
      managedPreview: managedPreview.state,
      viewportComposite: {
        result: null,
        diagnostic: null,
        fallbackRequired: true,
        rendering: false,
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
    })
    managedPreview.state = {
      result: null,
      resultDocumentId: null,
      resultRevision: null,
      diagnostic: null,
      rendering: false,
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('StrictMode 重挂载与文档重渲染期间只读取 managed result，不提前释放', async () => {
    const release = vi.fn()
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
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

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2))
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
      rendered.container.querySelector('canvas[role="img"]'),
    ).toBeTruthy())
    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(release).not.toHaveBeenCalled()
  })

  it('手形拖动只在结束时提交一次视口状态，缩放工具以指针为锚点', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '抓手' }))
    fireEvent.pointerDown(surface, {
      pointerId: 7, isPrimary: true, button: 0, clientX: 100, clientY: 100,
    })
    fireEvent.pointerMove(surface, { pointerId: 7, clientX: 140, clientY: 120 })
    const sessionId = Object.keys(useImageEditorSessionStoreV3.getState().sessions)[0]
    expect(content.style.transform).toContain('translate3d(40px, 20px, 0)')
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession[sessionId]).toBeUndefined()

    fireEvent.pointerUp(surface, { pointerId: 7, clientX: 140, clientY: 120 })
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession[sessionId]).toEqual({
      x: 40,
      y: 20,
    })

    fireEvent.click(screen.getByRole('button', { name: '缩放' }))
    fireEvent.pointerDown(surface, {
      pointerId: 8, isPrimary: true, button: 0, clientX: 600, clientY: 300,
    })
    fireEvent.pointerUp(surface, { pointerId: 8, clientX: 600, clientY: 300 })
    expect(useImageEditorInteractionStoreV3.getState().viewportZoomBySession[sessionId]).toBe(1.25)
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession[sessionId]).toEqual({
      x: 25,
      y: 25,
    })
    expect(document.revision).toBe(0)
  })

  it('单底图移动在渲染任务完成前提供合成层即时反馈，取消时不写 revision', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
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
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 180,
      width: 320, height: 180, toJSON: () => undefined,
    })

    await waitFor(() => expect(
      Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]?.selectedLayerIds,
    ).toEqual([document.layers[0].id]))
    fireEvent.pointerDown(surface, {
      pointerId: 41, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 41, clientX: 35, clientY: 20 })
    expect(feedback.style.transform).toBe('translate3d(25px, 10px, 0)')
    expect(changes).not.toHaveBeenCalled()

    fireEvent.pointerCancel(surface, { pointerId: 41 })
    expect(feedback.style.transform).toBe('')
    expect(changes).not.toHaveBeenCalled()
    expect(document.revision).toBe(0)
  })
})
