/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@testing-library/react'
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
    useManagedImageEditorPreviewV3: () => managedPreview.state,
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

  it('文档重渲染期间复用同一 managed result 时只绘制并释放一次', async () => {
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
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={first}
          profileId="full"
          onDocumentChange={onDocumentChange}
        />
      </div>,
    )

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1))
    expect(release).toHaveBeenCalledTimes(1)

    rendered.rerender(
      <div style={{ width: 900, height: 600 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={{ ...first, revision: 1 }}
          profileId="full"
          onDocumentChange={onDocumentChange}
        />
      </div>,
    )
    await waitFor(() => expect(
      rendered.container.querySelector('canvas[role="img"]'),
    ).toBeTruthy())
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
