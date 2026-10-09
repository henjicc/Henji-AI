// @vitest-environment jsdom
import '@/tests/imageEditDocumentFixture'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import type { DockviewApi } from 'dockview-react'

import i18n from '@/i18n/config'
import { UiEmpty, UiToolbar } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { useImageEditorControllerV3 } from '../editor/useImageEditorControllerV3'
import { ImageEditorPanelRegistryV3, type ImageEditorPanelContextV3 } from '../panelFramework/panelRegistry'
import { createImageEditorMemoryLayoutStoreV3, resetImageEditorDockLayoutV3, type ImageEditorLayoutStoreV3 } from '../panelFramework/layout'
import { getImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import { ImageEditorShellV3 } from './ImageEditorShellV3'

const documentFixture = createImageEditDocumentV3({ documentId: 'shell-test-document', width: 1600, height: 900 })
const visibility = vi.fn()
const previewMount = vi.fn()
function Preview(): JSX.Element {
  useEffect(() => { previewMount() }, [])
  return <div data-testid="shell-preview">图片预览</div>
}
function Body({ visible, controller }: ImageEditorPanelContextV3): JSX.Element {
  return <UiEmpty title={visible ? `文档 ${controller.document.geometry.width}` : '隐藏'} />
}
const registry = new ImageEditorPanelRegistryV3([
  { id: 'layers', title: '图层', titleKey: 'imageEditor.v3.layers.title', order: 0, component: Body, onVisibilityChange: visibility },
  { id: 'properties', title: '属性', titleKey: 'imageEditor.v3.properties.title', order: 1, component: Body },
])
function Harness({ store, onApi, profileId = 'full' }: {
  store?: ImageEditorLayoutStoreV3
  onApi?: (api: DockviewApi | null) => void
  profileId?: 'full' | 'quick'
}): JSX.Element {
  const { controller } = useImageEditorControllerV3({ document: documentFixture, profileId, onDocumentChange: vi.fn() })
  return <div><ImageEditorShellV3 controller={controller} registry={registry} layoutStore={store} onDockApiChange={onApi}
    commandBar={actions => <UiToolbar variant="command" trailing={actions}>图片编辑</UiToolbar>}
    toolRail={<div>工具</div>} preview={<Preview />} /></div>
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  visibility.mockClear(); previewMount.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, 1200, this.classList.contains('dv-tabs-and-actions-container') ? 32 : 800)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('图片 Shell 与面板可见生命周期', () => {
  it('同帧重建面板后内容真正可见且预览保持同一实例', async () => {
    let api: DockviewApi | null = null
    const rendered = render(<Harness onApi={value => { api = value; value?.layout(1200, 800) }} />)
    await screen.findByRole('button', { name: '面板' })
    const dock = api as DockviewApi | null
    if (!dock) throw new Error('Dockview 未就绪')
    const preview = dock.getPanel('preview')
    const definitions = registry.list(getImageEditorHostProfileV3('full'))
    resetImageEditorDockLayoutV3(dock, definitions, definition => definition.title)
    resetImageEditorDockLayoutV3(dock, definitions, definition => definition.title)
    await waitFor(() => {
      const body = rendered.container.querySelector('[data-editor-panel-id="properties"]')
      expect(body?.textContent).toContain('文档 1600')
      expect(body?.closest<HTMLElement>('.dv-render-overlay')?.style.visibility).not.toBe('hidden')
    })
    expect(dock.getPanel('preview')).toBe(preview)
    expect(previewMount).toHaveBeenCalledTimes(1)
  })
  it('关闭、菜单重开、折叠展开和恢复只改视图，保留预览实例', async () => {
    let api: DockviewApi | null = null
    const onApi = (value: DockviewApi | null): void => { api = value; if (value) value.layout(1200, 800) }
    render(<Harness onApi={onApi} />)
    await screen.findByRole('button', { name: '关闭图层面板' })
    expect(previewMount).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '收起图层' }))
    await waitFor(() => expect(visibility.mock.calls.at(-1)?.[0].visible).toBe(false))
    const dock = api as DockviewApi | null
    if (!dock) throw new Error('Dockview 未就绪')
    expect(dock.getPanel('layers')!.group.maximumHeight).toBe(32)
    fireEvent.click(screen.getByRole('button', { name: '展开图层' }))
    await waitFor(() => expect(visibility.mock.calls.at(-1)?.[0].visible).toBe(true))
    expect(dock.getPanel('layers')!.group.maximumHeight).toBe(800)
    fireEvent.click(screen.getByRole('button', { name: '关闭图层面板' }))
    expect(dock.getPanel('layers')).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: '面板' }))
    const reopen = await screen.findByRole('menuitem', { name: '显示图层面板' })
    expect(Number((reopen.closest('[data-ui-overlay-id]') as HTMLElement).style.zIndex)).toBeGreaterThan(Z_LAYERS.modal)
    fireEvent.click(reopen)
    await screen.findByRole('button', { name: '关闭图层面板' })
    fireEvent.click(screen.getByRole('button', { name: '面板' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '恢复默认布局' }))
    expect(dock.panels.map(({ id }) => id)).toEqual(['preview', 'layers', 'properties'])
    expect(previewMount).toHaveBeenCalledTimes(1)
    expect(documentFixture.revision).toBe(0)
  })

  it('布局加载失败显示可恢复错误，仍保留图层和画面', async () => {
    const store: ImageEditorLayoutStoreV3 = { load: () => ({ corrupted: true }), save: vi.fn() }
    const rendered = render(<Harness store={store} />)
    expect(await screen.findByText('面板布局无法恢复，已使用默认布局')).toBeTruthy()
    expect(rendered.container.querySelectorAll('[data-editor-panel-id]')).toHaveLength(2)
    expect(screen.getByTestId('shell-preview')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复默认布局' }))
    expect(screen.queryByText('面板布局无法恢复，已使用默认布局')).toBeNull()
    expect(previewMount).toHaveBeenCalledTimes(1)
  })

  it('替换宿主 profile 重新过滤面板，并释放旧 Dock API 与可见订阅', async () => {
    const onApi = vi.fn()
    const store = createImageEditorMemoryLayoutStoreV3()
    const rendered = render(<Harness store={store} onApi={onApi} />)
    await screen.findByRole('button', { name: '关闭图层面板' })
    rendered.rerender(<Harness store={store} onApi={onApi} profileId="quick" />)
    await screen.findByRole('button', { name: '关闭图层面板' })
    expect(onApi.mock.calls.some(([api]) => api === null)).toBe(true)
    rendered.unmount()
    expect(onApi.mock.calls.at(-1)?.[0]).toBeNull()
    expect(visibility.mock.calls.at(-1)?.[0].visible).toBe(false)
  })
})
