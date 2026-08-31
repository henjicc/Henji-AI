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

  it('已接通栅格画笔和橡皮擦，其他未接通工具只提供稳定翻译键', () => {
    const profile = getImageEditorHostProfileV3('full')
    const readiness = Object.fromEntries(profile.tools.map((tool) => [tool.id, tool.readiness]))

    expect(getReadyImageEditorToolIdsV3(profile)).toEqual([
      'move',
      'crop',
      'annotation-text',
      'annotation-arrow',
      'annotation-rect',
      'annotation-pen',
      'raster-brush',
      'eraser',
    ])
    for (const toolId of [
      'hand',
      'zoom',
      'select-rect',
      'select-ellipse',
      'select-lasso',
      'mask-edit',
    ]) {
      expect(readiness[toolId]).toMatchObject({
        state: 'disabled',
        reasonKey: expect.stringMatching(/^imageEditor\.v3\.readiness\.reasons\./),
      })
      expect(readiness[toolId]).not.toHaveProperty('reason')
    }
  })

  it('不可可靠导出的辉光效果不允许新建，遮罩宿主也不会宣称工具已可用', () => {
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
    expect(getReadyImageEditorToolIdsV3(mask)).toEqual(['move', 'raster-brush', 'eraser'])
    expect(mask.saveActions).toEqual(['save-document'])
  })
})
