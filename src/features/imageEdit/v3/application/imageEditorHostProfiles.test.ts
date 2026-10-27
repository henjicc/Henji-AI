import { describe, expect, it } from 'vitest'

import {
  getImageEditorHostProfileV3,
  getReadyImageEditorToolIdsV3,
} from './imageEditorHostProfiles'

describe('图片编辑 V3 宿主能力裁剪', () => {
  it('完整宿主保留原保存与导出权限', () => {
    const profile = getImageEditorHostProfileV3('full')
    expect(profile).toMatchObject({
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

    expect(getReadyImageEditorToolIdsV3(profile)).toEqual(expect.arrayContaining(['select-rect', 'raster-brush', 'eraser']))
    expect(getReadyImageEditorToolIdsV3(getImageEditorHostProfileV3('canvas-edit')))
      .toEqual(getReadyImageEditorToolIdsV3(profile))
    expect(getImageEditorHostProfileV3('canvas-edit')).toMatchObject({
      saveActions: ['save-document'], adjustments: profile.adjustments, layerControls: profile.layerControls,
      hdrReadiness: { state: 'disabled' }, allowPackageExternalSources: false,
    })
    // 受限宿主是白名单：新增工具或图层种类默认不能漏进来，所以这里钉死完整清单。
    expect(getImageEditorHostProfileV3('quick')).toMatchObject({ layerKinds: ['text', 'shape', 'path', 'effect'], adjustments: [] })
    expect(getReadyImageEditorToolIdsV3(getImageEditorHostProfileV3('quick'))).toEqual(expect.arrayContaining(['select-rect', 'select-brush', 'mask-edit']))
    expect(getImageEditorHostProfileV3('quick').effects).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mosaic', readiness: { state: 'ready' } })]))
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
    expect(getReadyImageEditorToolIdsV3(mask)).toEqual([
      'move', 'hand', 'zoom', 'select-rect', 'select-ellipse', 'select-lasso',
      'raster-brush', 'eraser', 'mask-edit', 'paint-gradient', 'paint-fill',
    ])
    expect(mask.effects).toEqual([])
    expect(mask.adjustments).toEqual([])
    expect(mask.saveActions).toEqual(['save-document'])
  })
})
