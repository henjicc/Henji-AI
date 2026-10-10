import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { prepareDocumentGeometryV3, publishDocumentGeometryPreviewV3, commitDocumentGeometryV3 } from './service';
const fake = vi.hoisted(() => ({ release: vi.fn(async () => undefined), persist: vi.fn(), retained: vi.fn(), disposed: vi.fn() }));
vi.mock('../../smartContent/service', () => ({ prepareSmartContentAppearanceV3: async (document: { geometry: { width: number; height: number } }) => ({ source: { kind: 'empty' }, tiles: { '0/0/0': `sha256:${'1'.repeat(64)}` }, ...document.geometry, bytes: { [`sha256:${'1'.repeat(64)}`]: 192 }, release: fake.release }) }));
vi.mock('../../smartContent/resourceLeases', () => ({ retainSmartContentResourcesV3: fake.retained }));
vi.mock('@/commands/imageEditorV3', () => ({
  readImageEditorV3BrushTiles: async (request: { tiles: { tileKey: string }[] }) => ({ tiles: [{ tileKey: request.tiles[0].tileKey, tile: createFloat32PremultipliedRgbaTile(4, 3, 'linear-light', Float32Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? .5 : .2)) }] }),
  describeImageEditorV3SourcePyramid: vi.fn(),
  createImageEditorV3RequestId: () => 'read', pinImageEditorV3RepairResources: async () => undefined, releaseImageEditorV3RepairResources: async () => undefined,
  persistImageEditorV3BrushTiles: fake.persist,
}));
vi.mock('./workerClient', async () => {
  const { createGeometryWorkerOperations } = await import('./geometry.worker');
  return { GeometryWorkerClient: class { operations = createGeometryWorkerOperations(); async run(request: Parameters<ReturnType<typeof createGeometryWorkerOperations>>[0], signal: AbortSignal, progress?: (done: number, total: number) => void) { signal.throwIfAborted(); return this.operations(request, progress); } dispose = fake.disposed; } };
});
let bus: ImageEditCommandBusV3;
beforeEach(() => {
  vi.clearAllMocks(); const document = createImageEditDocumentV3({ width: 4, height: 3 }); document.layers = [createImageEditRasterLayerV3('pixels', '原稿')]; bus = new ImageEditCommandBusV3(document);
  fake.persist.mockImplementation(async (request: { tiles: { tileKey: string; tile: { data: Float32Array } }[] }) => ({ tiles: request.tiles.map(value => ({ tileKey: value.tileKey, resourceId: `sha256:${'2'.repeat(64)}`, byteSize: value.tile.data.byteLength + 80 })) }));
});
afterEach(() => bus.dispose());
describe('尺寸服务的预览、保护区、取消与同一历史', () => {
  it('左上扩边预览不写文档，应用与撤销一起移动/恢复当前选区，旧结果拒绝发布', async () => {
    const selection = appendImageEditSelectionV3(null, { type: 'rectangle', x: .25, y: 0, width: .5, height: 1 }, 'replace'); bus.setSelection(selection);
    const before = bus.getSnapshot().document, draft = await prepareDocumentGeometryV3(bus, { mode: 'canvas', width: 8, height: 6, anchor: 'bottom-right' });
    publishDocumentGeometryPreviewV3(bus, draft); expect(bus.getSnapshot().document).toBe(before); expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(0);
    expect(bus.getSnapshot().selection).toEqual(selection); expect(bus.getSnapshot().previewOverrides['document-geometry'].selectionPreview).toEqual(draft.selection);
    commitDocumentGeometryV3(bus, draft); expect(bus.getSnapshot().selection?.operations[0].shape).toMatchObject({ x: .625, y: .5, width: .25, height: .5 });
    expect(bus.getSnapshot().document.layers[0].transform).toEqual([1, 0, 0, 1, 4, 3]);
    bus.undo(); expect(bus.getSnapshot().selection).toEqual(selection); expect(bus.getSnapshot().document.geometry).toEqual(before.geometry);
    expect(() => publishDocumentGeometryPreviewV3(bus, draft)).toThrow('改变');
    bus.redo(); expect(bus.getSnapshot().selection).toEqual(draft.selection);
  });
  it('普通非等比缩放保留原稿，把笔刷及羽化映射为同采样的软覆盖', async () => {
    bus.setSelection({ ...appendImageEditSelectionV3(null, { type: 'brush', points: [{ x: .5, y: .5 }], radius: .3 }, 'replace'), feather: .05 });
    const draft = await prepareDocumentGeometryV3(bus, { mode: 'resample', width: 8, height: 3 });
    expect(draft.selection?.operations[0].shape).toMatchObject({ type: 'mask', width: 8, height: 3 });
    expect(draft.document.layers[0]).toMatchObject({ type: 'smart', transform: [2, 0, 0, 1, 0, 0], content: { width: 4, height: 3, document: { layers: [{ id: 'pixels' }] } } });
    await draft.release(); expect(fake.release).toHaveBeenCalledOnce(); expect(fake.disposed).toHaveBeenCalled();
  });
  it('内容识别像素、alpha 与命名/当前保护区共用位移，应用一个历史命令', async () => {
    const selection = appendImageEditSelectionV3(null, { type: 'rectangle', x: .5, y: 0, width: .25, height: 1 }, 'replace'); bus.setSelection(selection);
    const draft = await prepareDocumentGeometryV3(bus, { mode: 'content-aware', width: 3, height: 3 });
    expect(fake.persist).toHaveBeenCalledOnce(); const pixels = fake.persist.mock.calls[0][0].tiles[0].tile.data as Float32Array;
    expect([...pixels].filter((_, i) => i % 4 === 3)).toEqual(Array(9).fill(.5));
    expect(draft.selection?.operations[0].shape).toMatchObject({ type: 'mask', width: 3, height: 3 });
    commitDocumentGeometryV3(bus, draft); expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(1); expect(fake.retained).toHaveBeenCalled();
  });
  it('取消、保护区缺失、非法尺寸和写入失败均不发布半成品并释放租约', async () => {
    const before = bus.getSnapshot().document, controller = new AbortController(); controller.abort();
    await expect(prepareDocumentGeometryV3(bus, { mode: 'canvas', width: 8, height: 3 }, { signal: controller.signal })).rejects.toThrow();
    await expect(prepareDocumentGeometryV3(bus, { mode: 'content-aware', width: 3, height: 3 })).rejects.toThrow('保护');
    await expect(prepareDocumentGeometryV3(bus, { mode: 'canvas', width: 0, height: 3 })).rejects.toThrow();
    fake.persist.mockRejectedValueOnce(new Error('写入失败'));
    await expect(prepareDocumentGeometryV3(bus, { mode: 'content-aware', width: 3, height: 3, protectSelection: false })).rejects.toThrow('写入失败');
    expect(bus.getSnapshot().document).toBe(before); expect(fake.release).toHaveBeenCalledOnce(); expect(fake.disposed).toHaveBeenCalled();
  });
});
