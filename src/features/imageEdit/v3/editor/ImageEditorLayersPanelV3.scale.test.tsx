/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtuosoMockContext } from 'react-virtuoso'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { getImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorLayersPanelV3 } from './ImageEditorLayersPanelV3'
import type { ImageEditorV3Controller } from './types'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = () => undefined
  useImageEditorSessionStoreV3.setState({ sessions: {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('图层列表规模', () => {
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
