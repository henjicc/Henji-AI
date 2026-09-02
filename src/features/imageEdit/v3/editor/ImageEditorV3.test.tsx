/** @vitest-environment jsdom */

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit'
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

const interactionPreview: ImageEditorV3PreviewRenderer = () => ({
  kind: 'content',
  content: <div data-testid="interaction-preview" style={{ width: 400, height: 225 }} />,
})

function ControlledEditor({
  initialDocument,
  onDocumentChange,
  previewRenderer,
}: {
  initialDocument: ImageEditDocumentV3
  onDocumentChange: (next: ImageEditDocumentV3) => void
  previewRenderer?: ImageEditorV3PreviewRenderer
}) {
  const [document, setDocument] = useState(initialDocument)
  return (
    <div style={{ width: 1200, height: 800 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId="full"
        previewRenderer={previewRenderer}
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
      annotationPreviewBySession: {},
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

  it('图层菜单只提供发布范围内的扁平图层，并在 WebGPU 不可用时禁用辉光 Pro', async () => {
    renderEditor(createDocument([createImageEditRasterLayerV3('raster', '底图')]))

    fireEvent.click(await screen.findByRole('button', { name: '添加图层' }))
    const glow = screen.getByRole('menuitem', { name: /辉光 Pro.*WebGPU/ }) as HTMLButtonElement
    expect(glow.disabled).toBe(true)
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

    fireEvent.click(await screen.findByRole('tab', { name: '基础' }))
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

    fireEvent.click(await screen.findByRole('tab', { name: '基础' }))
    fireEvent.click(await screen.findByRole('switch', { name: '可见' }))
    await waitFor(() => expect(changes).toHaveLength(1))

    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'Cannot update a component while rendering a different component',
    )
  })

  it('渲染帧绘制后保持所有权，真实卸载后才释放', async () => {
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
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { previewRenderer: () => output },
    )

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1))
    expect(release).not.toHaveBeenCalled()
    rendered.unmount()
    await Promise.resolve()
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
    await Promise.resolve()
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

  it('保持单命令带、从属参数带和右侧上下组合的停靠属性窗结构', async () => {
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-command-bar]')).toBeTruthy())
    expect(rendered.container.querySelectorAll('[data-command-stack]')).toHaveLength(1)
    expect(rendered.container.querySelectorAll('[data-command-bar]')).toHaveLength(1)
    expect(rendered.container.querySelector('[data-context-bar]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '标注工具' }))
    const contextBar = rendered.container.querySelector('[data-context-bar]')
    expect(contextBar?.parentElement?.hasAttribute('data-command-stack')).toBe(true)
    expect(rendered.container.querySelectorAll('[data-context-bar]')).toHaveLength(1)

    const preview = rendered.container.querySelector('[data-preview-surface]')
    const dockedPanels = rendered.container.querySelectorAll('[data-docked-editor-panel]')
    expect(preview?.className).not.toContain('rounded')
    expect(preview?.className).not.toContain('shadow')
    expect(rendered.container.querySelector('[data-editor-panel-dock="right"]')).toBeTruthy()
    expect(dockedPanels).toHaveLength(2)
    expect([...dockedPanels].map((panel) => panel.getAttribute('data-editor-panel-id'))).toEqual([
      'layers',
      'properties',
    ])
    expect(rendered.container.querySelectorAll('[data-floating-editor-panel]')).toHaveLength(0)
    expect(rendered.container.querySelector('img[src="preview.png"]')).toBeNull()
  })

  it('把标注收进单一入口，并在从属参数带切换具体标注工具', async () => {
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
    )
    expect(rendered.container.querySelector('[data-tool-id="annotation"]')).toBeTruthy()
    expect(rendered.container.querySelector('[data-tool-id="annotation-arrow"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '标注工具' }))
    expect(screen.getByRole('group', { name: '标注类型' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '矩形标注' }))
    const session = Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
    expect(session.activeTool).toBe('annotation-rect')
    expect(session.toolSettings.annotationTool).toBe('annotation-rect')
  })

  it('属性默认打开参数 Tab，基础 Tab 单独承载名称与通用开关', async () => {
    renderEditor(createDocument([createImageEditEffectLayerV3(
      'blur', '高斯模糊', 'image.gaussian-blur-v2', { radius: 12 },
    )]))
    const parametersTab = await screen.findByRole('tab', { name: '参数' })
    expect(parametersTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('slider', { name: '半径' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '名称' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '基础' }))
    expect(screen.getByRole('textbox', { name: '名称' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '可见' })).toBeTruthy()
    expect(screen.queryByRole('slider', { name: '半径' })).toBeNull()
  })

  it('辉光 Pro 参数 Tab 恢复旧版完整参数并保持单一滚动区', async () => {
    const rendered = renderEditor(createDocument([createImageEditEffectLayerV3(
      'glow', '辉光 Pro', 'image.vgpu-glow',
      JSON.parse(JSON.stringify(createDefaultVgpuGlowOperationParams())),
    )]))
    const parameterPanel = await waitFor(() => rendered.container.querySelector<HTMLElement>(
      '[data-properties-tab-panel="parameters"]',
    ))
    if (!parameterPanel) throw new Error('辉光参数 Tab 未挂载')
    expect(parameterPanel.className).toContain('overflow-y-auto')
    const controls = within(parameterPanel)
    expect(controls.getByRole('button', { name: '自然' })).toBeTruthy()
    expect(controls.getByRole('switch', { name: '着色' })).toBeTruthy()
    expect(controls.getByRole('slider', { name: '辉光强度' })).toBeTruthy()
    expect(controls.getByRole('slider', { name: '半径' })).toBeTruthy()
    expect(controls.getByRole('slider', { name: '色差' })).toBeTruthy()
    expect(controls.getByRole('slider', { name: '亮源门槛' })).toBeTruthy()
    expect(controls.getByRole('slider', { name: '核心白热' })).toBeTruthy()
  })

  it('停靠区支持拖动宽度边缘和上下分隔线调整尺寸', async () => {
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
    )
    const workspace = rendered.container.querySelector<HTMLElement>('[data-editor-panel-workspace]')
    const dock = rendered.container.querySelector<HTMLElement>('[data-editor-panel-dock="right"]')
    if (!workspace || !dock) throw new Error('停靠区未挂载')
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800,
      toJSON: () => ({}),
    })
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({
      x: 800, y: 0, left: 800, top: 0, right: 1200, bottom: 800, width: 400, height: 800,
      toJSON: () => ({}),
    })
    const widthHandle = screen.getByRole('separator', { name: '调整停靠面板宽度' })
    fireEvent.pointerDown(widthHandle, {
      pointerId: 21, button: 0, isPrimary: true, clientX: 800, clientY: 200,
    })
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 700, clientY: 200 })
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 700, clientY: 200 })
    expect(dock.style.width).toBe('500px')

    const splitHandle = screen.getByRole('separator', { name: '调整上下停靠面板高度' })
    fireEvent.pointerDown(splitHandle, {
      pointerId: 22, button: 0, isPrimary: true, clientX: 900, clientY: 400,
    })
    fireEvent.pointerMove(window, { pointerId: 22, clientX: 900, clientY: 560 })
    fireEvent.pointerUp(window, { pointerId: 22, clientX: 900, clientY: 560 })
    const firstSection = dock.querySelector<HTMLElement>('[data-editor-panel-id="layers"]')?.parentElement
    expect(firstSection?.style.flex).toContain('70%')
  })

  it('停靠面板可拖出为浮窗，并在右边缘按上下顺序重新组合', async () => {
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
    )
    const workspace = rendered.container.querySelector<HTMLElement>('[data-editor-panel-workspace]')
    const properties = rendered.container.querySelector<HTMLElement>(
      '[data-editor-panel-id="properties"]',
    )
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
    const blur = createImageEditEffectLayerV3(
      'blur',
      '高斯模糊',
      'image.gaussian-blur-v2',
      { radius: 24 },
    )
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
    if (updated.type === 'annotation') expect(updated.annotations[0]).toMatchObject({ text: '修改后的文字' })

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
        previewRenderer={interactionPreview}
        onDocumentChange={(next) => changes.push(next)}
      />,
    )
    await waitFor(() => expect(Object.keys(useImageEditorSessionStoreV3.getState().sessions)).toHaveLength(1))
    selectAnnotationInEditor('annotations', 'selected-rect')

    const contextBar = await waitFor(() => rendered.container.querySelector<HTMLElement>(
      '[data-context-bar]',
    ))
    expect(contextBar).toBeTruthy()
    expect((within(contextBar as HTMLElement).getByLabelText('颜色') as HTMLInputElement).value).toBe(
      ANNOTATION_DEFAULT_STROKE_HEX,
    )
    fireEvent.change(within(contextBar as HTMLElement).getByLabelText('颜色'), {
      target: { value: BLACK_HEX },
    })
    await waitFor(() => expect(changes).toHaveLength(1))
    const recolored = changes.at(-1)?.layers[0]
    if (recolored?.type === 'annotation') {
      expect(recolored.annotations[0]).toMatchObject({ stroke: BLACK_HEX, lineWidth: 4 })
    }

    const latestContextBar = rendered.container.querySelector<HTMLElement>('[data-context-bar]')
    fireEvent.change(within(latestContextBar as HTMLElement).getByLabelText('描边'), {
      target: { value: '12' },
    })
    await waitFor(() => expect(changes).toHaveLength(2))
    const restyled = changes.at(-1)?.layers[0]
    if (restyled?.type === 'annotation') {
      expect(restyled.annotations[0]).toMatchObject({ stroke: BLACK_HEX, lineWidth: 12 })
    }
  })
})
