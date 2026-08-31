import { describe, expect, it } from 'vitest'

import {
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import {
  canDeleteImageEditLayersV3,
  canDragImageEditLayerRowV3,
  canGroupImageEditLayersV3,
  canUngroupImageEditLayerV3,
  findImageEditLayerLocationV3,
  flattenImageEditLayerTreeV3,
  resolveImageEditLayerDropV3,
} from './layerTreeV3'

describe('Image Editor V3 图层树拖拽解析', () => {
  it('把视觉行命中映射为目标文档容器与索引', () => {
    const bottom = createImageEditRasterLayerV3('bottom', '底图')
    const top = createImageEditRasterLayerV3('top', '上层')
    const rows = flattenImageEditLayerTreeV3([bottom, top], new Set())

    expect(resolveImageEditLayerDropV3(rows, 0, 1)).toEqual({
      layerId: 'top',
      parentId: null,
      index: 0,
    })
  })

  it('拒绝把组拖入自身后代，也拒绝移动锁定组中的子图层', () => {
    const child = createImageEditRasterLayerV3('child', '子图层')
    const group = {
      ...createImageEditGroupLayerV3('group', '图层组'),
      children: [child],
    }
    const expandedRows = flattenImageEditLayerTreeV3([group], new Set(['group']))
    expect(resolveImageEditLayerDropV3(expandedRows, 0, 1)).toBeNull()

    const lockedRows = flattenImageEditLayerTreeV3([
      { ...group, locked: true },
      createImageEditRasterLayerV3('outside', '外部图层'),
    ], new Set(['group']))
    const childIndex = lockedRows.findIndex((row) => row.layer.id === 'child')
    const outsideIndex = lockedRows.findIndex((row) => row.layer.id === 'outside')
    expect(canDragImageEditLayerRowV3(lockedRows[childIndex])).toBe(false)
    expect(resolveImageEditLayerDropV3(lockedRows, childIndex, outsideIndex)).toBeNull()
  })

  it('在命令进入 reducer 前原子预检锁定选择、祖先锁定与解组子层', () => {
    const unlocked = createImageEditRasterLayerV3('unlocked', '未锁定')
    const locked = { ...createImageEditRasterLayerV3('locked', '已锁定'), locked: true }
    const group = {
      ...createImageEditGroupLayerV3('group', '锁定组'),
      locked: true,
      children: [unlocked],
    }
    const layers = [locked, group]

    expect(canDeleteImageEditLayersV3(layers, ['locked', 'unlocked'])).toBe(false)
    expect(canGroupImageEditLayersV3(layers, ['unlocked'])).toBe(false)
    expect(canGroupImageEditLayersV3(layers, ['locked'])).toBe(false)
    expect(canUngroupImageEditLayerV3(findImageEditLayerLocationV3(layers, 'group'))).toBe(false)

    const unlockedGroup = { ...group, locked: false, children: [locked] }
    expect(canUngroupImageEditLayerV3(
      findImageEditLayerLocationV3([unlockedGroup], unlockedGroup.id),
    )).toBe(false)
  })
})
