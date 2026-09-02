import { beforeEach, describe, expect, it } from 'vitest'

import {
  useImageEditorInteractionStoreV3,
  useImageEditorSessionStoreV3,
} from './index'

describe('ImageEditor V3 session stores', () => {
  beforeEach(() => {
    useImageEditorSessionStoreV3.setState({ sessions: {} })
    useImageEditorInteractionStoreV3.setState({
      layerDragBySession: {},
      viewportZoomBySession: {},
      viewportPanBySession: {},
      annotationSelectionBySession: {},
      annotationPreviewBySession: {},
    })
  })

  it('隔离不同编辑器的会话状态并在关闭时清理', () => {
    const store = useImageEditorSessionStoreV3.getState()
    store.ensureSession('full-session', ['move', 'crop'], 'layer-a')
    store.ensureSession('mask-session', ['raster-brush', 'mask-edit'], 'layer-b')
    store.setActiveTool('full-session', 'crop')
    store.setSelectedLayerIds('mask-session', ['layer-c'])

    expect(useImageEditorSessionStoreV3.getState().sessions['full-session'].activeTool).toBe('crop')
    expect(useImageEditorSessionStoreV3.getState().sessions['mask-session'].activeTool).toBe('raster-brush')
    expect(useImageEditorSessionStoreV3.getState().sessions['mask-session'].selectedLayerIds).toEqual(['layer-c'])

    useImageEditorSessionStoreV3.getState().disposeSession('full-session')
    expect(useImageEditorSessionStoreV3.getState().sessions['full-session']).toBeUndefined()
    expect(useImageEditorSessionStoreV3.getState().sessions['mask-session']).toBeTruthy()
  })

  it('高频拖拽和视口缩放不进入持久会话', () => {
    useImageEditorSessionStoreV3.getState().ensureSession('editor', ['move'])
    const interaction = useImageEditorInteractionStoreV3.getState()
    interaction.beginLayerDrag('editor', 'layer-a')
    interaction.setLayerDragTarget('editor', 'layer-b')
    interaction.setViewportZoom('editor', 20)
    interaction.setViewportPan('editor', { x: 36, y: -24 })
    interaction.selectAnnotation('editor', { layerId: 'layer-a', annotationId: 'mark-a' })

    expect(useImageEditorInteractionStoreV3.getState().layerDragBySession.editor).toEqual({
      layerId: 'layer-a',
      overLayerId: 'layer-b',
    })
    expect(useImageEditorInteractionStoreV3.getState().viewportZoomBySession.editor).toBe(8)
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession.editor).toEqual({
      x: 36,
      y: -24,
    })
    expect(useImageEditorSessionStoreV3.getState().sessions.editor).not.toHaveProperty('zoom')
    expect(useImageEditorSessionStoreV3.getState().sessions.editor).not.toHaveProperty('layerDrag')
    expect(useImageEditorInteractionStoreV3.getState().annotationSelectionBySession.editor).toEqual({
      layerId: 'layer-a',
      annotationId: 'mark-a',
    })

    interaction.clearViewport('editor')
    expect(useImageEditorInteractionStoreV3.getState().viewportPanBySession.editor).toBeUndefined()
    expect(useImageEditorInteractionStoreV3.getState().annotationSelectionBySession.editor).toBeUndefined()
  })
})
