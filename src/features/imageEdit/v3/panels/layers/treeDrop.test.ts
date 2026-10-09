import { describe, expect, it } from 'vitest'
import { createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { flattenImageEditLayerTreeV3 } from '../../editor/layerTreeV3'
import { resolveImageEditLayerMovesV3 } from './treeDrop'

describe('图层树拖动位置适配', () => {
  it('多选剪贴链拖入组保持基底顺序，只输出一次领域移动', () => {
    const group = createImageEditGroupLayerV3('group', '组')
    const layers = [createImageEditRasterLayerV3('base', '基底'), { ...createImageEditRasterLayerV3('clip', '剪贴'), clipping: true }, group]
    const rows = flattenImageEditLayerTreeV3(layers, new Set())
    expect(resolveImageEditLayerMovesV3(rows, 1, 0, ['base', 'clip'])).toEqual([{ layerId: 'base', parentId: 'group', index: 0 }, { layerId: 'clip', parentId: 'group', index: 1 }])
    group.locked = true
    expect(resolveImageEditLayerMovesV3(flattenImageEditLayerTreeV3(layers, new Set()), 1, 0, ['base', 'clip'])).toBeNull()
  })
  it('选组时不重复移动后代，禁止拖入自己的子组', () => {
    const child = createImageEditGroupLayerV3('child', '子组')
    const group = { ...createImageEditGroupLayerV3('group', '组'), children: [child] }
    const rows = flattenImageEditLayerTreeV3([group, createImageEditGroupLayerV3('target', '目标')], new Set(['group']))
    expect(resolveImageEditLayerMovesV3(rows, 1, 2, ['group', 'child'])).toBeNull()
    expect(resolveImageEditLayerMovesV3(rows, 1, 0, ['group', 'child'])).toEqual([{ layerId: 'group', parentId: 'target', index: 0 }])
  })
})
