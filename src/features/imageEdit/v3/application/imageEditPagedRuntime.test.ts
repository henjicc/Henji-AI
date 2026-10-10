import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { applyImageEditCommandV3 } from '@/core/imageEdit/v3/commandReducer';
import type { ImageEditHistoryCheckpointV3 } from '@/core/imageEdit/v3/historyPaging/schema';
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory';
import type { ImageEditHistoryEntrySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import { ImageEditCommandBusV3 } from './imageEditCommandBus';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import { ImageEditDocumentRepository } from '../../../../../electron/main/services/image-editor-v3/document-repository';
import { ContentAddressedResourceStore } from '../../../../../electron/main/services/image-editor-v3/resource-store';
import { ImageEditHistoryPageStoreV3 } from '../../../../../electron/main/services/image-editor-v3/history-pages/store';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fsp.rm(directory, { recursive: true, force: true }); });
const yieldControl = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

async function fixture(count: number, padding = '') {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-paged-runtime-')); directories.push(directory);
  const resources = new ContentAddressedResourceStore(path.join(directory, 'resources'));
  const documents = new ImageEditDocumentRepository(path.join(directory, 'documents'), { resources });
  const pages = new ImageEditHistoryPageStoreV3(resources);
  let document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'paged-runtime' });
  document.layers = [createImageEditRasterLayerV3('layer', '开始')];
  const entries: ImageEditHistoryEntrySnapshotV3[] = [];
  const checkpoint: ImageEditHistoryCheckpointV3 = { format: 'henji-image-history', version: 2, snapshotVersion: 2,
    documentId: document.id, headRevision: count, position: count, total: count, pages: [], resources: [] };
  const releases: Array<() => Promise<void>> = [];
  const publishPage = async (): Promise<void> => {
    if (!entries.length) return;
    const prepared = await pages.prepare({ version: 2, documentId: document.id, headRevision: document.revision, undo: entries, redo: [] });
    const start = checkpoint.pages.reduce((sum, page) => sum + page.count, 0);
    checkpoint.pages.push(...prepared.checkpoint.pages.map(page => ({ ...page, start: page.start + start })));
    releases.push(prepared.release); entries.length = 0;
  };
  for (let index = 0; index < count; index++) {
    const forward = { type: 'layer.update-common' as const, commandId: `rename-${index}`, expectedRevision: document.revision,
      layerId: 'layer', patch: { name: `操作 ${index}${padding}` } };
    const result = applyImageEditCommandV3(document, forward);
    entries.push({ forward, inverse: result.inverse, metadataBytes: result.historyMetadataBytes, resources: result.historyResources });
    document = result.document;
    if (entries.length === 64) await publishPage();
  }
  await publishPage();
  try { await documents.create({ documentId: document.id, revision: document.revision, document, historyCheckpoint: checkpoint }); }
  finally { for (const release of releases) await release(); }
  return { documents, pages, resources, directory };
}

async function open(s: Awaited<ReturnType<typeof fixture>>) {
  const loaded = await s.documents.loadPaged('paged-runtime');
  return new ImageEditCommandBusV3(loaded.document as ImageEditDocumentV3, {
    historySnapshot: loaded.history, history: { readPage: (checkpoint, index, signal) => s.pages.readPage(checkpoint, index, signal) },
  });
}

async function save(s: Awaited<ReturnType<typeof fixture>>, bus: ImageEditCommandBusV3) {
  const snapshot = bus.getPersistenceSnapshot();
  await s.documents.save({ documentId: snapshot.document.id, expectedRevision: (await s.documents.loadCheckpoint(snapshot.document.id)).revision,
    nextRevision: snapshot.document.revision, document: snapshot.document, history: snapshot.history,
    resourceRefs: snapshot.retainedResources.map(ref => ref.resourceId as `sha256:${string}`) });
  bus.confirmPersistedHistory((await s.documents.loadPaged(snapshot.document.id)).history!);
}

describe('正式冷页运行时', () => {
  it('跨热窗口跳转、撤销重做、保存游标、重开及分叉只保留按需命令', async () => {
    const s = await fixture(513); const bus = await open(s);
    expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(0);
    expect(bus.getHistoryView()).toMatchObject({ position: 513, total: 513 });
    expect((await bus.readHistoryPageAsync(63, 3)).map(row => row.position)).toEqual([63, 64, 65]);
    await bus.jumpToHistory(1, { yieldControl }); expect(bus.getSnapshot().document.layers[0].name).toBe('操作 0');
    await bus.undo(); expect(bus.getSnapshot().document.layers[0].name).toBe('开始');
    await bus.redo(); expect(bus.getSnapshot().document.layers[0].name).toBe('操作 0');
    await save(s, bus); const reopened = await open(s);
    expect(reopened.getHistoryView()).toMatchObject({ position: 1, total: 513 });
    await reopened.jumpToHistory(513, { yieldControl }); expect(reopened.getSnapshot().document.layers[0].name).toBe('操作 512');
    await reopened.jumpToHistory(63, { yieldControl });
    reopened.dispatch({ type: 'layer.update-common', commandId: 'branch', expectedRevision: reopened.getSnapshot().document.revision, layerId: 'layer', patch: { name: '新分支' } });
    expect(reopened.getHistoryView()).toMatchObject({ position: 64, total: 64 });
    await save(s, reopened); const branched = await open(s);
    expect(branched.getPersistenceSnapshot().history.undo).toHaveLength(0);
    await branched.undo(); expect(branched.getSnapshot().document.layers[0].name).toBe('操作 62');
    await branched.redo(); expect(branched.getSnapshot().document.layers[0].name).toBe('新分支');
    bus.dispose(); reopened.dispose(); branched.dispose();
  });

  it('串行有界页缓存；取消、迟到读取、损坏页不部分发布；冷页事务补偿支持多于四页', async () => {
    const s = await fixture(513); const loaded = await s.documents.loadPaged('paged-runtime');
    const core = new ImageEditCommandHistoryV3({ readPage: (checkpoint, index, signal) => s.pages.readPage(checkpoint, index, signal) });
    core.restore(loaded.document as ImageEditDocumentV3, loaded.history);
    for (let index = 0; index < 513; index += 64) { expect((await core.readEntryAt(index))?.forward.commandId).toBe(`rename-${index}`); expect(core.getHotPageCount()).toBeLessThanOrEqual(4); }
    expect(core.getEntryAt(0)).toBeUndefined();
    const bus = await open(s); const before = bus.getPersistenceSnapshot(); const abort = new AbortController();
    await expect(bus.jumpToHistory(0, { signal: abort.signal, yieldControl, onProgress: value => { if (value === 17) abort.abort(); } })).rejects.toThrow();
    expect(bus.getPersistenceSnapshot()).toEqual(before);
    await expect(bus.jumpToHistory(0, { yieldControl: async () => { bus.dispatch({ type: 'layer.update-common', commandId: 'newer', expectedRevision: bus.getSnapshot().document.revision, layerId: 'layer', patch: { name: '较新编辑' } }); } })).rejects.toThrow('历史已继续编辑');
    expect(bus.getSnapshot().document.layers[0].name).toBe('较新编辑'); bus.dispose();
    const rollback = await open(s);
    await rollback.rollbackCommands(Array.from({ length: 320 }, (_, index) => `rename-${512 - index}`));
    expect(rollback.getHistoryView()).toMatchObject({ total: 193, position: 193 });
    expect(rollback.getSnapshot().document.layers[0].name).toBe('操作 192');
    await save(s, rollback); expect((await open(s)).getHistoryView().total).toBe(193); rollback.dispose();
    const corrupt = await s.documents.loadPaged('paged-runtime');
    const broken = new ImageEditCommandBusV3(corrupt.document as ImageEditDocumentV3, { historySnapshot: corrupt.history, history: { readPage: async () => { throw new Error('损坏页'); } } });
    const original = broken.getPersistenceSnapshot();
    await expect(broken.undo()).rejects.toThrow('损坏页'); expect(broken.getPersistenceSnapshot()).toEqual(original); broken.dispose();
  });

  it('保存确认保留会话选区，拒绝迟到检查点覆盖新命令', async () => {
    const s = await fixture(130); const bus = await open(s);
    const selection = appendImageEditSelectionV3(null, { type: 'rectangle', x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 'replace');
    bus.setSelection(selection); await save(s, bus);
    await bus.undo(); expect(bus.getSnapshot().selection).toBeNull();
    await bus.redo(); expect(bus.getSnapshot().selection).toEqual(selection);
    const old = (await s.documents.loadPaged('paged-runtime')).history!;
    bus.dispatch({ type: 'layer.update-common', commandId: 'unsaved', expectedRevision: bus.getSnapshot().document.revision, layerId: 'layer', patch: { name: '未保存' } });
    bus.confirmPersistedHistory(old); expect((await bus.readHistoryHead())?.commandId).toBe('unsaved');
    expect(bus.getPersistenceSnapshot().history.undo).toHaveLength(1); bus.dispose();
  });

  it('读取与保存确认交错仍返回同一行，旧源页在新分支保存后受 GC 保护', async () => {
    const s = await fixture(130); const loaded = await s.documents.loadPaged('paged-runtime');
    let proceed!: () => void, entered!: () => void;
    const barrier = new Promise<void>(resolve => { proceed = resolve });
    const reading = new Promise<void>(resolve => { entered = resolve });
    const bus = new ImageEditCommandBusV3(loaded.document as ImageEditDocumentV3, { historySnapshot: loaded.history,
      history: { readPage: async (checkpoint, index, signal) => { entered(); await barrier; return s.pages.readPage(checkpoint, index, signal) } } });
    const pending = bus.readHistoryPageAsync(1, 1); await reading;
    bus.confirmPersistedHistory((await s.documents.loadPaged('paged-runtime')).history!);
    proceed(); expect((await pending)[0].key).toBe('rename-0');
    await bus.jumpToHistory(63, { yieldControl });
    bus.dispatch({ type: 'layer.update-common', commandId: 'branch-gc', expectedRevision: bus.getSnapshot().document.revision, layerId: 'layer', patch: { name: '分支' } });
    const snapshot = bus.getPersistenceSnapshot();
    await s.documents.save({ documentId: snapshot.document.id, expectedRevision: 130, nextRevision: snapshot.document.revision,
      document: snapshot.document, history: snapshot.history, resourceRefs: snapshot.retainedResources.map(ref => ref.resourceId as `sha256:${string}`) });
    // 尚未采用保存回执，内存仍引用旧源检查点；其他回收入口只知道持久根。
    await s.resources.garbageCollect(new Set((await s.documents.list()).flatMap(envelope => envelope.resourceRefs)), { minimumAgeMs: 0 });
    await bus.jumpToHistory(0, { yieldControl }); expect(bus.getSnapshot().document.layers[0].name).toBe('开始'); bus.dispose();
  });
});

it.runIf(Boolean(process.env.HENJI_HISTORY_PAGED_BENCH))('万步与五万步打开、跳转和保存重开实测', async () => {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  const reports: unknown[] = [];
  for (const count of [10_000, 50_000]) {
    const s = await fixture(count, 'x'.repeat(2100)); gc?.();
    const baseline = process.memoryUsage(); let peakHeap = baseline.heapUsed, peakRss = baseline.rss;
    const sample = (): void => { const usage = process.memoryUsage(); peakHeap = Math.max(peakHeap, usage.heapUsed); peakRss = Math.max(peakRss, usage.rss); };
    const sampler = setInterval(sample, 5);
    try {
      const start = performance.now(); const bus = await open(s); const openMs = performance.now() - start; sample();
      const openPeakHeap = peakHeap, openPeakRss = peakRss;
      const jumpStart = performance.now(); await bus.jumpToHistory(count / 2, { yieldControl }); const jumpMs = performance.now() - jumpStart; sample();
      expect(bus.getSnapshot().document.layers[0].name).toBe(`操作 ${count / 2 - 1}${'x'.repeat(2100)}`);
      await bus.undo(); await bus.redo(); const saveStart = performance.now(); await save(s, bus); const saveMs = performance.now() - saveStart; sample();
      const reopenStart = performance.now(); const reopened = await open(s); const reopenMs = performance.now() - reopenStart;
      expect(reopened.getHistoryView()).toMatchObject({ position: count / 2, total: count });
      const finishStart = performance.now(); await reopened.jumpToHistory(count, { yieldControl }); const redoHalfMs = performance.now() - finishStart; sample();
      expect(reopened.getSnapshot().document.layers[0].name).toBe(`操作 ${count - 1}${'x'.repeat(2100)}`);
      expect(reopened.getPersistenceSnapshot().history.undo).toHaveLength(0);
      reports.push({ count, baseline, openMs, jumpMs, saveMs, reopenMs, redoHalfMs, openPeakHeap, openPeakRss, peakHeap, peakRss, explicitGc: Boolean(gc), after: process.memoryUsage() });
      bus.dispose(); reopened.dispose();
    } finally { clearInterval(sampler); }
  }
  await fsp.writeFile(process.env.HENJI_HISTORY_PAGED_BENCH!, JSON.stringify({ reports, scope: 'Node/Windows 正式仓库与命令总线；文件缓存未清空；跳转每16步 setImmediate 让出；不含 Electron/GPU。' }, null, 2));
}, 300_000);
