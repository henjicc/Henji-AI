/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtuosoMockContext } from 'react-virtuoso'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { getImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorLayersPanelV3 } from './ImageEditorLayersPanelV3'
import type { ImageEditorV3Controller } from './types'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { ImageEditorHistoryPanelV3 } from '../panels/history/ImageEditorHistoryPanelV3'

const thumbnailSessions = vi.hoisted(() => ({
  ports: [] as Pick<ImageEditorV3Controller, 'sessionId' | 'historyPort' | 'historyResourceDescriptors'>[],
  dispose: vi.fn(),
}))
vi.mock('../panels/thumbnails', () => ({ ImageEditThumbnailsV3: class {
  constructor(port: Pick<ImageEditorV3Controller, 'sessionId' | 'historyPort' | 'historyResourceDescriptors'>) { thumbnailSessions.ports.push(port) }
  readDocument = vi.fn(async () => 'thumbnail.png')
  read = vi.fn(async () => 'thumbnail.png')
  dispose = thumbnailSessions.dispose
} }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = () => undefined
  useImageEditorSessionStoreV3.setState({ sessions: {} })
  thumbnailSessions.ports.length = 0
  vi.clearAllMocks()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('图层列表规模', () => {
  it('图层和历史缓存跨元数据资源更新复用，并在会话切换时释放', async () => {
    const document = createImageEditDocumentV3({ width: 100, height: 100, documentId: 'thumbnail-cache' })
    document.layers = [createImageEditRasterLayerV3('layer', '图层')]
    const bus = new ImageEditCommandBusV3(document)
    const controller = { sessionId: 'thumbnail-cache', document, profile: getImageEditorHostProfileV3('full'), historyPort: bus,
      historyResourceDescriptors: [], moveLayer: vi.fn(), updateLayerCommon: vi.fn(), deleteLayer: vi.fn() } as unknown as ImageEditorV3Controller
    const panels = (value: ImageEditorV3Controller) => <VirtuosoMockContext.Provider value={{ viewportHeight: 264, itemHeight: 44 }}>
      <ImageEditorLayersPanelV3 controller={value} /><ImageEditorHistoryPanelV3 controller={value} visible />
    </VirtuosoMockContext.Provider>
    const view = render(panels(controller))
    expect(thumbnailSessions.ports).toHaveLength(2)
    const descriptors: NonNullable<ImageEditorV3Controller['historyResourceDescriptors']> = [{ resourceRef: `sha256:${'a'.repeat(64)}`, byteLength: 4096, mediaType: 'application/json' }]
    view.rerender(panels({ ...controller, document: { ...document, revision: 1 }, historyResourceDescriptors: descriptors }))
    expect(thumbnailSessions.ports).toHaveLength(2)
    expect(thumbnailSessions.ports.map(port => port.historyResourceDescriptors)).toEqual([descriptors, descriptors])
    expect(thumbnailSessions.dispose).not.toHaveBeenCalled()
    view.rerender(panels({ ...controller, sessionId: 'next-thumbnail-cache' }))
    await act(async () => undefined)
    expect(thumbnailSessions.ports).toHaveLength(4)
    expect(thumbnailSessions.dispose).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => undefined)
    expect(thumbnailSessions.dispose).toHaveBeenCalledTimes(4)
    bus.dispose()
  })

  it('2000 层只挂载视口行，Ctrl/Shift 选择使用完整行序列', async () => {
    const document = createImageEditDocumentV3({ width: 100, height: 100, documentId: 'scale' })
    document.layers = Array.from({ length: 2000 }, (_, index) => createImageEditRasterLayerV3(`layer-${index}`, `图层${index}`))
    const controller = { sessionId: 'scale', document, profile: getImageEditorHostProfileV3('full'), moveLayer: vi.fn(), updateLayerCommon: vi.fn(), deleteLayer: vi.fn() } as unknown as ImageEditorV3Controller
    useImageEditorSessionStoreV3.getState().ensureSession('scale', controller.profile.tools.map(tool => tool.id))
    const view = render(<VirtuosoMockContext.Provider value={{ viewportHeight: 264, itemHeight: 44 }}><ImageEditorLayersPanelV3 controller={controller} /></VirtuosoMockContext.Provider>)
    const buttons = () => view.container.querySelectorAll('[data-layer-select]')
    await waitFor(() => expect(buttons().length).toBeGreaterThan(1))
    expect(buttons().length).toBeLessThan(30)
    fireEvent.click(buttons()[0])
    fireEvent.click(buttons()[1], { ctrlKey: true })
    expect(useImageEditorSessionStoreV3.getState().sessions.scale.selectedLayerIds).toEqual(['layer-1999', 'layer-1998'])
    fireEvent.click(buttons()[3], { shiftKey: true })
    expect(useImageEditorSessionStoreV3.getState().sessions.scale.selectedLayerIds).toHaveLength(4)
    act(() => useImageEditorSessionStoreV3.getState().setSelectedLayerIds('scale', ['layer-0']))
    expect(useImageEditorSessionStoreV3.getState().sessions.scale.selectedLayerIds).toEqual(['layer-0'])
  })
})
