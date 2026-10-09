import { describe, expect, it } from 'vitest'
import { createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from './documentFactory'
import { ImageEditCommandHistoryV3 } from './commandHistory'
import { applyImageEditCommandV3 } from './commandReducer'
import { parseImageEditDocumentV3 } from './documentCodec'
import { imageEditNamedRegionsSchemaV3 } from './namedRegions'
import { appendImageEditSelectionV3 } from './selection/session'

describe('图层与命名区域工作流', () => {
  it('剪贴基底和剪贴层跨组同移，持久历史一次撤销和重做', () => {
    const document = createImageEditDocumentV3({ width: 100, height: 80 })
    const base = createImageEditRasterLayerV3('base', '基底')
    const clip = { ...createImageEditRasterLayerV3('clip', '剪贴'), clipping: true }
    const a = { ...createImageEditGroupLayerV3('a', '源组'), children: [base, clip] }
    const b = { ...createImageEditGroupLayerV3('b', '目标组'), children: [createImageEditRasterLayerV3('other', '其他')] }
    document.layers = [a, b]
    const history = new ImageEditCommandHistoryV3()
    const moved = history.execute(document, { type: 'layer.move-many', commandId: 'move', expectedRevision: 0,
      moves: [{ layerId: 'base', parentId: 'b', index: 1 }, { layerId: 'clip', parentId: 'b', index: 2 }] })
    expect(moved.layers).toMatchObject([{ children: [] }, { children: [{ id: 'other' }, { id: 'base' }, { id: 'clip', clipping: true }] }])
    expect(history.createSnapshot().undo).toHaveLength(1)
    const restored = new ImageEditCommandHistoryV3()
    restored.restore(parseImageEditDocumentV3(JSON.parse(JSON.stringify(moved))), JSON.parse(JSON.stringify(history.createSnapshot())))
    const undone = restored.undo(moved).document
    expect(undone.layers).toEqual(document.layers)
    expect(restored.redo(undone).document.layers).toEqual(moved.layers)
  })
  it('拒绝锁组、循环、重复位置和失去剪贴基底；失败不污染源树', () => {
    const document = createImageEditDocumentV3({ width: 10, height: 10 })
    document.layers = [{ ...createImageEditGroupLayerV3('a', '组'), children: [createImageEditRasterLayerV3('base', '基底'), { ...createImageEditRasterLayerV3('clip', '剪贴'), clipping: true }] }, { ...createImageEditGroupLayerV3('locked', '锁组'), locked: true }]
    const move = (moves: Array<{ layerId: string; parentId: string | null; index: number }>) => applyImageEditCommandV3(document, { type: 'layer.move-many', commandId: 'bad', expectedRevision: 0, moves })
    const before = structuredClone(document)
    expect(() => move([{ layerId: 'base', parentId: 'locked', index: 0 }])).toThrow()
    expect(() => move([{ layerId: 'a', parentId: 'a', index: 0 }])).toThrow()
    expect(() => move([{ layerId: 'clip', parentId: null, index: 0 }])).toThrow()
    expect(() => move([{ layerId: 'base', parentId: null, index: 0 }, { layerId: 'clip', parentId: null, index: 0 }])).toThrow()
    expect(document).toEqual(before)
  })
  it('命名区域保存组合、羽化与反选，输入独立、持久读回、重命名及删除可撤销', () => {
    const document = createImageEditDocumentV3({ width: 100, height: 80 })
    const selection = appendImageEditSelectionV3(null, { type: 'rectangle', x: .1, y: .2, width: .5, height: .3 }, 'replace')
    selection.feather = .04; selection.inverted = true
    const regions = [{ id: 'area', name: '主体', selection }]
    const history = new ImageEditCommandHistoryV3()
    const saved = history.execute(document, { type: 'document.set-named-regions', commandId: 'save', expectedRevision: 0, regions })
    selection.feather = .9
    expect(saved.namedRegions[0].selection.feather).toBe(.04)
    expect(parseImageEditDocumentV3(JSON.parse(JSON.stringify(saved))).namedRegions).toEqual(saved.namedRegions)
    const renamed = history.execute(saved, { type: 'document.set-named-regions', commandId: 'rename', expectedRevision: 1, regions: [{ ...saved.namedRegions[0], name: ' 人像 ' }] })
    expect(renamed.namedRegions[0].name).toBe('人像')
    const deleted = history.execute(renamed, { type: 'document.set-named-regions', commandId: 'delete', expectedRevision: 2, regions: [] })
    const restored = new ImageEditCommandHistoryV3(); restored.restore(deleted, JSON.parse(JSON.stringify(history.createSnapshot())))
    expect(restored.undo(deleted).document.namedRegions).toEqual(renamed.namedRegions)
    expect(imageEditNamedRegionsSchemaV3.safeParse([regions[0], regions[0]]).success).toBe(false)
    expect(imageEditNamedRegionsSchemaV3.safeParse([{ ...regions[0], name: ' ' }]).success).toBe(false)
    const { namedRegions: _regions, ...incomplete } = saved
    expect(() => parseImageEditDocumentV3(incomplete)).toThrow()
  })
})
