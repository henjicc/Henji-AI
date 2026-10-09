/** @vitest-environment jsdom */
import '@/tests/imageEditDocumentFixture'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import i18n from '@/i18n/config'
import { useImageEditorControllerV3 } from '../../editor/useImageEditorControllerV3'
import { ImageEditorChannelsPanelV3 } from './ImageEditorChannelsPanelV3'
import { ImageEditorPropertiesPanelV3 } from '../../editor/ImageEditorPropertiesPanelV3'
import { requireImageEditDocumentInstanceV3 } from '../../application/imageEditDocumentInstances'
import { useImageEditorSessionStoreV3 } from '../../store'
import { selectImageEditTargetV3 } from '../layers/editTarget'
import { VirtuosoMockContext } from 'react-virtuoso'
import { UiButton } from '@/components/ui'

const document = createImageEditDocumentV3({ width: 320, height: 180, documentId: 'channel-test' })
document.layers = [createImageEditRasterLayerV3('layer', '内容')]
document.layers[0].mask = createImageEditSparseMaskReferenceV3('mask')
function Host(): JSX.Element {
  const { controller } = useImageEditorControllerV3({ document, profileId: 'full', onDocumentChange: () => undefined })
  return <VirtuosoMockContext.Provider value={{ viewportHeight: 264, itemHeight: 44 }}>
    <ImageEditorChannelsPanelV3 controller={controller} />
    <ImageEditorPropertiesPanelV3 controller={controller} />
    <UiButton onClick={controller.undo}>测试撤销</UiButton>
    <UiButton onClick={() => selectImageEditTargetV3(controller, 'layer', 'mask')}>测试蒙版目标</UiButton>
  </VirtuosoMockContext.Provider>
}
beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  useImageEditorSessionStoreV3.setState({ sessions: {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('通道与属性的共同文档工作流', () => {
  it('空态禁用保存；保存、改名、载入、删除及撤销使用同一文档和选区', async () => {
    render(<Host />)
    expect(screen.getByText('还没有选区通道')).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存选区为通道' }) as HTMLButtonElement).disabled).toBe(true)
    const bus = requireImageEditDocumentInstanceV3(document.id).bus
    const selection = appendImageEditSelectionV3(null, { type: 'ellipse', x: .2, y: .2, width: .4, height: .6 }, 'replace')
    act(() => bus.setSelection(selection))
    fireEvent.click(screen.getByRole('button', { name: '保存选区为通道' }))
    expect(bus.getSnapshot().document.namedRegions[0].selection).toEqual(selection)
    const name = screen.getByRole('textbox', { name: '通道名称' })
    fireEvent.change(name, { target: { value: '人像区域' } }); fireEvent.blur(name)
    expect(bus.getSnapshot().document.namedRegions[0].name).toBe('人像区域')
    act(() => bus.setSelection(null))
    fireEvent.click(screen.getByRole('button', { name: '载入通道选区' }))
    expect(bus.getSnapshot().selection).toEqual(selection)
    fireEvent.click(screen.getByRole('button', { name: '删除通道' }))
    expect(bus.getSnapshot().document.namedRegions).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '测试撤销' }))
    expect(bus.getSnapshot().document.namedRegions[0].name).toBe('人像区域')
  })
  it('蒙版焦点切换启用唯一蒙版工具；通用移除与撤销保持有效目标，Esc 取消名称', async () => {
    render(<Host />)
    const bus = requireImageEditDocumentInstanceV3(document.id).bus
    fireEvent.click(screen.getByRole('button', { name: '测试蒙版目标' }))
    let session = Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
    expect(session.editTarget).toBe('mask'); expect(session.activeTool).toBe('mask-edit')
    expect(screen.getByRole('slider', { name: '蒙版密度滑杆' })).toBeTruthy()
    act(() => bus.dispatch({ type: 'layer.set-mask', commandId: 'remove-mask', expectedRevision: bus.getSnapshot().document.revision, layerId: 'layer', mask: null }))
    await waitFor(() => expect(Object.values(useImageEditorSessionStoreV3.getState().sessions)[0].editTarget).toBe('pixels'))
    session = Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
    expect(session.activeTool).toBe('raster-brush')
    fireEvent.click(screen.getByRole('button', { name: '测试撤销' }))
    fireEvent.click(screen.getByRole('tab', { name: '基础' }))
    const name = screen.getByRole('textbox', { name: '名称' })
    fireEvent.focus(name); fireEvent.change(name, { target: { value: '取消名称' } }); fireEvent.keyDown(name, { key: 'Escape' }); fireEvent.blur(name)
    expect(bus.getSnapshot().document.layers[0].name).toBe('内容')
  })
  it('填充滑杆丢失捕获取消预览，连续修改只提交一次命令', async () => {
    render(<Host />)
    const bus = requireImageEditDocumentInstanceV3(document.id).bus
    fireEvent.click(screen.getByRole('tab', { name: '基础' }))
    const slider = screen.getByRole('slider', { name: '填充滑杆' })
    fireEvent.pointerDown(slider); fireEvent.change(slider, { target: { value: '40' } }); fireEvent.lostPointerCapture(slider)
    expect(bus.getSnapshot().previewOverrides).toEqual({})
    expect(bus.getSnapshot().document.revision).toBe(0)
    const next = screen.getByRole('slider', { name: '填充滑杆' })
    fireEvent.pointerDown(next); fireEvent.change(next, { target: { value: '40' } }); fireEvent.change(next, { target: { value: '65' } }); fireEvent.pointerUp(next)
    expect(bus.getSnapshot().document.layers[0].fillOpacity).toBe(.65)
    expect(bus.getHistoryView().total).toBe(1)
  })
})
