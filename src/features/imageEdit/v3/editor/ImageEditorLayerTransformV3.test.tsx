/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Konva from 'konva'

import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens'
import i18n from '@/i18n/config'

import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorV3 } from './ImageEditorV3'
import { installKonvaCanvasTestContext, mockKonvaViewportRect } from './imageEditorKonvaTestUtils'
import type { ImageEditorV3PreviewRenderer } from './types'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function createDocument(layers: ImageEditLayerV3[]): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({ width: 1600, height: 900, documentId: 'layer-transform-ui' }),
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
    onDocumentChange(next: ImageEditDocumentV3): void
    onPersistenceChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void
  },
) {
  return render(
    <div style={{ width: 1200, height: 800 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId="full"
        onDocumentChange={options.onDocumentChange}
        onPersistenceChange={options.onPersistenceChange}
        previewRenderer={interactionPreview}
      />
    </div>,
  )
}

function mockViewportRect(element: Element): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 225,
    width: 400,
    height: 225,
    toJSON: () => ({}),
  })
}

describe('图片编辑 V3 图层变换交互', () => {
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

  it('move 命中具体标注时保留单对象二次编辑，并只写一条对象历史', async () => {
    installKonvaCanvasTestContext()
    mockKonvaViewportRect()
    const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
    annotation.annotations = [{
      id: 'rect', type: 'rect', x: 40, y: 40, width: 160, height: 80,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 4,
    }]
    const changes: ImageEditDocumentV3[] = []
    const persistence: ImageEditPersistenceSnapshotV3[] = []
    const rendered = renderEditor(createDocument([annotation]), {
      onDocumentChange: (next) => changes.push(next),
      onPersistenceChange: (snapshot) => persistence.push(snapshot),
    })
    const stage = await waitFor(() => {
      const current = Konva.stages.find((candidate) => (
        rendered.container.contains(candidate.container())
      ))
      expect(current).toBeTruthy()
      return current
    })
    const target = stage?.find('Rect').find((node) => node.draggable())
    if (!target) throw new Error('测试缺少标注对象')

    act(() => target.fire('click', { evt: new MouseEvent('click') }, true))
    expect(changes).toHaveLength(0)
    expect(rendered.container.querySelector('[data-selected-annotation-type="rect"]')).toBeTruthy()

    act(() => {
      target.position({ x: 140, y: 80 })
      target.fire('dragend', {
        target,
        evt: new MouseEvent('mouseup'),
      }, true)
    })

    await waitFor(() => expect(changes).toHaveLength(1))
    const layer = changes[0].layers[0]
    if (layer.type !== 'annotation') throw new Error('测试预期标注图层')
    expect(layer.annotations[0]).toMatchObject({ x: 140, y: 80 })
    expect(layer.transform).toEqual([1, 0, 0, 1, 0, 0])
    expect(persistence).toHaveLength(1)
    expect(persistence[0].history.undo).toHaveLength(1)
  })

  it('move 在非对象背景拖动当前单选标注图层，并保持对象局部坐标', async () => {
    const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
    annotation.annotations = [{
      id: 'rect', type: 'rect', x: 40, y: 40, width: 160, height: 80,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 4,
    }]
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(createDocument([annotation]), {
      onDocumentChange: (next) => changes.push(next),
    })
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const viewportContent = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    if (!surface || !viewportContent) throw new Error('测试缺少视口')
    mockViewportRect(viewportContent)

    fireEvent.pointerDown(surface, {
      pointerId: 3, isPrimary: true, button: 0, clientX: 20, clientY: 20,
    })
    fireEvent.pointerMove(surface, { pointerId: 3, clientX: 45, clientY: 30 })
    expect(changes).toHaveLength(0)
    fireEvent.pointerUp(surface, { pointerId: 3, clientX: 45, clientY: 30 })

    await waitFor(() => expect(changes).toHaveLength(1))
    const layer = changes[0].layers[0]
    if (layer.type !== 'annotation') throw new Error('测试预期标注图层')
    expect(layer.annotations[0]).toMatchObject({ x: 40, y: 40 })
    expect(layer.transform).toEqual([1, 0, 0, 1, 100, 40])
  })

  it('新导入图片默认选择原始栅格层，不会选中最上方效果层', async () => {
    const raster = createImageEditRasterLayerV3('raster', '原图', 'sha256:source')
    const effect = createImageEditEffectLayerV3(
      'blur',
      '高斯模糊',
      'image.gaussian-blur-v2',
      { radiusPixels: 8 },
    )
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(createDocument([raster, effect]), {
      onDocumentChange: (next) => changes.push(next),
    })
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const viewportContent = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    if (!surface || !viewportContent) throw new Error('测试缺少视口')
    mockViewportRect(viewportContent)
    await waitFor(() => {
      const session = Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
      expect(session?.selectedLayerIds).toEqual(['raster'])
    })

    fireEvent.pointerDown(surface, {
      pointerId: 31, isPrimary: true, button: 0, clientX: 20, clientY: 20,
    })
    fireEvent.pointerMove(surface, { pointerId: 31, clientX: 45, clientY: 30 })
    expect(changes).toHaveLength(0)
    fireEvent.pointerUp(surface, { pointerId: 31, clientX: 45, clientY: 30 })

    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].layers[0].transform).toEqual([1, 0, 0, 1, 100, 40])
    expect(changes[0].layers[1].transform).toEqual([1, 0, 0, 1, 0, 0])
    expect(changes[0].revision).toBe(1)
  })

  it('move 点击、拖回原点和 pointercancel 都不写历史，锁定层也不可变', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { onDocumentChange: (next) => changes.push(next) },
    )
    const surface = rendered.container.querySelector<HTMLElement>('[data-preview-surface]')
    const viewportContent = rendered.container.querySelector<HTMLElement>('[data-viewport-content]')
    if (!surface || !viewportContent) throw new Error('测试缺少视口')
    mockViewportRect(viewportContent)

    fireEvent.pointerDown(surface, {
      pointerId: 4, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerUp(surface, { pointerId: 4, clientX: 10, clientY: 10 })
    expect(changes).toHaveLength(0)

    fireEvent.pointerDown(surface, {
      pointerId: 5, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 5, clientX: 30, clientY: 20 })
    fireEvent.pointerCancel(surface, { pointerId: 5 })
    expect(changes).toHaveLength(0)

    fireEvent.pointerDown(surface, {
      pointerId: 6, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 6, clientX: 30, clientY: 20 })
    fireEvent.pointerMove(surface, { pointerId: 6, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(surface, { pointerId: 6, clientX: 10, clientY: 10 })
    expect(changes).toHaveLength(0)

    fireEvent.click(screen.getByRole('switch', { name: '锁定' }))
    await waitFor(() => expect(changes).toHaveLength(1))
    fireEvent.pointerDown(surface, {
      pointerId: 7, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 7, clientX: 40, clientY: 20 })
    fireEvent.pointerUp(surface, { pointerId: 7, clientX: 40, clientY: 20 })
    expect(changes).toHaveLength(1)
    expect(changes[0].layers[0].transform).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('变换数值连续输入只提交一次，并拒绝零缩放', async () => {
    const changes: ImageEditDocumentV3[] = []
    renderEditor(createDocument([createImageEditRasterLayerV3('raster', '底图')]), {
      onDocumentChange: (next) => changes.push(next),
    })
    const x = await screen.findByRole('spinbutton', { name: 'X 位置' })
    fireEvent.change(x, { target: { value: '10' } })
    fireEvent.change(x, { target: { value: '24' } })
    expect(changes).toHaveLength(0)
    fireEvent.blur(x)
    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].layers[0].transform).toEqual([1, 0, 0, 1, 24, 0])

    const scaleX = screen.getByRole('spinbutton', { name: '水平缩放 (%)' })
    fireEvent.change(scaleX, { target: { value: '0' } })
    expect(screen.getByRole('status').textContent).toContain('缩放不能为零')
    fireEvent.blur(scaleX)
    expect(changes).toHaveLength(1)
  })
})
