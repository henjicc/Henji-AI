import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentAddressedResourceStore } from '../resource-store';
import { ImageEditHistoryPageStoreV3 } from './store';
import { ImageEditCommandHistoryV3 } from '../../../../../src/core/imageEdit/v3/commandHistory';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../../../../../src/core/imageEdit/v3/documentFactory';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) await fsp.rm(dir, { recursive: true, force: true }); });
async function fixture(count = 260) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-history-pages-')); directories.push(dir);
  const resources = new ContentAddressedResourceStore(dir);
  await resources.initialize();
  const store = new ImageEditHistoryPageStoreV3(resources);
  const history = new ImageEditCommandHistoryV3();
  let document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'paged-history' });
  document.layers = [createImageEditRasterLayerV3('layer', '底图')];
  for (let index = 0; index < count; index++) document = history.execute(document, {
    type: 'layer.update-common', commandId: `rename-${index}`, expectedRevision: document.revision,
    layerId: 'layer', patch: { name: `操作 ${index}` },
  });
  return { resources, store, history, document };
}

describe('磁盘历史分页／检查点', () => {
  it('冷页游标移动不读写页，截断页保持连续索引并可恢复 redo', async () => {
    const f = await fixture(130);
    const first = await f.store.prepare(f.history.createSnapshot());
    const cold = await f.store.open(first.checkpoint);
    await first.release();
    const put = vi.spyOn(f.resources, 'putBufferLeased');
    const verify = vi.spyOn(f.resources, 'verify');
    cold.cold!.position = 65;
    const moved = await f.store.prepare(cold);
    expect(put).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
    expect(moved.checkpoint.pages).toEqual(first.checkpoint.pages);
    expect((await f.store.restore(moved.checkpoint)).redo).toHaveLength(65);
    await moved.release();
    cold.cold!.prefixLength = 65;
    put.mockClear(); verify.mockClear();
    const truncated = await f.store.prepare(cold);
    expect(truncated.checkpoint).toMatchObject({ total: 65, position: 65 });
    expect(truncated.checkpoint.pages.map(page => page.count)).toEqual([64, 1]);
    expect(put).toHaveBeenCalledOnce(); expect(verify).toHaveBeenCalledOnce();
    expect((await f.store.restore(truncated.checkpoint)).undo).toHaveLength(65);
    await truncated.release();
  });

  it('截断带像素资源的冷历史重建精确引用，不保留丢弃分支资源', async () => {
    const f = await fixture(0);
    const a = await f.resources.putBuffer(Buffer.from([1, 2, 3, 255]));
    const b = await f.resources.putBuffer(Buffer.from([4, 5, 6, 255]));
    for (const [index, resource] of [a, b].entries()) {
      if (index) for (let rename = 0; rename < 65; rename++) {
        f.document = f.history.execute(f.document, { type: 'layer.update-common',
          commandId: `rename-${rename}`, expectedRevision: f.document.revision,
          layerId: 'layer', patch: { name: `重命名 ${rename}` } });
      }
      f.document = f.history.execute(f.document, { type: 'raster.apply-tile-delta',
        commandId: `pixel-${index}`, expectedRevision: f.document.revision, layerId: 'layer',
        changes: [{ tileKey: '0/0/0', previousResourceId: index ? a.id : null,
          previousByteSize: index ? 4 : 0, resourceId: resource.id, byteSize: 4 }] });
    }
    const first = await f.store.prepare(f.history.createSnapshot());
    const cold = await f.store.open(first.checkpoint); await first.release();
    cold.cold!.prefixLength = 65; cold.cold!.position = 65;
    const put = vi.spyOn(f.resources, 'putBufferLeased');
    const prepared = await f.store.prepare(cold);
    expect(prepared.checkpoint.resources).toEqual([{ resourceId: a.id, byteSize: 4 }]);
    expect(prepared.checkpoint.pages[0]).toEqual(first.checkpoint.pages[0]);
    expect(put).toHaveBeenCalledOnce();
    expect((await f.store.restore(prepared.checkpoint)).undo).toHaveLength(65);
    await f.store.validate(prepared.checkpoint); await prepared.release();
  });

  it('逐次保存冷化后复用整页并合并未满末页，完整恢复全部命令', async () => {
    const f = await fixture(0);
    const put = vi.spyOn(f.resources, 'putBufferLeased');
    const verify = vi.spyOn(f.resources, 'verify');
    let checkpoint: Awaited<ReturnType<typeof f.store.prepare>>['checkpoint'] | undefined;
    const commandIds: string[] = [];
    for (let index = 0; index < 130; index++) {
      f.document = f.history.execute(f.document, { type: 'layer.update-common',
        commandId: `save-${index}`, expectedRevision: f.document.revision,
        layerId: 'layer', patch: { name: `保存 ${index}` } });
      commandIds.push(`save-${index}`);
      put.mockClear(); verify.mockClear();
      const prepared = await f.store.prepare(f.history.createSnapshot());
      checkpoint = prepared.checkpoint;
      expect(put.mock.calls.length).toBeLessThanOrEqual(2);
      expect(verify.mock.calls.length).toBeLessThanOrEqual(1);
      expect(checkpoint.pages.length).toBeLessThanOrEqual(Math.ceil((index + 1) / 64));
      f.history.restore(f.document, { version: checkpoint.snapshotVersion, documentId: f.document.id,
        headRevision: f.document.revision, undo: [], redo: [], cold: { checkpoint,
          prefixLength: checkpoint.total, position: checkpoint.position, commandIds: [...commandIds],
          resourceRoles: { images: [], sparse: [] } } });
      await prepared.release();
    }
    const restored = new ImageEditCommandHistoryV3();
    restored.restore(f.document, await f.store.restore(checkpoint));
    for (let index = 0; index < 130; index++) f.document = restored.undo(f.document).document;
    expect(f.document.layers[0].name).toBe('底图');
  });

  it('历史页和实际像素资源共同保护，单页读取拒绝未登记的像素引用', async () => {
    const f = await fixture(0);
    const pixel = await f.resources.putBuffer(Buffer.from([10, 20, 30, 255]), { mediaType: 'application/octet-stream', maxBytes: 4 });
    f.document = f.history.execute(f.document, { type: 'raster.apply-tile-delta', commandId: 'pixel-edit', expectedRevision: 0,
      layerId: 'layer', changes: [{ tileKey: '0/0/0', previousResourceId: null, previousByteSize: 0, resourceId: pixel.id, byteSize: 4 }] });
    const prepared = await f.store.prepare(f.history.createSnapshot());
    expect(prepared.resourceIds).toContain(pixel.id);
    expect((await f.resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted).toEqual([]);
    await expect(f.store.readPage({ ...prepared.checkpoint, resources: [] }, 0)).rejects.toThrow('未登记');
    await prepared.release();
    expect((await f.resources.garbageCollect(new Set(prepared.resourceIds), { minimumAgeMs: 0 })).deleted).toEqual([]);
    const restored = new ImageEditCommandHistoryV3(); restored.restore(f.document, await f.store.restore(prepared.checkpoint));
    const original = restored.undo(f.document).document;
    expect(original.layers[0]).toMatchObject({ tiles: {} });
    expect(restored.redo(original).document.layers[0]).toMatchObject({ tiles: { '0/0/0': pixel.id } });
  });
  it('长历史按页写入，跨重开保持 redo 位置并能撤销最早命令', async () => {
    const f = await fixture();
    f.document = f.history.undo(f.document).document;
    f.document = f.history.undo(f.document).document;
    const prepared = await f.store.prepare(f.history.createSnapshot());
    expect(prepared.checkpoint).toMatchObject({ position: 258, total: 260 });
    expect(prepared.checkpoint.pages).toHaveLength(5);
    await prepared.release();
    const reopenedStore = new ImageEditHistoryPageStoreV3(f.resources);
    const reopened = new ImageEditCommandHistoryV3();
    reopened.restore(f.document, await reopenedStore.restore(prepared.checkpoint));
    expect(reopened.getState()).toMatchObject({ undoCount: 258, redoCount: 2 });
    expect((await reopenedStore.readPage(prepared.checkpoint, 4))).toHaveLength(4);
    for (let index = 0; index < 258; index++) f.document = reopened.undo(f.document).document;
    expect(f.document.layers[0].name).toBe('底图');
  });
  it('新操作只重写末页，移动游标不重写既有不可变页', async () => {
    const f = await fixture(128);
    const first = await f.store.prepare(f.history.createSnapshot());
    f.document = f.history.undo(f.document).document;
    const second = await f.store.prepare(f.history.createSnapshot());
    expect(second.checkpoint.pages.map(page => page.resourceId)).toEqual(first.checkpoint.pages.map(page => page.resourceId));
    await first.release(); await second.release();
  });
  it('磁盘不足不替换已保存检查点，取消可安全重试', async () => {
    const f = await fixture(2);
    const first = await f.store.prepare(f.history.createSnapshot()); await first.release();
    const write = vi.spyOn(f.resources, 'putBuffer').mockRejectedValueOnce(Object.assign(new Error('磁盘空间不足'), { code: 'ENOSPC' }));
    await expect(f.store.prepare(f.history.createSnapshot())).rejects.toMatchObject({ code: 'ENOSPC' }); write.mockRestore();
    expect((await f.store.restore(first.checkpoint)).undo).toHaveLength(2);
    const abort = new AbortController(); abort.abort();
    await expect(f.store.prepare(f.history.createSnapshot(), abort.signal)).rejects.toThrow();
    const retry = await f.store.prepare(f.history.createSnapshot()); expect(retry.checkpoint.total).toBe(2); await retry.release();
  });
  it('页丢失／哈希被篡改与非法索引显式失败，不以空历史恢复', async () => {
    const f = await fixture(2);
    const prepared = await f.store.prepare(f.history.createSnapshot()); await prepared.release();
    await expect(f.store.restore({ ...prepared.checkpoint, position: 3 })).rejects.toThrow('位置');
    await expect(f.store.restore({ ...prepared.checkpoint, pages: [{ ...prepared.checkpoint.pages[0], start: 2 }] })).rejects.toThrow('不连续');
    const resourceId = prepared.checkpoint.pages[0].resourceId as `sha256:${string}`;
    await fsp.writeFile(f.resources.getFilesystemPath(resourceId), 'broken');
    await expect(f.store.restore(prepared.checkpoint)).rejects.toThrow('Corrupt resource');
    await fsp.rm(f.resources.getFilesystemPath(resourceId));
    await expect(f.store.restore(prepared.checkpoint)).rejects.toThrow('Resource not found');
  });
  it('保存确认前保护历史页，确认后只有显式 live set 才能回收旧分支', async () => {
    const f = await fixture(2);
    const prepared = await f.store.prepare(f.history.createSnapshot());
    const active = await f.resources.garbageCollect(new Set(), { minimumAgeMs: 0 });
    expect(active.deleted).toEqual([]); expect(active.retainedByLease).toEqual(prepared.resourceIds);
    await prepared.release();
    const retained = await f.resources.garbageCollect(new Set(prepared.resourceIds), { minimumAgeMs: 0 }); expect(retained.deleted).toEqual([]);
    const discarded = await f.resources.garbageCollect(new Set(), { minimumAgeMs: 0 }); expect(discarded.deleted).toEqual(prepared.resourceIds);
  });
});
