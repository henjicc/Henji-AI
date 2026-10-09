// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { staticRegionContext, type Coverage } from '@/core/imaging/regions';
import { solveSelection, modifySelection, type SelectionPixels } from '@/core/imaging/regions/selectionAlgorithms';
import { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { rasterizeSelectionRequestV3 } from '../../execution/selectionRaster.worker';
import type { SelectionRasterRequestV3 } from '../../execution/selectionRaster.worker';
import { previewAdvancedImageEditSelectionV3, commitAdvancedImageEditSelectionV3, previewImageEditSelectionIntentV3, applyImageEditSelectionPreviewV3 } from './service';
import type { runAdvancedSelectionWorker } from './workerClient';

const resources = vi.hoisted(() => ({ pin: vi.fn(async () => {}), release: vi.fn(async () => {}), afterRead: null as (() => void) | null }));
vi.mock('@/commands/imageEditorV3', async original => ({ ...await original<typeof import('@/commands/imageEditorV3')>(), pinImageEditorV3RepairResources: resources.pin, releaseImageEditorV3RepairResources: resources.release }));
vi.mock('../../editor/rasterBrushTilesV3', () => ({ createImageEditorRasterBrushTileLoaderV3: () => {
  const load = Object.assign(async () => { resources.afterRead?.(); const data = new Float32Array(8 * 4 * 4); for (let i = 0; i < data.length; i += 4) data.set([.1, .1, .1, .5], i); return { tile: createFloat32PremultipliedRgbaTile(8, 4, 'linear-light', data), resource: null }; }, { resolveStorageSize: async () => ({ width: 8, height: 4 }) });
  return load;
} }));
vi.mock('../../execution/selectionRasterClientV3', () => ({ ImageEditSelectionRasterClientV3: class {
  async rasterize(request: SelectionRasterRequestV3) { return rasterizeSelectionRequestV3(request); }
  dispose() {}
} }));
const execute: typeof runAdvancedSelectionWorker = async (request, reader, signal) => {
  const context = staticRegionContext(request.grid, 'test', signal);
  if (request.operation.kind === 'modify') return modifySelection({ grid: request.grid, read: async region => (await reader.read(region, false, signal)).value as Coverage }, request.operation.mode, request.operation.radius, { context, tileSize: 2 });
  return solveSelection({ grid: request.grid, read: async region => {
    const { value, premultiplied } = await reader.read(region, true, signal);
    if (premultiplied) for (let i = 0; i < value.data.length; i += 4) for (let c = 0; c < 3; c++) value.data[i + c] = value.data[i + 3] > 0 ? value.data[i + c] / value.data[i + 3] : 0;
    return value as SelectionPixels;
  } }, request.operation.algorithm, { context, tileSize: 2 });
};
function bus() { const document = createImageEditDocumentV3({ width: 8, height: 4 }); document.layers = [createImageEditRasterLayerV3('raster', '像素图层')]; return new ImageEditCommandBusV3(document); }
afterEach(() => { resources.afterRead = null; vi.clearAllMocks(); });
describe('高级选区唯一领域服务', () => {
  it('预览不写历史，修改保留 float32，编码提交与过期判断由同一总线负责', async () => {
    const port = bus(); port.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: .25, y: .25, width: .5, height: .5 }, 'replace'));
    const before = port.getHistoryView();
    const preview = await previewAdvancedImageEditSelectionV3(port, null, { kind: 'modify', mode: 'smooth', radiusRatio: .25 }, { execute });
    expect(port.getHistoryView()).toEqual(before);
    expect(preview.snapshot.tiles.get('0/0')!.data[3]).toBeCloseTo(2 / 9, 7);
    const encode = vi.fn(() => appendImageEditSelectionV3(null, { type: 'rectangle', x: .1, y: .1, width: .2, height: .2 }, 'replace'));
    commitAdvancedImageEditSelectionV3(port, preview, encode); expect(encode).toHaveBeenCalledWith(preview.snapshot, [1, 0, 0, 1, 0, 0]);
    expect(() => commitAdvancedImageEditSelectionV3(port, preview, encode)).toThrow('已变化'); port.dispose();
  });
  it('正式意图适配保留算法软覆盖率，确认一次撤销并按当前方式组合', async () => {
    const port = bus(); port.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: .25, y: .25, width: .5, height: .5 }, 'replace'));
    const before = port.getSnapshot().selection;
    const preview = await previewImageEditSelectionIntentV3(port, null, { kind: 'modify', mode: 'smooth', radiusRatio: .25 }, 'subtract', { execute });
    expect(port.getSnapshot().selection).toEqual(before);
    expect(preview.result.operations[0].shape).toMatchObject({ type: 'mask' });
    applyImageEditSelectionPreviewV3(port, preview);
    const selection = port.getSnapshot().selection!;
    expect(selection.feather).toBe(0);
    const shape = selection.operations[0].shape;
    if (shape.type !== 'mask') throw new Error('结果必须是覆盖快照');
    expect(shape.runs.some(run => run[2] === Math.fround(2 / 9))).toBe(true);
    port.undo(); expect(port.getSnapshot().selection).toEqual(before); port.dispose();
  });
  it('读取原图层 float32，反预乘由 Worker 执行；取消/切选区清理租约不写入', async () => {
    const port = bus();
    const operation = { kind: 'solve', algorithm: { kind: 'wand', seed: { x: 2, y: 1 }, tolerance: 0, contiguous: true } } as const;
    const preview = await previewAdvancedImageEditSelectionV3(port, 'raster', operation, { execute });
    expect(preview.snapshot.tiles.size).toBe(8); expect(port.getSnapshot().selection).toBeNull();
    expect(resources.pin).toHaveBeenCalledOnce(); expect(resources.release).toHaveBeenCalledOnce();
    resources.afterRead = () => { resources.afterRead = null; port.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: 0, y: 0, width: .2, height: .2 }, 'replace')); };
    await expect(previewAdvancedImageEditSelectionV3(port, 'raster', operation, { execute })).rejects.toThrow();
    expect(resources.release).toHaveBeenCalledTimes(2); expect(port.getSnapshot().selection!.operations[0].shape.type).toBe('rectangle'); port.dispose();
  });
});
