/** @vitest-environment jsdom */

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.queryByRole('menuitem', { name: '模糊' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '标注图层' })).toBeNull()
  })

  it('图层菜单只提供发布范围内的扁平图层且 CPU 后备可用时允许辉光 Pro', async () => {
    renderEditor(createDocument([createImageEditRasterLayerV3('raster', '底图')]))

    expect(document.querySelector('[data-tool-id="move"]')?.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(await screen.findByRole('button', { name: '添加图层' }))
    const menu = screen.getByRole('menu', { name: '添加图层' })
    const glow = screen.getByRole('menuitem', { name: '辉光 Pro' }) as HTMLButtonElement
    expect(menu.parentElement?.parentElement?.style.width).toBe('184px')
    expect(glow.className).toContain('justify-start')
    expect(glow.className).toContain('text-left')
    expect(glow.disabled).toBe(false)
    expect(screen.getByRole('menuitem', { name: '模糊' })).toBeTruthy()
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
        '模糊',
        'image.fast-blur-v3',
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
    const preview = document.querySelector<HTMLElement>('[data-preview-surface]')
    expect(preview?.dataset.previewOutputWidth).toBe('1600')
    expect(preview?.dataset.previewOutputHeight).toBe('900')
    fireEvent.click(screen.getByRole('button', { name: '向右旋转 90°' }))
    expect(preview?.dataset.previewOutputWidth).toBe('900')
    expect(preview?.dataset.previewOutputHeight).toBe('1600')
    const width = screen.getByRole('spinbutton', { name: '宽' })
    fireEvent.change(width, { target: { value: '450' } })
    expect(changes).toHaveLength(0)
    expect(preview?.dataset.previewOutputWidth).toBe('900')
    expect(preview?.dataset.previewOutputHeight).toBe('1600')
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
    expect(useImageEditorSessionStoreV3.getState().sessions[Object.keys(
      useImageEditorSessionStoreV3.getState().sessions,
    )[0]]?.activeTool).toBe('move')
    expect(preview?.dataset.previewOutputWidth).toBe('450')
    expect(preview?.dataset.previewOutputHeight).toBe('1600')
  })

  it('裁剪比例收进单一特殊面板并在选择后自动收起', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
      { onDocumentChange: (next) => changes.push(next) },
    )

    fireEvent.click(screen.getByRole('button', { name: '裁剪' }))
    const cropParameters = rendered.container.querySelector<HTMLElement>('[data-crop-parameters]')
    expect(cropParameters).toBeTruthy()
    expect(within(cropParameters as HTMLElement).queryByRole('button', { name: '1:1' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '裁剪比例: 自由' }))
    const ratioMenu = await screen.findByRole('menu', { name: '裁剪比例' })
    expect(within(ratioMenu).getAllByRole('menuitemradio')).toHaveLength(9)
    const squareRatio = within(ratioMenu).getByRole('menuitemradio', { name: '1:1' })
    fireEvent.mouseDown(squareRatio)
    fireEvent.click(squareRatio)

    await waitFor(() => expect(screen.queryByRole('menu', { name: '裁剪比例' })).toBeNull())
    expect(screen.getByRole('button', { name: '裁剪比例: 1:1' })).toBeTruthy()
    expect(Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
      ?.toolSettings.cropAspectRatio).toBe('1:1')
    expect(changes).toHaveLength(0)
  })

  it('效果参数预览合并为一次参数更新命令', async () => {
    const changes: ImageEditDocumentV3[] = []
    renderEditor(
      createDocument([createImageEditEffectLayerV3(
        'blur',
        '模糊',
        'image.fast-blur-v3',
        { radius: 12 },
      )]),
      { onDocumentChange: (next) => changes.push(next) },
    )

    const radius = await screen.findByRole('slider', { name: '半径' })
    fireEvent.change(radius, { target: { value: '24' } })
    fireEvent.change(radius, { target: { value: '48' } })
    expect(changes).toHaveLength(0)
    const liveFeedback = await waitFor(() => {
      const element = document.querySelector('[data-live-blur-feedback="active"]')
      if (!element) throw new Error('模糊拖动没有进入即时反馈状态')
      return element
    })
    expect(document.querySelector('[data-document-clip]')?.contains(liveFeedback)).toBe(true)
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

  it('图层名称双击进入重命名，双击行内其他区域不触发', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '原图')]),
      { onDocumentChange: (next) => changes.push(next) },
    )
    const layerSelect = await waitFor(() => rendered.container.querySelector<HTMLButtonElement>(
      '[data-layer-select]',
    ))
    if (!layerSelect) throw new Error('图层行未挂载')
    fireEvent.doubleClick(layerSelect)
    expect(rendered.container.querySelector('[data-layer-name-input]')).toBeNull()

    const layerName = rendered.container.querySelector<HTMLElement>('[data-layer-name]')
    if (!layerName) throw new Error('图层名称未挂载')
    fireEvent.doubleClick(layerName)
    const input = await screen.findByRole('textbox', { name: '名称' })
    fireEvent.change(input, { target: { value: '背景照片' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].layers[0].name).toBe('背景照片')
  })

  it('图层项本身承担拖拽且不再显示独立拖拽图标', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = renderEditor(
      createDocument([
        createImageEditAnnotationLayerV3('bottom', '下层'),
        createImageEditAnnotationLayerV3('top', '上层'),
      ]),
      { onDocumentChange: (next) => changes.push(next) },
    )
    const rows = await waitFor(() => Array.from(
      rendered.container.querySelectorAll<HTMLElement>('[data-layer-id]'),
    ))
    expect(rows).toHaveLength(2)
    expect(rendered.container.querySelector('[data-layer-drag-handle]')).toBeNull()
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => ({
        x: 0,
        y: index * 44,
        left: 0,
        top: index * 44,
        right: 400,
        bottom: index * 44 + 44,
        width: 400,
        height: 44,
        toJSON: () => ({}),
      }) as DOMRect
    })
    const firstLayer = rows[0].querySelector<HTMLButtonElement>('[data-layer-select]')
    if (!firstLayer) throw new Error('首个图层项未挂载')
    fireEvent.mouseDown(firstLayer, { button: 0, clientX: 200, clientY: 22 })
    fireEvent.mouseMove(window, { clientX: 200, clientY: 52 })
    fireEvent.mouseMove(window, { clientX: 200, clientY: 66 })
    fireEvent.mouseUp(window)

    await waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0].layers.map((layer) => layer.id)).toEqual(['top', 'bottom'])
  })

  it('所有工具参数都留在单命令带内，并保持右侧上下组合的停靠属性窗结构', async () => {
    const rendered = renderEditor(
      createDocument([createImageEditRasterLayerV3('raster', '底图')]),
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-command-bar]')).toBeTruthy())
    const commandBar = rendered.container.querySelector<HTMLElement>('[data-command-bar]')
    expect(rendered.container.querySelectorAll('[data-command-stack]')).toHaveLength(1)
    expect(rendered.container.querySelectorAll('[data-command-bar]')).toHaveLength(1)
    expect(commandBar?.getAttribute('data-document-revision')).toBe('0')
    expect(commandBar?.textContent).not.toMatch(/版本\s*\d+/)
    const moveParameters = rendered.container.querySelector('[data-tool-parameters]')
    expect(moveParameters?.closest('[data-command-bar]')).toBe(commandBar)
    expect(rendered.container.querySelector('[data-context-bar]')).toBeNull()
    const snappingSwitch = screen.getByRole('switch', { name: '吸附' })
    expect(snappingSwitch.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(snappingSwitch)
    expect(Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
      ?.toolSettings.snappingEnabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '标注工具' }))
    const annotationParameters = rendered.container.querySelector('[data-tool-parameters]')
    expect(annotationParameters?.closest('[data-command-bar]')).toBe(commandBar)
    expect(rendered.container.querySelectorAll('[data-tool-parameters]')).toHaveLength(1)

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
    const annotationToolGroup = screen.getByRole('group', { name: '标注类型' })
    expect(annotationToolGroup.querySelectorAll('[data-annotation-tool-id]')).toHaveLength(8)
    expect(annotationToolGroup.textContent).toBe('')
    expect(screen.getByRole('button', { name: '打码' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '矩形标注' }))
    const session = Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
    expect(session.activeTool).toBe('annotation-rect')
    expect(session.toolSettings.annotationTool).toBe('annotation-rect')
  })

  it('属性默认打开参数 Tab，基础 Tab 单独承载名称与通用开关', async () => {
    renderEditor(createDocument([createImageEditEffectLayerV3(
      'blur', '模糊', 'image.fast-blur-v3', { radius: 12 },
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

})
