import { describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { rasterizePaintFill } from '@/core/imaging/paint';
import { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { fillImageEditTargetV3 } from './fillService';
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes';

function fixture(mask = false) {
  const document = createImageEditDocumentV3({ width: 513, height: 2, documentId: 'fill-test' });
  const layer = createImageEditRasterLayerV3('layer', '绘画');
  if (mask) layer.mask = createImageEditSparseMaskReferenceV3('mask', false, 0);
  document.layers = [layer];
  const bus = new ImageEditCommandBusV3(document), worker = { fill: vi.fn(async (...args: Parameters<typeof rasterizePaintFill>) => rasterizePaintFill(...args)), dispose: vi.fn() };
  const persist = vi.fn(async (tiles: readonly { tileKey: string }[]) => tiles.map(tile => ({ tileKey: tile.tileKey, resourceId: `sha256:${(tile.tileKey.endsWith('1/0') ? 'b' : 'a').repeat(64)}`, byteSize: 90 })));
  return { bus, options: { worker, persist, pin: vi.fn(async () => {}), release: vi.fn(async () => {}) } };
}
describe('分块填充正式命令', () => {
  it.each([false, true])('像素/蒙版目标 %s 每次只保存一块，最后一条历史可撤销重做', async mask => {
    const { bus, options } = fixture(mask);
    await fillImageEditTargetV3(bus, 'layer', mask ? 'mask' : 'pixels', { kind: 'solid', target: mask ? { kind: 'mask', value: .7 } : { kind: 'rgba', color: [2, .2, 0, 1] } }, .5, options);
    expect(options.persist).toHaveBeenCalledTimes(2);
    expect(options.persist.mock.calls.every(call => call[0].length === 1)).toBe(true);
    expect(bus.getSnapshot().history.undoCount).toBe(1);
    const committed = bus.getSnapshot().document.layers[0];
    expect(bus.undo()).toBe(true); expect(bus.getSnapshot().history.redoCount).toBe(1);
    expect(bus.redo()).toBe(true); expect(bus.getSnapshot().document.layers[0]).toEqual(committed);
    expect(options.release).toHaveBeenCalledOnce(); expect(options.worker.dispose).toHaveBeenCalledOnce();
  });
  it('取消或中途落盘失败不提交任何瓦片或历史', async () => {
    for (const mode of ['cancel', 'fail']) {
      const { bus, options } = fixture(); const abort = new AbortController();
      options.persist.mockImplementationOnce(async () => { if (mode === 'cancel') abort.abort(); throw new Error('中止'); });
      await expect(fillImageEditTargetV3(bus, 'layer', 'pixels', { kind: 'solid', target: { kind: 'rgba', color: [1, 0, 0, 1] } }, 1, { ...options, signal: abort.signal })).rejects.toThrow();
      expect(bus.getSnapshot().document.revision).toBe(0); expect(bus.getSnapshot().history.undoCount).toBe(0); expect(options.release).toHaveBeenCalledOnce();
    }
  });
  it('无变化不写入、不清空重做，图层锁定禁止填充', async () => {
    const { bus, options } = fixture();
    expect(await fillImageEditTargetV3(bus, 'layer', 'pixels', { kind: 'solid', target: { kind: 'rgba', color: [0, 0, 0, 0] } }, 1, options)).toBeNull();
    expect(options.persist).not.toHaveBeenCalled(); expect(bus.getSnapshot().history.undoCount).toBe(0);
    const locked = fixture(); locked.bus.getSnapshot().document.layers[0].locked = true;
    await expect(fillImageEditTargetV3(locked.bus, 'layer', 'pixels', { kind: 'solid', target: { kind: 'rgba', color: [1, 0, 0, 1] } }, 1, locked.options)).rejects.toThrow('无法填充');
    expect(locked.options.pin).not.toHaveBeenCalled();
  });
});
