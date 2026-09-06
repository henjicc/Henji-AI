import { expect, it } from 'vitest'
import { createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from './documentFactory'
import { createImageEditSparseMaskReferenceV3 } from './layerTypes'
import { collectImageEditResourceRolesV3 } from './resourceRoles'
import { ImageEditCommandHistoryV3 } from './commandHistory'

it('隐藏组、普通图片蒙版与稀疏蒙版共享唯一字段遍历', () => {
  const document = createImageEditDocumentV3({ width: 64, height: 64 })
  const raster = createImageEditRasterLayerV3('raster', '图片', 'image')
  raster.tiles = { '0/0/0': 'rgba' }
  raster.mask = { resourceId: 'image-mask', inverted: false }
  const group = createImageEditGroupLayerV3('group', '组')
  group.visible = false
  group.children = [raster]
  group.mask = { ...createImageEditSparseMaskReferenceV3('mask'), tiles: { '0/0/0': 'sparse-mask' } }
  document.layers = [group]
  const roles = collectImageEditResourceRolesV3(document)
  expect([...roles.images]).toEqual(['image-mask', 'image'])
  expect([...roles.sparse]).toEqual([['sparse-mask', 'mask-float32'], ['rgba', 'rgba-float32']])
})

it('已删除图层只在真实逆命令中保留brush；不把所有history resources推断为brush', () => {
  let document = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'history' })
  const layer = createImageEditRasterLayerV3('raster', '图片', 'image')
  layer.tiles = { '0/0/0': 'brush' }
  const history = new ImageEditCommandHistoryV3()
  document = history.execute(document, { type: 'layer.add', commandId: 'add', expectedRevision: 0,
    parentId: null, index: 0, layer, resources: [{ resourceId: 'brush', byteSize: 200 }, { resourceId: 'image', byteSize: 100 }] })
  document = history.execute(document, { type: 'layer.delete', layerId: 'raster', commandId: 'delete', expectedRevision: 1,
    resources: [{ resourceId: 'brush', byteSize: 200 }, { resourceId: 'image', byteSize: 100 }] })
  expect(document.layers).toEqual([])
  expect([...collectImageEditResourceRolesV3(document, history.createSnapshot()).sparse]).toEqual([['brush', 'rgba-float32']])
})

it('同一引用不能被同时声明为图片和brush或两种稀疏存储', () => {
  const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: 'image' })
  const raster = document.layers[0]
  if (raster.type !== 'raster') throw new Error('fixture')
  raster.tiles = { '0/0/0': 'image' }
  expect(() => collectImageEditResourceRolesV3(document)).toThrow('同时作为')
  raster.tiles = { '0/0/0': 'brush' }
  raster.mask = { ...createImageEditSparseMaskReferenceV3('mask'), tiles: { '0/0/0': 'brush' } }
  expect(() => collectImageEditResourceRolesV3(document)).toThrow('存储类型冲突')
})
