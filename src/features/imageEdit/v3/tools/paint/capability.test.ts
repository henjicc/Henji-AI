// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHITE_HEX } from '@/core/theme/colorTokens';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import type { ImageEditBrushTileV3 } from '@/core/imageEdit/v3/brush/contracts';
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage';
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession';
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry';
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry';
import { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { imageEditV3LayerRef } from '../../application/imageEditDocumentRefs';
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes';
import { rasterizeSelectionRequestV3, type SelectionRasterRequestV3 } from '../../execution/selectionRaster.worker';

const storage = vi.hoisted(() => new Map<string, ImageEditBrushTileV3>());
const leases = vi.hoisted(() => new Map<string, readonly string[]>());
const hooks = vi.hoisted(() => ({ persisted: null as (() => void) | null }));
function copyTile(tile: ImageEditBrushTileV3): ImageEditBrushTileV3 { return { ...tile, data: new Float32Array(tile.data) }; }
vi.mock('@/commands/imageEditorV3', async load => {
  const original = await load<typeof import('@/commands/imageEditorV3')>();
  return { ...original, pinImageEditorV3RepairResources: async (id: string, ids: readonly string[]) => { leases.set(id, [...ids]); }, releaseImageEditorV3RepairResources: async (id: string) => { leases.delete(id); }, persistImageEditorV3BrushTiles: async (request: { tiles: { tileKey: string; tile: ImageEditBrushTileV3 }[] }) => ({ tiles: request.tiles.map(({ tileKey, tile }) => {
    const resourceId = `sha256:${String(storage.size + 1).padStart(64, '0')}`; storage.set(resourceId, copyTile(tile)); hooks.persisted?.();
    return { tileKey, resourceId, byteSize: tile.data.byteLength + 64 };
  }) }), readImageEditorV3BrushTiles: async (request: { tiles: { tileKey: string; resource: { resourceId: string } }[] }) => ({ tiles: request.tiles.map(({ tileKey, resource }) => ({ tileKey, tile: copyTile(storage.get(resource.resourceId)!) })) }) };
});
vi.mock('./workerClient', async () => {
  const { rasterizePaintDabs, rasterizePaintFill } = await import('@/core/imaging/paint');
  const { rasterizeRetouchDabs } = await import('@/core/imaging/retouch');
  return { PaintWorkerClient: class {
    rasterize = async (...args: Parameters<typeof rasterizePaintDabs>) => rasterizePaintDabs(...args);
    fill = async (...args: Parameters<typeof rasterizePaintFill>) => rasterizePaintFill(...args);
    retouch = async (...args: Parameters<typeof rasterizeRetouchDabs>) => rasterizeRetouchDabs(...args);
    dispose(): void {}
  } };
});
vi.mock('../../execution/selectionRasterClientV3', () => ({ ImageEditSelectionRasterClientV3: class {
  async rasterize(request: SelectionRasterRequestV3) { return rasterizeSelectionRequestV3(request); }
  dispose(): void {}
} }));
beforeEach(() => { storage.clear(); leases.clear(); hooks.persisted = null; installHarnessNativeStorage(); });
afterEach(uninstallHarnessNativeStorage);
describe('绘画正式助手与人同源', () => {
  it.each(['clone', 'heal'] as const)('正式 %s 明确取样进入唯一像素历史，不依赖窗口预设，旧源固定且租约释放', async kind => {
    const document = createImageEditDocumentV3({ width: 32, height: 16, documentId: crypto.randomUUID() }), layer = createImageEditRasterLayerV3('raster', '纹理');
    document.layers = [layer]; const originalId = `sha256:${'a'.repeat(64)}`, original = new Float32Array(32 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) original.set([x < 16 ? .1 : (x % 4) / 4, .1, .1, 1], (y * 32 + x) * 4);
    const { createFloat32PremultipliedRgbaTile } = await import('@/core/imageEdit/v3/effects/contracts');
    storage.set(originalId, createFloat32PremultipliedRgbaTile(32, 16, 'linear-light', original)); layer.tiles = { '0/0/0': originalId };
    const bus = new ImageEditCommandBusV3(document, { resourceByteSizes: { [originalId]: original.byteLength + 64 } }), dispose = registerPersistedImageEditTestSession('retouch-capability', bus);
    try {
      const result = await executeApplicationCapabilityResult({ id: 'paint_image_edit_target', version: 1, input: {
        targetRef: imageEditV3LayerRef(document.id, layer.id), destination: 'pixels', operation: { kind, source: { x: .75, y: .5 }, points: [{ x: .25, y: .5 }, { x: .4, y: .5 }], sizeRatio: .3, hardness: 1, opacity: 1, flow: 1 },
      } }, { requestId: 'retouch', signal: new AbortController().signal });
      expect(result.ok, JSON.stringify(result)).toBe(true); if (result.ok) expect(result.data.verification).toEqual({ verified: true });
      expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(1); expect(leases.size).toBe(0);
      expect(storage.get(originalId)?.data).toEqual(original); expect([...storage.values()].at(-1)?.data).not.toEqual(original);
      bus.undo(); expect(bus.getSnapshot().document.layers[0]).toMatchObject({ tiles: { '0/0/0': originalId } });
    } finally { dispose(); bus.dispose(); }
  });
  it('助手笔划使用同一覆盖核，压感意图与整笔透明度进入单条正式历史', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 16, documentId: crypto.randomUUID() }); document.layers = [createImageEditRasterLayerV3('raster', '绘画')];
    const bus = new ImageEditCommandBusV3(document), dispose = registerPersistedImageEditTestSession('paint-stroke', bus);
    try {
      const result = await executeApplicationCapabilityResult({ id: 'paint_image_edit_target', version: 1, input: { targetRef: imageEditV3LayerRef(document.id, 'raster'), operation: {
        kind: 'stroke', color: WHITE_HEX, opacity: .3, flow: .5, hardness: 1, sizeRatio: .5, pressureSize: false,
        points: [{ x: .25, y: .5, pressure: .2 }, { x: .75, y: .5, pressure: 1 }, { x: .25, y: .5, pressure: .8 }],
      } } }, { requestId: 'stroke', signal: new AbortController().signal });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(bus.getSnapshot().history.undoCount).toBe(1);
      const tile = [...storage.values()][0]; expect(tile.data[(8 * 32 + 16) * 4 + 3]).toBeLessThanOrEqual(Math.fround(.3));
      expect(tile.data[(8 * 32 + 16) * 4 + 3]).toBeGreaterThan(.2);
      expect(bus.undo()).toBe(true);
    } finally { dispose(); }
  });
  it.each(['pixels', 'mask'] as const)('目标 %s 带选区填充后正式读回、资源验证与撤销', async destination => {
    const document = createImageEditDocumentV3({ width: 32, height: 16, documentId: crypto.randomUUID() });
    const layer = createImageEditRasterLayerV3('raster', '绘画'); layer.mask = createImageEditSparseMaskReferenceV3('mask', false, 0); document.layers = [layer];
    const bus = new ImageEditCommandBusV3(document);
    bus.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: .25, y: .25, width: .5, height: .5 }, 'replace'));
    const dispose = registerPersistedImageEditTestSession('paint-capability', bus);
    try {
      const result = await executeApplicationCapabilityResult({ id: 'paint_image_edit_target', version: 1, input: { targetRef: imageEditV3LayerRef(document.id, layer.id), destination, operation: { kind: 'solid', color: WHITE_HEX, maskValue: .7 } } }, { signal: new AbortController().signal, requestId: 'paint' });
      expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(result.error.message);
      expect(result.data.verification).toEqual({ verified: true }); expect(result.data.changed).toBe(true);
      expect(result.data.ref).toMatchObject({ kind: destination === 'pixels' ? 'image_edit.layer' : 'image_edit.mask' });
      const pixels = [...storage.values()][0].data;
      const channels = destination === 'pixels' ? 4 : 1;
      expect(pixels[(8 * 32 + 16) * channels]).toBeCloseTo(destination === 'pixels' ? 1 : .7); expect(pixels[0]).toBe(0);
      const read = await getApplicationReflectionRegistry().readEntity(imageEditV3LayerRef(document.id, layer.id), undefined, { exposure: 'assistant', permissions: new Set(['image_edit:read']), acceptedDataClasses: new Set(['C0', 'C1']) });
      expect(read.properties['image_edit.layer.name']).toBe('绘画'); expect(bus.getPersistenceSnapshot().history.undo.filter(entry => entry.forward.type === (destination === 'pixels' ? 'raster.apply-tile-delta' : 'mask.apply-tile-delta'))).toHaveLength(1);
      expect(bus.undo()).toBe(true); expect(bus.redo()).toBe(true);
    } finally { dispose(); }
  });
  it('保存期间选区变动拒绝提交，作品和历史保持原样', async () => {
    const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: crypto.randomUUID() }); document.layers = [createImageEditRasterLayerV3('raster', '绘画')];
    const bus = new ImageEditCommandBusV3(document), dispose = registerPersistedImageEditTestSession('paint-stale', bus);
    hooks.persisted = () => bus.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: 0, y: 0, width: .5, height: .5 }, 'replace'));
    try {
      const result = await executeApplicationCapabilityResult({ id: 'paint_image_edit_target', version: 1, input: { targetRef: imageEditV3LayerRef(document.id, 'raster'), operation: { kind: 'solid', color: WHITE_HEX } } }, { requestId: 'stale', signal: new AbortController().signal });
      expect(result.ok).toBe(false); expect(bus.getSnapshot().document.revision).toBe(0); expect(bus.getPersistenceSnapshot().history.undo.some(entry => entry.forward.type === 'raster.apply-tile-delta')).toBe(false);
    } finally { dispose(); }
  });
});
