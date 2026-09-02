/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import i18n from '@/i18n/config'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import { installKonvaCanvasTestContext, mockKonvaViewportRect } from './imageEditorKonvaTestUtils'
import { ImageEditorV3 } from './ImageEditorV3'
import type { ImageEditorV3PreviewRenderer } from './types'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const previewRenderer: ImageEditorV3PreviewRenderer = () => ({
  kind: 'content',
  content: <div style={{ width: 400, height: 225 }} />,
})

function documentWithLayers(): ImageEditDocumentV3 {
  const document = createImageEditDocumentV3({
    width: 1600,
    height: 900,
    documentId: 'lifecycle-document',
  })
  document.layers = [
    createImageEditRasterLayerV3('bottom', '底层'),
    createImageEditRasterLayerV3('top', '顶层'),
  ]
  return document
}

function ControlledEditor({
  onDocumentChange,
}: {
  onDocumentChange: (document: ImageEditDocumentV3) => void
}): JSX.Element {
  const [document, setDocument] = useState(documentWithLayers)
  return (
    <div style={{ width: 1000, height: 700 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId="mask"
        previewRenderer={previewRenderer}
        onDocumentChange={(next) => {
          onDocumentChange(next)
          setDocument(next)
        }}
      />
    </div>
  )
}

describe('ImageEditorV3 lifecycle guards', () => {
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
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('标注手势在工具切换和外部文档变更时立即取消且不提交', async () => {
    installKonvaCanvasTestContext()
    mockKonvaViewportRect()
    const changes = vi.fn()
    const initial = documentWithLayers()
    const editor = (document: ImageEditDocumentV3) => (
      <div style={{ width: 1000, height: 700 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={document}
          profileId="full"
          previewRenderer={previewRenderer}
          onDocumentChange={changes}
        />
      </div>
    )
    const rendered = render(editor(initial))
    fireEvent.click(await screen.findByRole('button', { name: '矩形标注' }))
    await waitFor(() => expect(
      rendered.container.querySelector('[data-annotation-editor-overlay]'),
    ).toBeTruthy())
    const overlay = rendered.container.querySelector<HTMLDivElement>(
      '[data-annotation-editor-overlay]',
    )
    await waitFor(() => expect(overlay?.querySelector('canvas')).toBeTruthy())
    const stageContent = overlay?.querySelector('canvas')?.parentElement
    if (!overlay || !stageContent) throw new Error('测试缺少 Konva 标注画布')

    fireEvent.mouseDown(stageContent, { button: 0, clientX: 20, clientY: 20 })
    fireEvent.mouseMove(stageContent, { buttons: 1, clientX: 100, clientY: 80 })
    expect(overlay.dataset.annotationDrawing).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '移动图像或图层' }))
    await waitFor(() => expect(
      rendered.container.querySelector('[data-annotation-editor-overlay]'),
    ).toBeNull())
    expect(changes).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '矩形标注' }))
    await waitFor(() => expect(
      rendered.container.querySelector('[data-annotation-editor-overlay]'),
    ).toBeTruthy())
    const remounted = rendered.container.querySelector<HTMLDivElement>(
      '[data-annotation-editor-overlay]',
    )
    await waitFor(() => expect(remounted?.querySelector('canvas')).toBeTruthy())
    const remountedStage = remounted?.querySelector('canvas')?.parentElement
    if (!remounted || !remountedStage) throw new Error('测试缺少重新挂载的标注画布')
    fireEvent.mouseDown(remountedStage, { button: 0, clientX: 50, clientY: 50 })
    fireEvent.mouseMove(remountedStage, { buttons: 1, clientX: 120, clientY: 100 })
    expect(remounted.dataset.annotationDrawing).toBe('true')
    rendered.rerender(editor({ ...initial, revision: 1 }))
    await waitFor(() => expect(remounted.dataset.annotationDrawing).toBe('false'))
    expect(changes).not.toHaveBeenCalled()
  })

  it('添加空蒙版只提交一次，切换图层不会把蒙版写到新选择', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = render(
      <ControlledEditor onDocumentChange={(document) => changes.push(document)} />,
    )

    fireEvent.click(await rendered.findByRole('button', { name: '添加蒙版' }))
    await waitFor(() => expect(changes).toHaveLength(1))
    const topSelect = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>('[data-layer-select]'),
    ).find((button) => button.textContent?.includes('顶层'))
    fireEvent.click(topSelect as HTMLButtonElement)

    expect(changes[0].layers[0].mask).toMatchObject({
      kind: 'sparse-mask',
      defaultValue: 1,
      tiles: {},
    })
    expect(changes[0].layers[1].mask).toBeNull()
    expect(changes[0].revision).toBe(1)
    expect((screen.getByRole('button', { name: '添加蒙版' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('opacity pointercancel 清除瞬态值且不提交历史', async () => {
    const changes = vi.fn()
    render(
      <ControlledEditor
        onDocumentChange={changes}
      />,
    )
    const opacity = await screen.findByRole('slider', { name: '不透明度' }) as HTMLInputElement
    fireEvent.change(opacity, { target: { value: '0.35' } })
    expect(opacity.value).toBe('0.35')
    fireEvent.pointerCancel(opacity)

    expect(opacity.value).toBe('1')
    expect(changes).not.toHaveBeenCalled()
  })

  it('祖先锁定时禁用内容动作，混合选择删除保持原子预检', async () => {
    const child = createImageEditRasterLayerV3('locked-child', '锁定组子层')
    const group = {
      ...createImageEditGroupLayerV3('locked-group', '锁定组'),
      locked: true,
      children: [child],
    }
    const document = createImageEditDocumentV3({ width: 640, height: 480, documentId: 'locked-ui' })
    document.layers = [createImageEditRasterLayerV3('outside', '外部层'), group]
    const rendered = render(
      <div style={{ width: 1000, height: 700 }}>
        <ImageEditorV3
          sourceImageUrl="preview.png"
          document={document}
          profileId="full"
          previewRenderer={previewRenderer}
          onDocumentChange={vi.fn()}
        />
      </div>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '展开图层组' }))
    const selects = rendered.container.querySelectorAll<HTMLButtonElement>('[data-layer-select]')
    fireEvent.click(Array.from(selects).find((button) => button.textContent?.includes('锁定组子层')) as HTMLButtonElement)

    expect((screen.getByRole('switch', { name: '可见' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: '锁定' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('slider', { name: '不透明度' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('combobox', { name: '混合模式' })).toBeNull()
    expect((screen.getByRole('button', { name: '删除所选图层' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '复制图层' }) as HTMLButtonElement).disabled).toBe(true)

    const outside = Array.from(selects).find((button) => button.textContent?.includes('外部层'))
    fireEvent.click(outside as HTMLButtonElement, { ctrlKey: true })
    expect((screen.getByRole('button', { name: '删除所选图层' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
