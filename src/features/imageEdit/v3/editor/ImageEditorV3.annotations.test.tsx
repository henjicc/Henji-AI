/** @vitest-environment jsdom */

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  ANNOTATION_DEFAULT_TEXT_HEX,
  BLACK_HEX,
} from '@/core/theme/colorTokens'
import { ImageEditorV3 } from './ImageEditorV3'
import { installKonvaCanvasTestContext, mockKonvaViewportRect } from './imageEditorKonvaTestUtils'
import type { ImageEditorV3PreviewRenderer } from './types'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function createDocument(layers: ImageEditLayerV3[]): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({ width: 1600, height: 900, documentId: 'document-ui-annotations-test' }),
    layers,
  }
}

const interactionPreview: ImageEditorV3PreviewRenderer = () => ({
  kind: 'content',
  content: <div data-testid="interaction-preview" style={{ width: 400, height: 225 }} />,
})

function renderEditor(
  document: ImageEditDocumentV3,
  options: {
    onDocumentChange?: (next: ImageEditDocumentV3) => void
    previewRenderer?: ImageEditorV3PreviewRenderer
  } = {},
) {
  return render(
    <div style={{ width: 1200, height: 800 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId="full"
        onDocumentChange={options.onDocumentChange ?? (() => undefined)}
        previewRenderer={options.previewRenderer}
      />
    </div>,
  )
}

function ControlledEditor({
  initialDocument,
  onDocumentChange,
}: {
  initialDocument: ImageEditDocumentV3
  onDocumentChange: (next: ImageEditDocumentV3) => void
}) {
  const [document, setDocument] = useState(initialDocument)
  return (
    <div style={{ width: 1200, height: 800 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId="full"
        previewRenderer={interactionPreview}
        onDocumentChange={(next) => {
          onDocumentChange(next)
          setDocument(next)
        }}
      />
    </div>
  )
}

function selectAnnotationInEditor(layerId: string, annotationId: string): void {
  const sessionId = Object.keys(useImageEditorSessionStoreV3.getState().sessions)[0]
  if (!sessionId) throw new Error('测试缺少图片编辑会话')
  act(() => {
    useImageEditorSessionStoreV3.getState().setSelectedLayerIds(sessionId, [layerId])
    useImageEditorInteractionStoreV3.getState().selectAnnotation(sessionId, {
      layerId,
      annotationId,
    })
  })
}

describe('ImageEditorV3 floating panels and annotations', () => {
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

  it('停靠面板可拖出为浮窗，并在右边缘按上下顺序重新组合', async () => {
    const rendered = renderEditor(createDocument([createImageEditRasterLayerV3('raster', '底图')]))
    const workspace = rendered.container.querySelector<HTMLElement>('[data-editor-panel-workspace]')
    const properties = rendered.container.querySelector<HTMLElement>('[data-editor-panel-id="properties"]')
    const handle = properties?.querySelector<HTMLElement>('[data-editor-panel-handle]')
    expect(workspace && properties && handle).toBeTruthy()
    vi.spyOn(workspace as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800,
      toJSON: () => ({}),
    })
    vi.spyOn(properties as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 800, y: 400, left: 800, top: 400, right: 1200, bottom: 800, width: 400, height: 400,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(handle as HTMLElement, {
      pointerId: 11, button: 0, isPrimary: true, clientX: 900, clientY: 420,
    })
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 500, clientY: 120 })
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 500, clientY: 120 })
    const floating = await waitFor(() => rendered.container.querySelector<HTMLElement>(
      '[data-editor-panel-id="properties"][data-panel-mode="floating"]',
    ))
    expect(floating).toBeTruthy()

    vi.spyOn(floating as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 400, y: 100, left: 400, top: 100, right: 800, bottom: 700, width: 400, height: 600,
      toJSON: () => ({}),
    })
    const layerPanel = rendered.container.querySelector<HTMLElement>('[data-editor-panel-id="layers"]')
    vi.spyOn(layerPanel as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 800, y: 0, left: 800, top: 0, right: 1200, bottom: 800, width: 400, height: 800,
      toJSON: () => ({}),
    })
    const floatingHandle = floating?.querySelector<HTMLElement>('[data-editor-panel-handle]')
    fireEvent.pointerDown(floatingHandle as HTMLElement, {
      pointerId: 12, button: 0, isPrimary: true, clientX: 500, clientY: 120,
    })
    fireEvent.pointerMove(window, { pointerId: 12, clientX: 1190, clientY: 700 })
    expect(rendered.container.querySelector('[data-editor-panel-dock-preview="right"]')).toBeTruthy()
    fireEvent.pointerUp(window, { pointerId: 12, clientX: 1190, clientY: 700 })

    await waitFor(() => expect(rendered.container.querySelectorAll('[data-docked-editor-panel]')).toHaveLength(2))
    expect([...rendered.container.querySelectorAll('[data-docked-editor-panel]')].map(
      (panel) => panel.getAttribute('data-editor-panel-id'),
    )).toEqual(['layers', 'properties'])
  })

  it('标注位于模糊下方时不进入清晰实时层，交由基础预览统一合成', async () => {
    const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
    annotation.annotations = [{
      id: 'under-blur', type: 'rect', x: 20, y: 20, width: 100, height: 60,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 4,
    }]
    const blur = createImageEditEffectLayerV3('blur', '模糊', 'image.fast-blur-v3', { radius: 24 })
    const rendered = renderEditor(createDocument([annotation, blur]))

    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())
    expect(rendered.container.querySelector('[data-annotation-editor-overlay]')).toBeNull()
  })

  it('标注绘制过程保持瞬态并在抬笔时用单条命令创建标注图层', async () => {
    installKonvaCanvasTestContext()
    mockKonvaViewportRect()
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { onDocumentChange: (next) => changes.push(next), previewRenderer: interactionPreview },
    )
    fireEvent.click(screen.getByRole('button', { name: '标注工具' }))
    fireEvent.click(screen.getByRole('button', { name: '矩形标注' }))
    const overlay = await waitFor(() => rendered.container.querySelector<HTMLDivElement>(
      '[data-annotation-editor-overlay]',
    ))
    expect(overlay).toBeTruthy()
    expect(overlay?.getBoundingClientRect().width).toBe(400)
    await waitFor(() => expect(overlay?.querySelector('canvas')).toBeTruthy())
    const canvas = overlay?.querySelector<HTMLCanvasElement>('canvas')
    if (!canvas) throw new Error('测试缺少 Konva 标注画布')
    const stageContent = canvas.parentElement
    if (!stageContent) throw new Error('测试缺少 Konva 事件容器')

    fireEvent.pointerDown(overlay as HTMLDivElement, {
      button: 0, buttons: 1, pointerId: 7, clientX: 10, clientY: 20,
    })
    fireEvent.pointerMove(overlay as HTMLDivElement, {
      buttons: 1, pointerId: 7, clientX: 110, clientY: 70,
    })
    expect(changes).toHaveLength(0)
    expect(overlay?.getAttribute('data-annotation-drawing')).toBe('true')
    fireEvent.pointerUp(overlay as HTMLDivElement, {
      button: 0, pointerId: 7, clientX: 110, clientY: 70,
    })

    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].revision).toBe(1)
    const layer = changes[0].layers.at(-1)
    expect(layer?.type).toBe('annotation')
    if (layer?.type === 'annotation') {
      expect(layer.annotations[0]).toMatchObject({ type: 'rect', x: 40, y: 80 })
      expect(Object.values(
        useImageEditorInteractionStoreV3.getState().annotationSelectionBySession,
      )).toContainEqual({ layerId: layer.id, annotationId: layer.annotations[0].id })
      if (layer.annotations[0].type === 'rect') {
        expect(layer.annotations[0].width).toBeCloseTo(400)
        expect(layer.annotations[0].height).toBeCloseTo(200)
      }
    }

    fireEvent.click(screen.getByRole('button', { name: '标注工具' }))
    fireEvent.click(screen.getByRole('button', { name: '箭头标注' }))
    fireEvent.mouseDown(stageContent, { button: 0, clientX: 20, clientY: 30 })
    fireEvent.mouseMove(stageContent, { buttons: 1, clientX: 80, clientY: 90 })
    fireEvent.mouseUp(stageContent, { button: 0, clientX: 80, clientY: 90 })
    await waitFor(() => expect(changes).toHaveLength(2))
    expect(changes[1].layers).toHaveLength(2)
    const reused = changes[1].layers.at(-1)
    if (reused?.type === 'annotation') expect(reused.annotations).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '标注工具' }))
    fireEvent.click(screen.getByRole('button', { name: '打码' }))
    fireEvent.click(screen.getByRole('button', { name: '高斯模糊' }))
    const mosaicParameters = rendered.container.querySelector<HTMLElement>('[data-tool-parameters]')
    expect(mosaicParameters).toBeTruthy()
    expect(within(mosaicParameters as HTMLElement).queryByLabelText('颜色')).toBeNull()
    expect(within(mosaicParameters as HTMLElement).queryByRole('slider', { name: '描边' })).toBeNull()
    expect(within(mosaicParameters as HTMLElement).getByRole('slider', { name: '强度' })).toBeTruthy()
    fireEvent.mouseDown(stageContent, { button: 0, clientX: 40, clientY: 40 })
    fireEvent.mouseMove(stageContent, { buttons: 1, clientX: 120, clientY: 100 })
    fireEvent.mouseUp(stageContent, { button: 0, clientX: 120, clientY: 100 })
    await waitFor(() => expect(changes).toHaveLength(3))
    const withMosaic = changes[2].layers.at(-1)
    if (withMosaic?.type === 'annotation') {
      expect(withMosaic.annotations.at(-1)).toMatchObject({ type: 'mosaic', mode: 'blur' })
    }
  })

  it('文字标注可在属性区二次修改并可删除', async () => {
    const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
    annotation.annotations = [{
      id: 'text', type: 'text', x: 100, y: 100, text: '原文字',
      color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 32,
    }]
    const changes: ImageEditDocumentV3[] = []
    renderEditor(
      createDocument([annotation]),
      { onDocumentChange: (next) => changes.push(next), previewRenderer: interactionPreview },
    )
    await waitFor(() => expect(Object.keys(useImageEditorSessionStoreV3.getState().sessions)).toHaveLength(1))
    selectAnnotationInEditor('annotations', 'text')

    const field = await screen.findByRole('textbox', { name: '文字内容' })
    fireEvent.change(field, { target: { value: '修改后的文字' } })
    fireEvent.blur(field)
    await waitFor(() => expect(changes).toHaveLength(1))
    const updated = changes[0].layers[0]
    if (updated.type === 'annotation') {
      expect(updated.annotations[0]).toMatchObject({ text: '修改后的文字' })
    }

    fireEvent.click(screen.getByRole('button', { name: '删除标注' }))
    await waitFor(() => expect(changes).toHaveLength(2))
    const removed = changes[1].layers[0]
    if (removed.type === 'annotation') expect(removed.annotations).toHaveLength(0)
  })

  it('工具栏会读取当前选中标注，并把颜色与描边直接写回该对象', async () => {
    const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
    annotation.annotations = [{
      id: 'selected-rect', type: 'rect', x: 20, y: 20, width: 100, height: 60,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 4,
    }]
    const changes: ImageEditDocumentV3[] = []
    const rendered = render(
      <ControlledEditor
        initialDocument={createDocument([annotation])}
        onDocumentChange={(next) => changes.push(next)}
      />,
    )
    await waitFor(() => expect(Object.keys(useImageEditorSessionStoreV3.getState().sessions)).toHaveLength(1))
    selectAnnotationInEditor('annotations', 'selected-rect')

    const toolParameters = await waitFor(() => rendered.container.querySelector<HTMLElement>('[data-tool-parameters]'))
    expect(toolParameters).toBeTruthy()
    expect((within(toolParameters as HTMLElement).getByLabelText('颜色') as HTMLInputElement).value).toBe(
      ANNOTATION_DEFAULT_STROKE_HEX,
    )
    fireEvent.change(within(toolParameters as HTMLElement).getByLabelText('颜色'), {
      target: { value: BLACK_HEX },
    })
    await waitFor(() => expect(changes).toHaveLength(1))
    const recolored = changes.at(-1)?.layers[0]
    if (recolored?.type === 'annotation') {
      expect(recolored.annotations[0]).toMatchObject({ stroke: BLACK_HEX, lineWidth: 4 })
    }

    const latestToolParameters = rendered.container.querySelector<HTMLElement>('[data-tool-parameters]')
    fireEvent.change(within(latestToolParameters as HTMLElement).getByLabelText('描边'), {
      target: { value: '12' },
    })
    await waitFor(() => expect(changes).toHaveLength(2))
    const restyled = changes.at(-1)?.layers[0]
    if (restyled?.type === 'annotation') {
      expect(restyled.annotations[0]).toMatchObject({ stroke: BLACK_HEX, lineWidth: 12 })
    }
  })
})
