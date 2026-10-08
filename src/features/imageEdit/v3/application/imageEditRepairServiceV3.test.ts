// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import { copyImageEditRepairSourceV3, mergeImageEditRepairPatchV3 } from '@/core/imageEdit/v3/repair'
import type { RepairPixelsRequestV3 } from '../execution/repairPixels.worker'
import type { SelectionRasterRequestV3 } from '../execution/selectionRaster.worker'
import { rasterizeSelectionRequestV3 } from '../execution/selectionRaster.worker'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { repairImageEditRegionV3 } from './imageEditRepairServiceV3'
import { removeImageEditRegionCapability, repairImageEditRegionCapability } from '@/core/application-control/domains/imageEdit/imageEditRepairCapabilities'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { imageEditV3LayerRef, imageEditV3DocumentRef } from './imageEditDocumentRefs'
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry'

const state = vi.hoisted(() => ({ calls: [] as { width: number; sample: boolean; quality: string }[], afterWrite: null as (() => void) | null, fail: false, serial: 0 }))
vi.mock('@/commands/imageEditorV3', async original => ({ ...await original<typeof import('@/commands/imageEditorV3')>(),
  pinImageEditorV3RepairResources: vi.fn(async () => undefined), releaseImageEditorV3RepairResources: vi.fn(async () => undefined),
  repairImageEditorV3Raster: async (request: { width: number; sample?: ArrayBuffer; quality: string }, signal: AbortSignal) => {
    signal.throwIfAborted(); if (state.fail) throw new Error('fixture inference failed')
    state.calls.push({ width: request.width, sample: !!request.sample, quality: request.quality })
    return { patch: { resourceRef: `sha256:${'a'.repeat(64)}`, byteLength: 64, mediaType: 'image/png' }, durationMs: 1 }
  },
  persistImageEditorV3BrushTiles: async (request: { tiles: { tileKey: string; tile: { data: Float32Array } }[] }) => {
    state.afterWrite?.(); return { tiles: request.tiles.map(tile => ({ tileKey: tile.tileKey, resourceId: `sha256:${String(++state.serial).padStart(64, '0')}`, byteSize: tile.tile.data.byteLength + 64 })) }
  },
}))
vi.mock('../editor/rasterBrushTilesV3', () => ({ createImageEditorRasterBrushTileLoaderV3: ({ document, layer, resourceByteSizes }: { document: { geometry: { width: number; height: number } }; layer: { tiles: Record<string, string> }; resourceByteSizes: ReadonlyMap<string, number> }) => {
  const load = async ({ x, y }: { x: number; y: number }) => {
    const width = Math.min(512, document.geometry.width - x * 512), height = Math.min(512, document.geometry.height - y * 512)
    const resourceId = layer.tiles[`0/${x}/${y}`]
    return { resource: resourceId ? { resourceId, byteSize: resourceByteSizes.get(resourceId) ?? 0 } : null, tile: createFloat32PremultipliedRgbaTile(width, height, 'linear-light', new Float32Array(width * height * 4).fill(0.5)) }
  }
  return Object.assign(load, { resolveStorageSize: async () => document.geometry })
} }))
vi.mock('../export/sourceRegion', () => ({ loadImageEditorV3SourceRegion: async (_ref: string, region: { width: number; height: number }) => createFloat32PremultipliedRgbaTile(region.width, region.height, 'linear-light', new Float32Array(region.width * region.height * 4).fill(0.8)) }))
vi.mock('../execution/selectionRasterClientV3', () => ({ ImageEditSelectionRasterClientV3: class { async rasterize(request: SelectionRasterRequestV3) { return rasterizeSelectionRequestV3(request) } dispose() {} } }))
vi.mock('../execution/repairPixelsClientV3', () => ({ ImageEditRepairPixelsClientV3: class {
  async run(input: RepairPixelsRequestV3, signal: AbortSignal) {
    signal.throwIfAborted()
    if (input.type === 'merge') return { data: mergeImageEditRepairPatchV3(input.tile, input.origin, input.patch, input.bitmap, input.guide) }
    if (input.type === 'mask') input.bitmap.mask = Uint8Array.from(input.coverage, v => Math.round(v * 255))
    else copyImageEditRepairSourceV3(input.tile, input.origin, input.bitmap)
    return { bitmap: input.bitmap }
  }
  dispose() {}
} }))
beforeEach(() => { installHarnessNativeStorage(); state.calls = []; state.fail = false; state.serial = 0; state.afterWrite = null })
afterEach(uninstallHarnessNativeStorage)
function busFor(width = 1200) {
  const doc = createImageEditDocumentV3({ width, height: 128, documentId: crypto.randomUUID() })
  doc.layers = [createImageEditRasterLayerV3('raster', '原图')]
  const bus = new ImageEditCommandBusV3(doc)
  bus.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: 0.1, y: 0.2, width: 0.8, height: 0.5 }, 'replace'))
  return bus
}
describe('区域修复同源事务', () => {
  it('跨三个瓦片的大选区只推理一次、保留独立选区、一步撤销与重做', async () => {
    const bus = busFor(), before = bus.getSnapshot()
    const result = await repairImageEditRegionV3(bus, 'raster', { action: 'remove' })
    expect(result.patchCount).toBe(3); expect(state.calls).toHaveLength(1); expect(state.calls[0].width).toBeLessThanOrEqual(640)
    expect(bus.getSnapshot().selection).toEqual(before.selection)
    expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(1)
    bus.undo(); expect(bus.getSnapshot().document.layers).toEqual(before.document.layers)
    bus.redo(); expect(bus.getSnapshot().document.layers[0].type).toBe('raster'); bus.dispose()
  })
  it('取消、算法失败与结果过期不产生作品命令；重试可恢复', async () => {
    const bus = busFor(32), signal = AbortSignal.abort()
    await expect(repairImageEditRegionV3(bus, 'raster', { action: 'remove', signal })).rejects.toThrow()
    state.fail = true
    await expect(repairImageEditRegionV3(bus, 'raster', { action: 'remove' })).rejects.toThrow('fixture inference failed')
    state.fail = false; state.afterWrite = () => { state.afterWrite = null; bus.setSelection(null) }
    await expect(repairImageEditRegionV3(bus, 'raster', { action: 'remove' })).rejects.toThrow()
    expect(bus.getSnapshot().document.revision).toBe(0); expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(0)
    await repairImageEditRegionV3(bus, 'raster', { action: 'remove', rectangle: { x: 0.2, y: 0.2, width: 0.4, height: 0.1 } })
    expect(state.calls.at(-1)?.quality).toBe('blemish'); expect(bus.getSnapshot().document.revision).toBe(1); bus.dispose()
  })
  it('正式能力区分移除与来源修补，返回可读文档并进入同一历史', async () => {
    const bus = busFor(64), doc = bus.getSnapshot().document, dispose = registerPersistedImageEditTestSession('repair-capability', bus)
    const targetRef = imageEditV3LayerRef(doc.id, 'raster')
    try {
      const context = { signal: new AbortController().signal, requestId: 'repair-capability' }
      const result = await executeApplicationCapabilityResult({ id: removeImageEditRegionCapability.id, version: 1, input: { targetRef, region: { kind: 'selection', ref: { ...imageEditV3DocumentRef(doc.id), kind: 'image_edit.selection' } } } }, context)
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (result.ok) { expect(result.data.documentRef).toEqual(imageEditV3DocumentRef(doc.id)); expect(result.data.verification).toEqual({ verified: true }) }
      const repair = await executeApplicationCapabilityResult({ id: repairImageEditRegionCapability.id, version: 1, input: { targetRef, region: { kind: 'rectangle', x: 0.1, y: 0.2, width: 0.2, height: 0.2 }, sourceRegion: { x: 0.7, y: 0.6 } } }, context)
      expect(repair.ok, JSON.stringify(repair)).toBe(true); expect(state.calls.at(-1)?.sample).toBe(true)
      expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(2)
    } finally { dispose(); bus.dispose() }
  })
})
