// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { encodeImageEditSelectionMaskV3 } from '@/core/imageEdit/v3/subjectSelection'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import { copyImageEditRepairSourceV3 } from '@/core/imageEdit/v3/repair'
import type { RepairPixelsRequestV3 } from '../execution/repairPixels.worker'
import type { ImageEditorV3SubjectRequest } from '@/platform/contracts/imageEditorV3'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { selectImageEditRegionV3 } from './imageEditSubjectSelectionServiceV3'
import { imageEditV3LayerRef, imageEditV3DocumentRef } from './imageEditDocumentRefs'

const state = vi.hoisted(() => ({ multiple: false, afterInference: null as (() => void) | null, requests: [] as ImageEditorV3SubjectRequest[] }))
vi.mock('@/commands/imageEditorV3', async original => ({ ...await original<typeof import('@/commands/imageEditorV3')>(),
  pinImageEditorV3RepairResources: vi.fn(async () => undefined), releaseImageEditorV3RepairResources: vi.fn(async () => undefined),
  selectImageEditorV3RasterRegion: async (request: ImageEditorV3SubjectRequest, signal: AbortSignal) => {
    state.requests.push(request); state.afterInference?.(); signal.throwIfAborted()
    return { model: 'efficienttam', providers: ['cpu'], durationMs: 1, inferenceMs: 1, candidates: [
      { id: '1', mask: encodeImageEditSelectionMaskV3(Uint8Array.of(255, 0, 128, 0), 2, 2), score: 0.9, area: 0.4, bounds: { x: 0, y: 0, width: 0.5, height: 1 } },
      ...(state.multiple ? [{ id: '2', mask: encodeImageEditSelectionMaskV3(Uint8Array.of(0, 255, 0, 128), 2, 2), score: 0.8, area: 0.4, bounds: { x: 0.5, y: 0, width: 0.5, height: 1 } }] : []),
    ] }
  },
}))
vi.mock('../editor/rasterBrushTilesV3', () => ({ createImageEditorRasterBrushTileLoaderV3: () => Object.assign(async () => {
  const values = new Float32Array(64 * 32 * 4).fill(1)
  return { resource: null, tile: createFloat32PremultipliedRgbaTile(64, 32, 'linear-light', values) }
}, { resolveStorageSize: async () => ({ width: 64, height: 32 }) }) }))
vi.mock('../execution/repairPixelsClientV3', () => ({ ImageEditRepairPixelsClientV3: class {
  async run(input: RepairPixelsRequestV3, signal: AbortSignal) { signal.throwIfAborted(); if (input.type !== 'source') throw new Error('unexpected'); copyImageEditRepairSourceV3(input.tile, input.origin, input.bitmap); return { bitmap: input.bitmap } }
  dispose() {}
} }))
beforeEach(() => { installHarnessNativeStorage(); state.multiple = false; state.afterInference = null; state.requests = [] })
afterEach(() => { uninstallHarnessNativeStorage() })
function busFor(): ImageEditCommandBusV3 {
  const doc = createImageEditDocumentV3({ width: 64, height: 32, documentId: crypto.randomUUID() }); doc.layers = [createImageEditRasterLayerV3('r', '原图')]; return new ImageEditCommandBusV3(doc)
}
describe('主体选择同源状态闭环', () => {
  it('多主体不改选区，明确选择后可读回并一步撤销；候选不可跨图层或修改后复用', async () => {
    const bus = busFor(); state.multiple = true
    const result = await selectImageEditRegionV3(bus, 'r')
    expect(result.status).toBe('candidates'); expect(bus.getSnapshot().selection).toBeNull(); expect(bus.getSnapshot().history.undoCount).toBe(0)
    await selectImageEditRegionV3(bus, 'r', { candidateId: result.candidates[1].id })
    expect(bus.getSnapshot().selection?.operations[0].shape.type).toBe('mask'); expect(bus.getSnapshot().document.revision).toBe(0)
    bus.undo(); expect(bus.getSnapshot().selection).toBeNull(); bus.redo(); expect(bus.getSnapshot().selection).not.toBeNull()
    await expect(selectImageEditRegionV3(bus, 'r', { candidateId: result.candidates[1].id })).rejects.toThrow('过期')
    bus.dispose()
  })
  it('比例点框进入原生作业，取消/源变化/关闭拒绝迟到结果', async () => {
    const bus = busFor()
    await selectImageEditRegionV3(bus, 'r', { region: { kind: 'point', points: [{ x: 0.5, y: 0.5, foreground: true }] } })
    expect(state.requests[0].region).toEqual({ kind: 'point', points: [{ x: 0.5, y: 0.5, foreground: true }] })
    const count = bus.getSnapshot().history.undoCount
    state.afterInference = () => bus.setSelection(null)
    await expect(selectImageEditRegionV3(bus, 'r')).rejects.toThrow()
    expect(bus.getSnapshot().selection).toBeNull(); expect(bus.getSnapshot().history.undoCount).toBe(count + 1)
    state.multiple = true
    state.afterInference = () => bus.dispose()
    await expect(selectImageEditRegionV3(bus, 'r')).rejects.toThrow()
  })
  it('缩放与平移图层的点/框仍使用文档画面比例，模型遮罩映回同一位置', async () => {
    const doc = createImageEditDocumentV3({ width: 64, height: 32 }), layer = createImageEditRasterLayerV3('r', '原图')
    layer.transform = [0.5, 0, 0, 0.5, 16, 8]; doc.layers = [layer]
    const bus = new ImageEditCommandBusV3(doc)
    await selectImageEditRegionV3(bus, 'r', { region: { kind: 'point', points: [{ x: 0.5, y: 0.5, foreground: true }] } })
    expect(state.requests[0].region).toEqual({ kind: 'point', points: [{ x: 0.5, y: 0.5, foreground: true }] })
    expect(bus.getSnapshot().selection?.operations[0].shape).toMatchObject({ type: 'mask', matrix: [0.5, 0, 0, 0.5, 0.25, 0.25] })
    await selectImageEditRegionV3(bus, 'r', { region: { kind: 'box', x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })
    expect(state.requests[1].region).toEqual({ kind: 'box', x: 0, y: 0, width: 1, height: 1 })
    await expect(selectImageEditRegionV3(bus, 'r', { region: { kind: 'point', points: [{ x: 0.1, y: 0.1, foreground: true }] } })).rejects.toThrow('超出')
    bus.dispose()
  })
  it('正式算法返回选区实体，公共读取反映模型遮罩，写入效果与候选观察区分', async () => {
    const bus = busFor(), doc = bus.getSnapshot().document, dispose = registerPersistedImageEditTestSession('subject-capability', bus)
    try {
      const targetRef = imageEditV3LayerRef(doc.id, 'r'), ref = { ...imageEditV3DocumentRef(doc.id), kind: 'image_edit.selection' }
      const result = await executeApplicationCapabilityResult({ id: 'select_image_edit_region', version: 1, input: { targetRef, region: { kind: 'portrait', quality: 'fast' } } }, { signal: new AbortController().signal, requestId: 'subject-capability' })
      expect(result.ok, JSON.stringify(result)).toBe(true)
      const read = await getApplicationReflectionRegistry().readEntity(ref, undefined, { exposure: 'assistant', permissions: new Set(['image_edit:read']), acceptedDataClasses: new Set(['C0', 'C1']) })
      expect(read.properties['image_edit.selection.region']).toEqual(bus.getSnapshot().selection)
      if (result.ok) expect(result.data.status).toBe('selected')
    } finally { dispose(); bus.dispose() }
  })
})
