/** @vitest-environment jsdom */

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import { ANNOTATION_DEFAULT_STROKE_HEX, ANNOTATION_DEFAULT_TEXT_HEX } from '@/core/theme/colorTokens'
import { ImageEditorV3 } from './ImageEditorV3'
import type { ImageEditorV3PreviewRenderer } from './types'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function createDocument(layers: ImageEditLayerV3[]): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({ width: 1600, height: 900, documentId: 'document-ui-test' }),
    layers,
  }
}

function renderEditor(
  document: ImageEditDocumentV3,
  options: {
    profileId?: 'full' | 'quick' | 'canvas-edit' | 'mask'
    onDocumentChange?: (next: ImageEditDocumentV3) => void
    onPersistenceChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void
    previewRenderer?: ImageEditorV3PreviewRenderer
  } = {},
) {
  return render(
    <div style={{ width: 1200, height: 800 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId={options.profileId ?? 'full'}
        onDocumentChange={options.onDocumentChange ?? (() => undefined)}
        onPersistenceChange={options.onPersistenceChange}
        previewRenderer={options.previewRenderer}
      />
    </div>,
  )
}

const interactionPreview: ImageEditorV3PreviewRenderer = () => ({
  kind: 'content',
  content: <div data-testid="interaction-preview" style={{ width: 400, height: 225 }} />,
})

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
        onDocumentChange={(next) => {
          onDocumentChange(next)
          setDocument(next)
        }}
      />
    </div>
  )
}

describe('ImageEditorV3 professional shell', () => {
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
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('按自上而下的视觉顺序展示根图层和嵌套组', async () => {
    const childBottom = createImageEditAnnotationLayerV3('child-bottom', '组内下层')
    const childTop = createImageEditAnnotationLayerV3('child-top', '组内上层')
    const group = {
      ...createImageEditGroupLayerV3('group', '组'),
      children: [childBottom, childTop],
    }
    const raster = createImageEditRasterLayerV3('raster', '底图', 'resource-source')
    const rendered = renderEditor(createDocument([raster, group]))

    await waitFor(() => expect(rendered.container.querySelectorAll('[data-layer-id]')).toHaveLength(2))
    expect(Array.from(rendered.container.querySelectorAll('[data-layer-id]')).map(
      (element) => element.getAttribute('data-layer-id'),
    )).toEqual(['group', 'raster'])

    fireEvent.click(screen.getByRole('button', { name: '展开图层组' }))
    expect(Array.from(rendered.container.querySelectorAll('[data-layer-id]')).map(
      (element) => element.getAttribute('data-layer-id'),
    )).toEqual(['group', 'child-top', 'child-bottom', 'raster'])
  })

  it('严格按宿主 profile 裁剪图层，并允许创建稀疏蒙版后编辑', async () => {
    renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '蒙版目标')]),
      { profileId: 'mask' },
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '添加图层' })).toBeTruthy())
    expect(document.querySelector('[data-tool-id="crop"]')).toBeNull()
    const maskTool = document.querySelector<HTMLButtonElement>('[data-tool-id="mask-edit"]')
    expect(maskTool?.disabled).toBe(false)
    expect(maskTool?.dataset.toolReadiness).toBe('ready')

    for (const toolId of [
      'select-rect',
      'select-ellipse',
      'select-lasso',
    ]) {
      const tool = document.querySelector<HTMLButtonElement>(`[data-tool-id="${toolId}"]`)
      expect(tool?.disabled).toBe(false)
      expect(tool?.dataset.toolReadiness).toBe('ready')
    }
    for (const toolId of ['hand', 'zoom', 'raster-brush', 'eraser', 'mask-edit']) {
      const tool = document.querySelector<HTMLButtonElement>(`[data-tool-id="${toolId}"]`)
      expect(tool?.disabled).toBe(false)
      expect(tool?.dataset.toolReadiness).toBe('ready')
    }

    const addMask = screen.getByRole('button', { name: '添加蒙版' }) as HTMLButtonElement
    expect(addMask.disabled).toBe(false)
    fireEvent.click(addMask)
    expect(screen.getByRole('switch', { name: '反转蒙版' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '添加图层' }))
    expect(await screen.findByRole('menuitem', { name: '栅格图层' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '高斯模糊' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '标注图层' })).toBeNull()
  })

  it('图层菜单只提供发布范围内的扁平图层和三种效果', async () => {
    renderEditor(createDocument([createImageEditRasterLayerV3('raster', '底图')]))

    fireEvent.click(await screen.findByRole('button', { name: '添加图层' }))
    expect(screen.getByRole('menuitem', { name: '辉光 Pro' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '高斯模糊' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '柔光 / 发光' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '图层组' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '曝光' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: '混合模式' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加蒙版' })).toBeNull()
  })

  it('连续拖动参数只提交一次文档命令', async () => {
    const changes: ImageEditDocumentV3[] = []
    renderEditor(
      createDocument([createImageEditEffectLayerV3(
        'blur',
        '高斯模糊',
        'image.gaussian-blur-v2',
        { radius: 12 },
      )]),
      { onDocumentChange: (next) => changes.push(next) },
    )

    const opacity = await screen.findByRole('slider', { name: '不透明度' })
    fireEvent.change(opacity, { target: { value: '0.8' } })
    fireEvent.change(opacity, { target: { value: '0.55' } })
    expect(changes).toHaveLength(0)
    fireEvent.pointerUp(opacity)

    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].revision).toBe(1)
    expect(changes[0].layers[0].opacity).toBe(0.55)
  })

  it('裁剪工具只在应用时提交一条输出几何命令', async () => {
    const changes: ImageEditDocumentV3[] = []
    renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { onDocumentChange: (next) => changes.push(next) },
    )

    fireEvent.click(screen.getByRole('button', { name: '裁剪' }))
    fireEvent.click(screen.getByRole('button', { name: '向右旋转 90°' }))
    const width = screen.getByRole('spinbutton', { name: '宽' })
    fireEvent.change(width, { target: { value: '450' } })
    expect(changes).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '应用裁剪' }))

    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0]).toMatchObject({
      revision: 1,
      geometry: {
        width: 1600,
        height: 900,
        orientation: { rotate: 90, mirrored: false },
        crop: { x: 0, y: 0, width: 450, height: 1600 },
      },
    })
  })

  it('效果参数预览合并为一次参数更新命令', async () => {
    const changes: ImageEditDocumentV3[] = []
    renderEditor(
      createDocument([createImageEditEffectLayerV3(
        'blur',
        '高斯模糊',
        'image.gaussian-blur-v2',
        { radius: 12 },
      )]),
      { onDocumentChange: (next) => changes.push(next) },
    )

    const radius = await screen.findByRole('slider', { name: '半径' })
    fireEvent.change(radius, { target: { value: '24' } })
    fireEvent.change(radius, { target: { value: '48' } })
    expect(changes).toHaveLength(0)
    fireEvent.pointerUp(radius)

    await waitFor(() => expect(changes).toHaveLength(1))
    const layer = changes[0].layers[0]
    expect(layer.type).toBe('effect')
    if (layer.type === 'effect') expect(layer.params.radius).toBe(48)
  })

  it('发布宿主可以读取旧组但不再暴露组隔离编辑入口', async () => {
    renderEditor(
      createDocument([createImageEditGroupLayerV3('group', '图层组')]),
    )

    await waitFor(() => expect(screen.getByText('图层组')).toBeTruthy())
    expect(screen.queryByRole('switch', { name: '隔离合成' })).toBeNull()
  })

  it('受控宿主可以同步接收文档更新而不会在渲染阶段重入', async () => {
    const changes: ImageEditDocumentV3[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ControlledEditor
        initialDocument={createDocument([createImageEditRasterLayerV3('raster', '底图')])}
        onDocumentChange={(next) => changes.push(next)}
      />,
    )

    fireEvent.click(await screen.findByRole('switch', { name: '可见' }))
    await waitFor(() => expect(changes).toHaveLength(1))

    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'Cannot update a component while rendering a different component',
    )
  })

  it('渲染帧绘制后立即释放所有权', async () => {
    const release = vi.fn()
    const drawImage = vi.fn()
    const context = { clearRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const output = {
      kind: 'frame' as const,
      frame: {} as CanvasImageSource,
      width: 320,
      height: 180,
      release,
    }
    renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { previewRenderer: () => output },
    )

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1))
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('Object URL 在图片仍挂载时不提前释放，并在卸载时回收', async () => {
    const release = vi.fn()
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { previewRenderer: () => ({ kind: 'url', url: 'blob:preview-frame', release }) },
    )

    expect((await screen.findByRole('img', { name: '图片编辑预览' })).getAttribute('src')).toBe(
      'blob:preview-frame',
    )
    expect(release).not.toHaveBeenCalled()
    rendered.unmount()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('图层树支持方向键聚焦和修饰键重排', async () => {
    const changes: ImageEditDocumentV3[] = []
    const bottom = createImageEditAnnotationLayerV3('bottom', '下层')
    const top = createImageEditAnnotationLayerV3('top', '上层')
    const rendered = renderEditor(
      createDocument([bottom, top]),
      { onDocumentChange: (next) => changes.push(next) },
    )
    await waitFor(() => expect(rendered.container.querySelectorAll('[data-layer-select]')).toHaveLength(2))
    const selects = rendered.container.querySelectorAll<HTMLButtonElement>('[data-layer-select]')
    selects[0].focus()
    fireEvent.keyDown(selects[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(selects[1])

    selects[0].focus()
    fireEvent.keyDown(selects[0], { key: 'ArrowDown', ctrlKey: true })
    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].layers.map((layer) => layer.id)).toEqual(['top', 'bottom'])
    expect(screen.getAllByRole('treeitem')).toHaveLength(2)
  })

  it('保持单命令带、从属参数带和无卡片化工作面结构', async () => {
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-command-bar]')).toBeTruthy())
    expect(rendered.container.querySelectorAll('[data-command-stack]')).toHaveLength(1)
    expect(rendered.container.querySelectorAll('[data-command-bar]')).toHaveLength(1)
    expect(rendered.container.querySelector('[data-context-bar]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '标注画笔' }))
    const contextBar = rendered.container.querySelector('[data-context-bar]')
    expect(contextBar?.parentElement?.hasAttribute('data-command-stack')).toBe(true)
    expect(rendered.container.querySelectorAll('[data-context-bar]')).toHaveLength(1)

    const preview = rendered.container.querySelector('[data-preview-surface]')
    const sidebar = rendered.container.querySelector('[data-surface-level="sidebar"]')
    expect(preview?.className).not.toContain('rounded')
    expect(preview?.className).not.toContain('shadow')
    expect(sidebar?.className).not.toContain('rounded')
    expect(sidebar?.className).not.toContain('shadow')
    expect(rendered.container.querySelector('img[src="preview.png"]')).toBeNull()
  })

  it('标注位于模糊下方时静止 overlay 只保留透明命中区，不清晰重画标注', async () => {
    const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
    annotation.annotations = [{
      id: 'under-blur', type: 'rect', x: 20, y: 20, width: 100, height: 60,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 4,
    }]
    const blur = createImageEditEffectLayerV3(
      'blur',
      '高斯模糊',
      'image.gaussian-blur-v2',
      { radius: 24 },
    )
    const rendered = renderEditor(createDocument([annotation, blur]))

    await waitFor(() => expect(
      rendered.container.querySelector('[data-annotation-id="under-blur"]'),
    ).toBeTruthy())
    expect(rendered.container.querySelector('[data-annotation-draft]')).toBeNull()
    expect(rendered.container.querySelector('[data-annotation-selection]')).toBeNull()
    const hit = rendered.container.querySelector('[data-annotation-id="under-blur"] rect')
    expect(hit?.getAttribute('stroke')).toBe('transparent')
  })

  it('标注绘制过程保持瞬态并在抬笔时用单条命令创建标注图层', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { onDocumentChange: (next) => changes.push(next), previewRenderer: interactionPreview },
    )
    fireEvent.click(screen.getByRole('button', { name: '矩形标注' }))
    const overlay = await waitFor(() => rendered.container.querySelector<SVGSVGElement>(
      '[data-annotation-editor-overlay]',
    ))
    expect(overlay).toBeTruthy()
    vi.spyOn(overlay as SVGSVGElement, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 225, width: 400, height: 225,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(overlay as SVGSVGElement, { button: 0, clientX: 10, clientY: 20 })
    fireEvent.pointerMove(overlay as SVGSVGElement, { clientX: 110, clientY: 70 })
    expect(changes).toHaveLength(0)
    expect(rendered.container.querySelector('[data-annotation-id]')).toBeTruthy()
    fireEvent.pointerUp(overlay as SVGSVGElement, { clientX: 110, clientY: 70 })

    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].revision).toBe(1)
    const layer = changes[0].layers.at(-1)
    expect(layer?.type).toBe('annotation')
    if (layer?.type === 'annotation') {
      expect(layer.annotations[0]).toMatchObject({ type: 'rect', x: 40, y: 80 })
      if (layer.annotations[0].type === 'rect') {
        expect(layer.annotations[0].width).toBeCloseTo(400)
        expect(layer.annotations[0].height).toBeCloseTo(200)
      }
    }

    fireEvent.click(screen.getByRole('button', { name: '箭头标注' }))
    fireEvent.pointerDown(overlay as SVGSVGElement, { button: 0, clientX: 20, clientY: 30 })
    fireEvent.pointerUp(overlay as SVGSVGElement, { clientX: 80, clientY: 90 })
    await waitFor(() => expect(changes).toHaveLength(2))
    expect(changes[1].layers).toHaveLength(2)
    const reused = changes[1].layers.at(-1)
    if (reused?.type === 'annotation') expect(reused.annotations).toHaveLength(2)
  })

  it('文字标注可在属性区二次修改并可删除', async () => {
    const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
    annotation.annotations = [{
      id: 'text', type: 'text', x: 100, y: 100, text: '原文字',
      color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 32,
    }]
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(
      createDocument([annotation]),
      { onDocumentChange: (next) => changes.push(next), previewRenderer: interactionPreview },
    )
    const target = await waitFor(() => rendered.container.querySelector<SVGGElement>(
      '[data-annotation-id="text"]',
    ))
    const overlay = rendered.container.querySelector<SVGSVGElement>(
      '[data-annotation-editor-overlay]',
    ) as SVGSVGElement
    fireEvent.pointerDown(target as SVGGElement, { button: 0, clientX: 25, clientY: 25 })
    fireEvent.pointerUp(overlay, { clientX: 25, clientY: 25 })

    const field = await screen.findByRole('textbox', { name: '文字内容' })
    fireEvent.change(field, { target: { value: '修改后的文字' } })
    fireEvent.blur(field)
    await waitFor(() => expect(changes).toHaveLength(1))
    const updated = changes[0].layers[0]
    if (updated.type === 'annotation') expect(updated.annotations[0]).toMatchObject({ text: '修改后的文字' })

    fireEvent.click(screen.getByRole('button', { name: '删除标注' }))
    await waitFor(() => expect(changes).toHaveLength(2))
    const removed = changes[1].layers[0]
    if (removed.type === 'annotation') expect(removed.annotations).toHaveLength(0)
  })
})
