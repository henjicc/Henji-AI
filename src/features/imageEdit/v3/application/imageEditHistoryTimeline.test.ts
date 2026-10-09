import { describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import { ImageEditCommandBusV3 } from './imageEditCommandBus';

function fixture() {
  const doc = createImageEditDocumentV3({ width: 100, height: 80, documentId: 'history-timeline' });
  doc.layers = [createImageEditRasterLayerV3('paint', '底图')];
  const saved = vi.fn();
  const bus = new ImageEditCommandBusV3(doc, { onPersistentChange: saved });
  const rename = (name: string): void => { bus.dispatch({ type: 'layer.update-common', commandId: `name-${name}`, expectedRevision: bus.getSnapshot().document.revision, layerId: 'paint', patch: { name } }); };
  return { bus, saved, rename };
}

describe('统一图片历史时间线', () => {
  it('历史缩略图只读求值复用跳转内核，不推进游标或触发保存', async () => {
    const { bus, saved, rename } = fixture(); rename('第一层'); rename('第二层');
    const before = bus.getPersistenceSnapshot(); saved.mockClear();
    expect((await bus.readHistoryDocument(0)).layers[0].name).toBe('底图');
    expect((await bus.readHistoryDocument(1)).layers[0].name).toBe('第一层');
    expect(bus.getPersistenceSnapshot()).toEqual(before); expect(saved).not.toHaveBeenCalled();
  });
  it('分页投影包含当前位置和 transient selection，重开只恢复文档命令', async () => {
    const { bus, rename } = fixture();
    rename('第一层');
    const region = appendImageEditSelectionV3(null, { type: 'rectangle', x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 'replace');
    bus.setSelection(region); rename('第二层');
    expect(bus.readHistoryPage(0).map(row => row.kind)).toEqual(['initial', 'document', 'selection', 'document']);
    await bus.jumpToHistory(1);
    expect(bus.getSnapshot().selection).toBeNull();
    expect(bus.getSnapshot().document.layers[0].name).toBe('第一层');
    expect(bus.getHistoryView()).toMatchObject({ position: 1, total: 3 });
    await bus.jumpToHistory(3);
    expect(bus.getSnapshot().selection).toEqual(region);
    const saved = bus.getPersistenceSnapshot();
    const reopened = new ImageEditCommandBusV3(saved.document, { historySnapshot: saved.history });
    expect(reopened.getHistoryView()).toMatchObject({ position: 2, total: 2 });
    expect(reopened.getSnapshot().selection).toBeNull();
  });
  it('大于 200 条分页跳转一次发布，取消不写文档和历史', async () => {
    const { bus, saved, rename } = fixture();
    for (let index = 0; index < 270; index++) rename(`图层 ${index}`);
    expect(bus.readHistoryPage(256, 16)).toHaveLength(15);
    const before = bus.getPersistenceSnapshot();
    const controller = new AbortController();
    saved.mockClear();
    await expect(bus.jumpToHistory(0, { signal: controller.signal, onProgress: completed => { if (completed === 17) controller.abort(); } })).rejects.toThrow();
    expect(bus.getPersistenceSnapshot()).toEqual(before);
    expect(saved).not.toHaveBeenCalled();
    await bus.jumpToHistory(0);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(bus.getSnapshot().document.layers[0].name).toBe('底图');
    await bus.jumpToHistory(270);
    expect(bus.getSnapshot().document.layers[0].name).toBe('图层 269');
  });
  it('同时继续编辑、清空历史或释放实例时拒绝迟到跳转', async () => {
    for (const action of ['edit', 'clear', 'dispose']) {
      const { bus, rename } = fixture(); rename('已有编辑');
      await expect(bus.jumpToHistory(0, { yieldControl: async () => {
        if (action === 'edit') rename('新编辑'); else if (action === 'clear') bus.clearHistory(); else bus.dispose();
      } })).rejects.toThrow();
      expect(bus.getSnapshot().document.layers[0].name).toBe(action === 'edit' ? '新编辑' : '已有编辑');
    }
  });
  it('逆命令执行失败不移动游标，不发布部分结果，可继续恢复', async () => {
    const { bus, rename, saved } = fixture(); rename('第一层'); rename('第二层');
    const before = bus.getPersistenceSnapshot(); saved.mockClear();
    const original = ImageEditCommandHistoryV3.prototype.getEntryAt;
    const fault = vi.spyOn(ImageEditCommandHistoryV3.prototype, 'getEntryAt').mockImplementationOnce(function (this: ImageEditCommandHistoryV3, index) {
      const entry = structuredClone(original.call(this, index)!);
      entry.inverse = { type: 'layer.delete', commandId: 'bad-inverse', expectedRevision: 0, layerId: 'missing', resources: [] };
      return entry;
    });
    await expect(bus.jumpToHistory(0)).rejects.toThrow(); fault.mockRestore();
    expect(bus.getPersistenceSnapshot()).toEqual(before); expect(saved).not.toHaveBeenCalled();
    await bus.jumpToHistory(0); expect(bus.getSnapshot().document.layers[0].name).toBe('底图');
  });
  it('无操作手势不破坏 redo，真正分叉会删除原分支', async () => {
    const { bus, rename } = fixture(); rename('第一层'); rename('第二层');
    bus.undo();
    bus.setPreview({ id: 'parameter', kind: 'parameter', targetId: 'paint', baseRevision: bus.getSnapshot().document.revision, value: { name: '第一层' } });
    bus.commitPreview('parameter', { type: 'layer.update-common', commandId: 'no-change', expectedRevision: bus.getSnapshot().document.revision, layerId: 'paint', patch: { name: '第一层' } });
    expect(bus.getHistoryView()).toMatchObject({ position: 1, total: 2 });
    expect(bus.getSnapshot().previewOverrides).toEqual({});
    rename('新分支'); expect(bus.getHistoryView()).toMatchObject({ position: 2, total: 2 });
    expect(bus.readHistoryPage(0).map(row => row.key)).not.toContain('name-第二层');
    await expect(bus.jumpToHistory(3)).rejects.toThrow('0～2');
  });
});
