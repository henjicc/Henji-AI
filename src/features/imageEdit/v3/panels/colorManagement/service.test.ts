import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { prepareColorSettingsV3 } from './service';

const boundary = vi.hoisted(() => ({ prepare: vi.fn(), release: vi.fn(), retain: vi.fn() }));
vi.mock('../../smartContent/service', () => ({ prepareSmartContentAppearanceV3: boundary.prepare }));
vi.mock('../../smartContent/resourceLeases', () => ({ retainSmartContentResourcesV3: boundary.retain }));
beforeEach(() => {
  vi.clearAllMocks();
  boundary.retain.mockImplementation((_bus, release) => release);
  boundary.prepare.mockResolvedValue({ source: { kind: 'empty' }, tiles: {}, width: 4, height: 3, bytes: {}, release: boundary.release });
});
const settings = { mode: 'convert', workingSpace: 'display-p3', bitDepth: 16, transferFunction: 'srgb' } as const;
describe('颜色调整共享准备服务', () => {
  it('保留滤镜/锁定原稿、取消准备释放，应用与一次撤销恢复整份文档', async () => {
    const document = createImageEditDocumentV3({ width: 4, height: 3 });
    document.layers = [{ ...createImageEditRasterLayerV3('original', '原图'), locked: true }];
    const bus = new ImageEditCommandBusV3(document);
    const abandoned = await prepareColorSettingsV3(bus, settings); await abandoned.release?.();
    expect(boundary.release).toHaveBeenCalledOnce(); expect(bus.getSnapshot().document).toBe(document);
    const prepared = await prepareColorSettingsV3(bus, settings);
    bus.dispatch(prepared.commands[0]); await prepared.release?.();
    expect(bus.getSnapshot().document.color).toMatchObject({ workingSpace: 'display-p3', bitDepth: 16 });
    const layer = bus.getSnapshot().document.layers[0];
    if (layer.type !== 'smart') throw new Error('缺少可编辑原稿');
    expect(layer.content.document.layers).toEqual(document.layers);
    expect(boundary.retain).toHaveBeenCalledTimes(2);
    bus.undo(); expect(bus.getSnapshot().document.layers).toEqual(document.layers); expect(bus.getSnapshot().document.color).toEqual(document.color);
  });
  it('指定配置复用同一像素核，转换不传指定函数；拒绝过期/取消的结果', async () => {
    const bus = new ImageEditCommandBusV3(createImageEditDocumentV3({ width: 4, height: 3 }));
    const assigned = await prepareColorSettingsV3(bus, { ...settings, mode: 'assign', transferFunction: 'linear' });
    bus.dispatch(assigned.commands[0]);
    const layer = bus.getSnapshot().document.layers[0];
    if (layer.type !== 'smart') throw new Error('缺少指定像素');
    expect(layer.content.document.color.transferFunction).toBe('linear');
    expect(layer.content.document.layers.map(item => [item.type, item.visible])).toEqual([['smart', false], ['raster', true]]);
    const transform = boundary.prepare.mock.calls[0][5];
    const tile = createFloat32PremultipliedRgbaTile(1, 1, 'linear-light', Float32Array.of(.12, .1, .8, .5));
    expect(transform(tile)).toMatchObject({ workingSpace: 'display-p3', transferFunction: 'linear', colorDomain: 'linear-light' });
    expect(transform(tile).data[0]).toBeGreaterThan(tile.data[0]);
    const abort = new AbortController(); abort.abort();
    await expect(prepareColorSettingsV3(bus, settings, { signal: abort.signal })).rejects.toThrow();
    boundary.prepare.mockImplementationOnce(async () => { bus.dispatch({ type: 'document.set-color', commandId: 'race', expectedRevision: bus.getSnapshot().document.revision, color: { ...bus.getSnapshot().document.color, bitDepth: 8 } }); return { source: { kind: 'empty' }, tiles: {}, width: 4, height: 3, bytes: {}, release: boundary.release }; });
    await expect(prepareColorSettingsV3(bus, settings)).rejects.toThrow('原图片已改变');
    expect(boundary.release).toHaveBeenCalled();
  });
});
