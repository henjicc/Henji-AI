import { describe, expect, it } from 'vitest'

import {
  getImageEditorHostProfileV3,
  getReadyImageEditorToolIdsV3,
} from './imageEditorHostProfiles'

describe('图片编辑 V3 宿主能力裁剪', () => {
  it('完整工具箱只声明已经渲染的侧栏，并明确 HDR 是受限能力', () => {
    const profile = getImageEditorHostProfileV3('full')
    expect(profile).toMatchObject({
      layerKinds: ['raster', 'annotation', 'effect', 'adjustment', 'group'],
      panels: ['layers', 'properties'],
      saveActions: ['save-document', 'save-package', 'export-raster'],
      hdrReadiness: {
        state: 'limited',
        reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
      },
    })
  })

  it('完整宿主接通选择、栅格与蒙版画笔，quick 不暴露选择工具', () => {
    const profile = getImageEditorHostProfileV3('full')

    expect(getReadyImageEditorToolIdsV3(profile)).toEqual([
      'move',
      'hand',
      'zoom',
      'crop',
      'select-rect',
      'select-ellipse',
      'select-lasso',
      'annotation-text',
      'annotation-arrow',
      'annotation-rect',
      'annotation-pen',
      'raster-brush',
      'eraser',
      'mask-edit',
    ])
    expect(getReadyImageEditorToolIdsV3(getImageEditorHostProfileV3('quick')))
      .not.toEqual(expect.arrayContaining(['select-rect', 'select-ellipse', 'select-lasso']))
    expect(getReadyImageEditorToolIdsV3(getImageEditorHostProfileV3('canvas-edit')))
      .toEqual(expect.arrayContaining(['select-rect', 'select-ellipse', 'select-lasso']))
  })

  it('不可可靠导出的辉光效果不允许新建，遮罩宿主只暴露蒙版所需工具', () => {
    const full = getImageEditorHostProfileV3('full')
    expect(full.effects.find(({ id }) => id === 'image.vgpu-glow')).toMatchObject({
      readiness: {
        state: 'disabled',
        reasonKey: 'imageEditor.v3.readiness.reasons.glowExport',
      },
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
