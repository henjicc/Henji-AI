import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_LINE_WIDTH_PERCENT,
  DEFAULT_TEXT_SIZE_PERCENT,
} from '@/core/imageEdit/marks/metrics'
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

  it('标注样式预设以图片短边百分比保存', () => {
    useImageEditorSessionStoreV3.getState().ensureSession('editor', ['vector-text'])

    const settings = useImageEditorSessionStoreV3.getState().sessions.editor.toolSettings
    expect(settings.annotationLineWidthPercent).toBe(DEFAULT_LINE_WIDTH_PERCENT)
    expect(settings.annotationTextSizePercent).toBe(DEFAULT_TEXT_SIZE_PERCENT)
  })

})
