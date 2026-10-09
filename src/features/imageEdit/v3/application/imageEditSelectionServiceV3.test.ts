// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3, createImageEditAdjustmentLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { applyImageEditSelectionV3, addImageEditLayerWithSelectionV3 } from './imageEditSelectionServiceV3'
import { rasterizeSelectionRequestV3 } from '../execution/selectionRaster.worker'
import type { SelectionRasterRequestV3 } from '../execution/selectionRaster.worker'
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { imageEditV3DocumentRef, imageEditV3LayerRef, imageEditV3FilterRef } from './imageEditDocumentRefs'
import type { ImageEditBrushTileV3 } from '@/core/imageEdit/v3/brush/contracts'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry'
import { exportCurrentImageEditSelectionV3 } from './imageEditSelectionExportV3'
import { createImageEditSparseMaskReferenceV3, isImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'

const storage = vi.hoisted(() => new Map<string, ImageEditBrushTileV3>())
const hooks = vi.hoisted(() => ({ afterPersist: null as (() => void) | null }))
vi.mock('@/commands/imageEditorV3', async importOriginal => {
  const original = await importOriginal<typeof import('@/commands/imageEditorV3')>()
  return { ...original,
    persistImageEditorV3BrushTiles: async (request: { tiles: { tileKey: string; tile: ImageEditBrushTileV3 }[] }) => ({ tiles: request.tiles.map(({ tileKey, tile }) => {
      const resourceId = `sha256:${String(storage.size + 1).padStart(64, '0')}`
      storage.set(resourceId, structuredClone(tile))
      hooks.afterPersist?.()
      return { tileKey, resourceId, byteSize: tile.data.byteLength + 64 }
    }) }),
    readImageEditorV3BrushTiles: async (request: { tiles: { tileKey: string; resource: { resourceId: string } }[] }) => ({ tiles: request.tiles.map(({ tileKey, resource }) => ({ tileKey, tile: structuredClone(storage.get(resource.resourceId)!) })) }),
  }
})
vi.mock('../export/sourceRegion', async importOriginal => {
  const original = await importOriginal<typeof import('../export/sourceRegion')>()
  return { ...original, loadImageEditorV3SourceRegion: async (_ref: string, region: { width: number; height: number }) => createFloat32PremultipliedRgbaTile(region.width, region.height, 'linear-light', new Float32Array(region.width * region.height * 4).fill(0.4)) }
})

vi.mock('../execution/selectionRasterClientV3', () => ({ ImageEditSelectionRasterClientV3: class {
  async rasterize(request: SelectionRasterRequestV3) { return rasterizeSelectionRequestV3(request) }
  dispose() {}
} }))
beforeEach(() => { storage.clear(); hooks.afterPersist = null; installHarnessNativeStorage() })
afterEach(uninstallHarnessNativeStorage)
function createBus() {
  const document = createImageEditDocumentV3({ width: 32, height: 16, documentId: crypto.randomUUID() })
  document.layers = [createImageEditRasterLayerV3('raster', '原图')]
  const bus = new ImageEditCommandBusV3(document)
  bus.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 'replace'))
  return bus
}
function maskPixels(bus: ImageEditCommandBusV3, layerId: string) {
  const mask = bus.getSnapshot().document.layers.find(layer => layer.id === layerId)?.mask
  if (!mask || !isImageEditSparseMaskReferenceV3(mask)) throw new Error('缺少选区蒙版')
  return storage.get(mask.tiles['0/0/0'])!.data
}
describe('独立选区正式消费与通用实体', () => {
  it('自动蒙版调整/效果创建与复制/透明删除均是单次作品命令，撤销复用资源', async () => {
    const bus = createBus()
    const initial = bus.getSnapshot().document
    await addImageEditLayerWithSelectionV3(bus, createImageEditAdjustmentLayerV3('grade', '调整', 'color_grade', {}), null, 1)
    expect(bus.getSnapshot().document.layers[1].mask).not.toBeNull()
    expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(1)
    bus.undo(); expect(bus.getSnapshot().document.layers).toHaveLength(1)
    bus.redo(); expect(bus.getSnapshot().document.layers[1].mask).not.toBeNull()
    const copy = await applyImageEditSelectionV3(bus, 'raster', 'copy')
    expect(copy.layerId).not.toBe('raster')
    expect(bus.getSnapshot().document.layers.find(l => l.id === copy.layerId)?.mask).not.toBeNull()
    expect(maskPixels(bus, copy.layerId)[8 * 32 + 16]).toBe(1)
    expect(maskPixels(bus, copy.layerId)[0]).toBe(0)
    expect(initial.layers[0].mask).toBeNull()
    const deleted = await applyImageEditSelectionV3(bus, 'raster', 'delete')
    expect(deleted.layerId).toBe('raster'); expect(bus.getSnapshot().document.layers[0].mask).not.toBeNull()
    expect(maskPixels(bus, 'raster')[8 * 32 + 16]).toBe(0)
    expect(maskPixels(bus, 'raster')[0]).toBe(1)
    bus.undo(); expect(bus.getSnapshot().document.layers[0].mask).toBeNull()
    bus.dispose()
  })
  it('取消、锁定与过期作品拒绝提交，保持作品与历史', async () => {
    const bus = createBus(), abort = new AbortController(); abort.abort()
    await expect(applyImageEditSelectionV3(bus, 'raster', 'mask', abort.signal)).rejects.toThrow('CANCELLED')
    expect(bus.getSnapshot().document.revision).toBe(0)
    hooks.afterPersist = () => { hooks.afterPersist = null; bus.setSelection(null) }
    await expect(applyImageEditSelectionV3(bus, 'raster', 'mask')).rejects.toThrow('选区已变化')
    expect(bus.getSnapshot().document.revision).toBe(0)
    expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(0)
    bus.dispatch({ type: 'layer.update-common', commandId: 'lock', expectedRevision: 0, layerId: 'raster', patch: { locked: true } })
    await expect(applyImageEditSelectionV3(bus, 'raster', 'mask')).rejects.toThrow('未锁定')
    bus.dispose()
  })
  it('稀疏蒙版沿共享瓦片读取保留覆盖与反相，不绕过原蒙版', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 16, documentId: crypto.randomUUID() })
    const resourceId = `sha256:${'a'.repeat(64)}`
    document.layers = [{ ...createImageEditRasterLayerV3('raster', '原图'), mask: { ...createImageEditSparseMaskReferenceV3('existing', true), tiles: { '0/0/0': resourceId } } }]
    storage.set(resourceId, { storage: 'mask-float32', width: 32, height: 16, data: new Float32Array(32 * 16).fill(.4) })
    const bus = new ImageEditCommandBusV3(document, { resourceByteSizes: { [resourceId]: 32 * 16 * 4 + 64 } })
    bus.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 'replace'))
    await applyImageEditSelectionV3(bus, 'raster', 'delete')
    expect(maskPixels(bus, 'raster')[8 * 32 + 16]).toBe(0)
    expect(maskPixels(bus, 'raster')[0]).toBeCloseTo(0.6)
    bus.undo(); expect(bus.getSnapshot().document.layers[0].mask).toEqual(document.layers[0].mask)
    bus.dispose()
  })
  it('正式算法调用返回可读图层，1.7 导出返回单通道位图与实际 ROI', async () => {
    const bus = createBus(), document = bus.getSnapshot().document
    const dispose = registerPersistedImageEditTestSession('selection-capability', bus)
    try {
      const result = await executeApplicationCapabilityResult({ id: 'apply_image_edit_selection', version: 1, input: { targetRef: imageEditV3LayerRef(document.id, 'raster'), action: 'mask' } }, { signal: new AbortController().signal, requestId: 'selection-capability' })
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      expect(result.data.verification).toEqual({ verified: true })
      const state = await getApplicationReflectionRegistry().readEntity(imageEditV3LayerRef(document.id, 'raster'), undefined, { exposure: 'assistant', permissions: new Set(['image_edit:read']), acceptedDataClasses: new Set(['C0', 'C1']) })
      expect(state.properties['image_edit.layer.mask']).not.toBeNull()
      const iterator = exportCurrentImageEditSelectionV3(bus)
      const tile = await iterator.next()
      if (tile.done) throw new Error('缺少遮罩位图')
      expect(tile.value.bitmap[8 * 32 + 16]).toBe(255); expect(tile.value.bitmap[0]).toBe(0)
      expect(await iterator.next()).toEqual({ done: true, value: { left: 8, top: 4, width: 16, height: 8 } })
    } finally { dispose() }
  })
  it('助手算法确认选区、快照到普通滤镜并原子转换，与人共用状态和撤销', async () => {
    const bus = createBus(), document = bus.getSnapshot().document;
    document.layers[0].filters = [{ id: 'local', effectId: 'exposure', operationType: 'adjustment', enabled: true, params: { stops: .4 }, opacity: 1, blendMode: 'normal', mask: null }];
    const dispose = registerPersistedImageEditTestSession('filter-selection-capability', bus);
    const context = { signal: new AbortController().signal, requestId: 'filter-selection' };
    try {
      const computed = await executeApplicationCapabilityResult({ id: 'compute_image_edit_selection', version: 1, input: { targetRef: imageEditV3LayerRef(document.id, 'raster'), operation: { kind: 'modify', mode: 'feather', radiusRatio: .01 } } }, context);
      expect(computed.ok, JSON.stringify(computed)).toBe(true);
      const applied = await executeApplicationCapabilityResult({ id: 'apply_image_edit_selection', version: 1, input: { targetRef: imageEditV3FilterRef(document.id, 'raster', 'local'), action: 'mask' } }, context);
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      const before = bus.getSnapshot().document.layers[0].filters[0].mask;
      expect(before).not.toBeNull(); bus.setSelection(null);
      expect(bus.getSnapshot().document.layers[0].filters[0].mask).toEqual(before);
      const count = bus.getSnapshot().history.undoCount;
      const converted = await executeApplicationCapabilityResult({ id: 'convert_image_edit_filter_scope', version: 1, input: { targetRef: imageEditV3FilterRef(document.id, 'raster', 'local') } }, context);
      expect(converted.ok, JSON.stringify(converted)).toBe(true);
      expect(bus.getSnapshot().history.undoCount).toBe(count + 1);
      expect(bus.getSnapshot().document.layers).toHaveLength(2);
      bus.undo(); expect(bus.getSnapshot().document.layers).toHaveLength(1);
      expect(bus.getSnapshot().document.layers[0].filters[0].mask).toEqual(before);
    } finally { dispose(); bus.dispose(); }
  })
  it('describe → 通用 change → read 的真实状态闭环，羽化元数据和取消选区可撤销', async () => {
    const bus = createBus(), document = bus.getSnapshot().document
    const dispose = registerPersistedImageEditTestSession('selection-entity', bus)
    try {
      const ref = { ...imageEditV3DocumentRef(document.id), kind: 'image_edit.selection' }
      const access = { exposure: 'assistant' as const, permissions: new Set(['image_edit:read', 'image_edit:write']), acceptedDataClasses: new Set(['C0', 'C1'] as const) }
      const registry = getApplicationReflectionRegistry(), engine = getApplicationControlExecutionEngine()
      const descriptors = registry.describe({ entityTypes: ['image_edit.selection'] }, access)
      expect(descriptors.properties.map(p => p.id)).toContain('image_edit.selection.region')
      const before = await registry.readEntity(ref, undefined, access)
      const value = { ...bus.getSnapshot().selection!, feather: 0.01 }
      const context = { ...access, requestId: 'selection-change' }
      const plan = await engine.plan({ summary: '羽化选区', transactionMode: 'atomic', steps: [{ kind: 'mutation', target: ref, entityType: ref.kind, expectedRevisions: before.revisions,
        mutations: [{ propertyId: 'image_edit.selection.region', operation: 'set', value }] }] }, context)
      const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: before.revisions, idempotencyKey: 'selection-feather' }, context)
      expect(result.status).toBe('completed')
      const after = await registry.readEntity(ref, undefined, access)
      expect(after.properties['image_edit.selection.region']).toEqual(value)
      bus.undo(); expect(bus.getSnapshot().selection?.feather).toBe(0)
    } finally { dispose() }
  })
  it('旋转图层采样选区与原始文档空间一致', () => {
    const bus = createBus()
    const result = rasterizeSelectionRequestV3({ selection: bus.getSnapshot().selection!, size: { width: 32, height: 16 }, region: { x: 0, y: 0, width: 16, height: 16 }, matrix: [0, 1, -1, 0, 24, 0] })
    expect(result[8 * 16 + 8]).toBe(1); expect(result[0]).toBe(0)
    bus.dispose()
  })
})
