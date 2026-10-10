import { describe, expect, it } from 'vitest'

import {
  getImageEditorHostProfileV3,
  getReadyImageEditorToolIdsV3,
} from './imageEditorHostProfiles'

describe('图片编辑 V3 宿主能力裁剪', () => {
  it('完整宿主开放共享调整和图层组，保留原保存与导出权限', () => {
    const profile = getImageEditorHostProfileV3('full')
    expect(profile).toMatchObject({
      layerKinds: ['raster', 'smart', 'text', 'shape', 'path', 'effect', 'adjustment', 'group'],
      adjustments: ['color_grade', 'exposure', 'curves', 'temperature-tint', 'hsl'],
      panels: ['layers', 'properties', 'history', 'channels', 'adjustments'],
      layerControls: ['blend-mode', 'mask'],
      saveActions: ['save-document', 'export-raster'],
      hdrReadiness: {
        state: 'disabled',
        reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
      },
      allowPackageExternalSources: false,
    })
  })

  it('工具箱与画布节点共享独立选区、画笔和橡皮，保留各自导出权限', () => {
    const profile = getImageEditorHostProfileV3('full')

    expect(getReadyImageEditorToolIdsV3(profile)).toEqual([
      'move',
      'hand',
      'zoom',
      'crop',
      'select-rect', 'select-ellipse', 'select-lasso', 'select-polygon', 'select-brush', 'select-wand', 'select-color-range', 'select-focus', 'select-subject', 'select-subject-box',
      'remove', 'repair',
      'raster-brush',
      'eraser',
      'mask-edit',
      'paint-gradient',
      'paint-fill',
      'clone-stamp', 'healing-brush', 'content-aware-fill',
      'free-transform', 'perspective-transform', 'mesh-transform',
      'vector-text', 'vector-rectangle', 'vector-ellipse', 'vector-arrow', 'vector-callout', 'vector-number', 'vector-path',
    ])
    expect(getReadyImageEditorToolIdsV3(getImageEditorHostProfileV3('canvas-edit')))
      .toEqual(getReadyImageEditorToolIdsV3(profile))
    expect(getImageEditorHostProfileV3('canvas-edit')).toMatchObject({
      saveActions: ['save-document'], adjustments: ['color_grade', 'exposure', 'curves', 'temperature-tint', 'hsl'], layerControls: ['blend-mode', 'mask'],
      hdrReadiness: { state: 'disabled' }, allowPackageExternalSources: false,
    })
    expect(getImageEditorHostProfileV3('quick')).toMatchObject({
      layerKinds: ['text', 'shape', 'path', 'effect'],
      adjustments: [],
    })
  })

  it('新版模糊与其他发布效果都可新建，遮罩兼容宿主只暴露蒙版所需工具', () => {
    const full = getImageEditorHostProfileV3('full')
    expect(full.effects.find(({ id }) => id === 'image.fast-blur-v3')).toMatchObject({
      readiness: { state: 'ready' },
    })
    expect(full.effects.find(({ id }) => id === 'image.vgpu-glow')).toMatchObject({
      readiness: { state: 'ready' },
    })

    const mask = getImageEditorHostProfileV3('mask')
    expect(mask.effects).toEqual([])
    expect(mask.adjustments).toEqual([])
    expect(getReadyImageEditorToolIdsV3(mask)).toEqual([
      'move', 'hand', 'zoom', 'select-rect', 'select-ellipse', 'select-lasso',
      'raster-brush', 'eraser', 'mask-edit', 'paint-gradient', 'paint-fill',
    ])
    expect(mask.saveActions).toEqual(['save-document'])
  })
})
