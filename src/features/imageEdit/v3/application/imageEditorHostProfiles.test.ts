import { describe, expect, it } from 'vitest'

import {
  getImageEditorHostProfileV3,
  getReadyImageEditorToolIdsV3,
} from './imageEditorHostProfiles'

describe('图片编辑 V3 宿主能力裁剪', () => {
  it('发布版完整工具箱只开放扁平图层、内部保存和 8 位栅格导出入口', () => {
    const profile = getImageEditorHostProfileV3('full')
    expect(profile).toMatchObject({
      layerKinds: ['raster', 'effect'],
      adjustments: [],
      panels: ['layers', 'properties'],
      layerControls: [],
      saveActions: ['save-document', 'export-raster'],
      hdrReadiness: {
        state: 'disabled',
        reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
      },
      allowPackageExternalSources: false,
    })
  })

  it('工具箱和画布宿主只开放导航、裁剪与可编辑标注工具', () => {
    const profile = getImageEditorHostProfileV3('full')

    expect(getReadyImageEditorToolIdsV3(profile)).toEqual([
      'move',
      'hand',
      'zoom',
      'crop',
      'annotation-text',
      'annotation-callout',
      'annotation-arrow',
      'annotation-rect',
      'annotation-ellipse',
      'annotation-number',
      'annotation-pen',
    ])
    expect(getReadyImageEditorToolIdsV3(getImageEditorHostProfileV3('canvas-edit')))
      .toEqual(getReadyImageEditorToolIdsV3(profile))
    expect(getImageEditorHostProfileV3('quick')).toMatchObject({
      layerKinds: ['effect'],
      adjustments: [],
    })
  })

  it('三种发布效果都可新建，遮罩兼容宿主只暴露蒙版所需工具', () => {
    const full = getImageEditorHostProfileV3('full')
    expect(full.effects.find(({ id }) => id === 'image.vgpu-glow')).toMatchObject({
      readiness: { state: 'ready' },
    })

    const mask = getImageEditorHostProfileV3('mask')
    expect(mask.effects).toEqual([])
    expect(mask.adjustments).toEqual([])
    expect(getReadyImageEditorToolIdsV3(mask)).toEqual([
      'move', 'hand', 'zoom', 'select-rect', 'select-ellipse', 'select-lasso',
      'raster-brush', 'eraser', 'mask-edit',
    ])
    expect(mask.saveActions).toEqual(['save-document'])
  })
})
