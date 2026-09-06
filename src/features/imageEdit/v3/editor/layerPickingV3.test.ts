import { describe, expect, it } from 'vitest'
import { createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { mapImageEditTransformPointV3 } from '@/core/imageEdit/v3'
import { createLayerAlphaMapV3, imageEditorLayerContentBoundsV3, pickImageEditorLayerV3, transformImageEditorLayerByHandleV3 } from './layerPickingV3'

function fixture() {
  const document = createImageEditDocumentV3({ width: 100, height: 80 })
  const bottom = createImageEditRasterLayerV3('bottom', '底图', 'bottom-source')
  const top = createImageEditRasterLayerV3('top', '元素', 'top-source')
  document.layers = [bottom, top]
  const maps = new Map([
    ['bottom-source', createLayerAlphaMapV3(1, 1, 100, 80, new Uint8Array([255]))],
    ['top-source', createLayerAlphaMapV3(4, 4, 40, 40, new Uint8Array([
      0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0,
    ]))],
  ])
  return { document, bottom, top, maps }
}

describe('图层像素命中与控制点数学', () => {
  it('控制框忽略 mip 边缘振铃，但不会丢失整体低透明度内容', () => {
    expect(createLayerAlphaMapV3(5, 1, 5, 1, new Uint8Array([1, 2, 255, 2, 1])).bounds)
      .toEqual({ x: 2, y: 0, width: 1, height: 1 })
    expect(createLayerAlphaMapV3(3, 1, 3, 1, new Uint8Array([0, 2, 0])).bounds)
      .toEqual({ x: 1, y: 0, width: 1, height: 1 })
  })
  it('透明区域点穿、尺寸采用各自资源，空白不命中，控制框围住有效内容', () => {
    const { document, maps, top } = fixture()
    expect(pickImageEditorLayerV3(document, [15, 15], maps)).toBe('top')
    expect(pickImageEditorLayerV3(document, [5, 5], maps)).toBe('bottom')
    expect(pickImageEditorLayerV3(document, [70, 15], maps)).toBe('bottom')
    expect(pickImageEditorLayerV3(document, [101, 15], maps)).toBeNull()
    expect(imageEditorLayerContentBoundsV3(top, maps)).toEqual({ x: 10, y: 10, width: 20, height: 20 })
  })
  it.each(['hidden', 'locked', 'transparent'] as const)('%s 图层不参与自动选择', (mode) => {
    const { document, maps, top } = fixture()
    if (mode === 'hidden') top.visible = false
    if (mode === 'locked') top.locked = true
    if (mode === 'transparent') top.opacity = 0
    expect(pickImageEditorLayerV3(document, [15, 15], maps)).toBe('bottom')
  })
  it('祖先变换、裁剪与方向一起逆映射；锁定祖先不能透传编辑', () => {
    const { document, maps, top } = fixture()
    const group = createImageEditGroupLayerV3('group', '组')
    group.transform = [2, 0, 0, 2, 10, 5]
    group.children = [top]
    document.layers = [group]
    document.geometry.orientation.rotate = 90
    // 源点(15,15) → 父组(40,35) → 输出(45,40)。
    expect(pickImageEditorLayerV3(document, [45, 40], maps)).toBe('top')
    group.locked = true
    expect(pickImageEditorLayerV3(document, [45, 40], maps)).toBeNull()
  })
  it('未知上层像素不误选底层；稀疏擦除与反向蒙版改变命中', () => {
    const { document, maps, top } = fixture()
    maps.delete('top-source')
    expect(pickImageEditorLayerV3(document, [15, 15], maps)).toBeUndefined()
    top.tiles = { '0/0/0': 'erased' }
    maps.set('erased', createLayerAlphaMapV3(1, 1, 512, 512, new Uint8Array([0])))
    expect(pickImageEditorLayerV3(document, [15, 15], maps)).toBe('bottom')
    top.tiles = {}
    maps.set('top-source', createLayerAlphaMapV3(1, 1, 40, 40, new Uint8Array([255])))
    top.mask = { resourceId: 'mask', inverted: true }
    maps.set('mask', createLayerAlphaMapV3(1, 1, 40, 40, new Uint8Array([255])))
    expect(pickImageEditorLayerV3(document, [15, 15], maps)).toBe('bottom')
  })
  it('旋转/镜像后的角点缩放仍固定对角锚点，Shift 才自由缩放', () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 }
    const matrix = [0, -2, -3, 0, 200, 300] as const
    const from = mapImageEditTransformPointV3(matrix, 110, 70)
    const to = mapImageEditTransformPointV3(matrix, 160, 70)
    const scaled = transformImageEditorLayerByHandleV3(matrix, bounds, 'se', from, to, false)
    expect(mapImageEditTransformPointV3(scaled, 10, 20)).toEqual(mapImageEditTransformPointV3(matrix, 10, 20))
    expect(scaled.slice(0, 4)).toEqual([0, -3, -4.5, 0])
    expect(transformImageEditorLayerByHandleV3(matrix, bounds, 'se', from, to, true).slice(0, 4)).toEqual([0, -3, -3, 0])
  })
  it('旋转围绕内容中心，取消到原位没有数值漂移，缩放不产生奇异矩阵', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    const matrix = [1, 0, 0, 1, 0, 0] as const
    const rotated = transformImageEditorLayerByHandleV3(matrix, bounds, 'rotate', [50, 0], [100, 50], false)
    const center = mapImageEditTransformPointV3(rotated, 50, 50)
    expect(center[0]).toBeCloseTo(50); expect(center[1]).toBeCloseTo(50)
    expect(rotated[1]).toBeCloseTo(1)
    expect(transformImageEditorLayerByHandleV3(matrix, bounds, 'se', [100, 100], [-500, -500], false)[0]).toBe(0.01)
    expect(transformImageEditorLayerByHandleV3(matrix, bounds, 'se', [100, 100], [100, 100], false)).toEqual(matrix)
  })
})
