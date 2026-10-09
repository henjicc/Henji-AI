import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyImageEditCommandV3 } from '../../../../../src/core/imageEdit/v3/commandReducer';
import { ImageEditCommandHistoryV3 } from '../../../../../src/core/imageEdit/v3/commandHistory';
import type { ImageEditCommandHistorySnapshotV3, ImageEditHistoryEntrySnapshotV3 } from '../../../../../src/core/imageEdit/v3/commandHistoryCodec';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../../../../../src/core/imageEdit/v3/documentFactory';
import type { ImageEditDocumentV3 } from '../../../../../src/core/imageEdit/v3/documentTypes';
import { ImageEditDocumentRepository } from '../document-repository';
import { ContentAddressedResourceStore } from '../resource-store';
import { HenjiImagePackageCodec } from '../package-codec';
import { ImageEditHistoryPageStoreV3 } from './store';
import { writeBufferAtomically } from '../../fs/atomic-file';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fsp.rm(directory, { recursive: true, force: true }); });

function historyFixture(count: number, padding = ''): { document: ImageEditDocumentV3; history: ImageEditCommandHistorySnapshotV3 } {
  let document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'publication' });
  document.layers = [createImageEditRasterLayerV3('layer', '开始')];
  const entries: ImageEditHistoryEntrySnapshotV3[] = [];
  for (let index = 0; index < count; index++) {
    const command = { type: 'layer.update-common' as const, commandId: `rename-${index}`, expectedRevision: document.revision,
      layerId: 'layer', patch: { name: `操作 ${index}${padding}` } };
    const result = applyImageEditCommandV3(document, command);
    entries.push({ forward: command, inverse: result.inverse, metadataBytes: result.historyMetadataBytes, resources: result.historyResources });
    document = result.document;
  }
  return { document, history: { version: 2, documentId: document.id, headRevision: document.revision, undo: entries, redo: [] } };
}

async function storage() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-history-publication-')); directories.push(directory);
  const resources = new ContentAddressedResourceStore(path.join(directory, 'resources'));
  const documents = new ImageEditDocumentRepository(path.join(directory, 'documents'), { resources });
  return { directory, resources, documents };
}

describe('历史检查点正式发布链', () => {
  it('保存只发布索引，重开/跨页撤销重做/包解包/fork 保持相同历史', async () => {
    const s = await storage(); const f = historyFixture(130);
    const history = new ImageEditCommandHistoryV3(); history.restore(f.document, f.history);
    const document = history.undo(history.undo(f.document).document).document;
    const snapshot = history.createSnapshot();
    await s.documents.create({ documentId: document.id, revision: document.revision, document, history: snapshot });
    const raw = JSON.parse(await fsp.readFile(path.join(s.directory, 'documents/publication.json'), 'utf8')) as Record<string, unknown>;
    expect(raw).not.toHaveProperty('history'); expect(raw).toHaveProperty('historyCheckpoint');
    const checkpoint = (await s.documents.loadCheckpoint(document.id)).historyCheckpoint!;
    expect(checkpoint).toMatchObject({ total: 130, position: 128 }); expect(checkpoint.pages).toHaveLength(3);
    const reopened = await s.documents.load(document.id); expect(reopened.history).toEqual(snapshot);
    const restored = new ImageEditCommandHistoryV3(); restored.restore(document, reopened.history);
    let current = document;
    for (let index = 0; index < 128; index++) current = restored.undo(current).document;
    expect(current.layers[0].name).toBe('开始');
    for (let index = 0; index < 130; index++) current = restored.redo(current).document;
    expect(current.layers[0].name).toBe('操作 129');
    const fork = await s.documents.fork({ sourceDocumentRef: 'image-edit-v3:publication', expectedRevision: document.revision, targetDocumentId: 'fork' });
    expect(fork.historyCheckpoint?.pages).toEqual(checkpoint.pages);
    const forked = await s.documents.load('fork'); expect(forked.history?.documentId).toBe('fork');
    expect(forked.history?.undo).toEqual(snapshot.undo);
    const archive = path.join(s.directory, 'history.henjiimg');
    await new HenjiImagePackageCodec(s.resources).export({ targetPath: archive, document: reopened });
    const target = new ContentAddressedResourceStore(path.join(s.directory, 'imported'));
    const putFile = target.putFile.bind(target);
    vi.spyOn(target, 'putFile').mockImplementation(async (source, options) => {
      const resource = await putFile(source, options);
      expect((await target.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted).toEqual([]);
      return resource;
    });
    const imported = await new HenjiImagePackageCodec(target).import(archive);
    try {
      expect(imported.manifest.document.history).toEqual(snapshot);
      expect(imported.resources.map(resource => resource.id)).toEqual(expect.arrayContaining(checkpoint.pages.map(page => page.resourceId)));
      expect((await target.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted).toEqual([]);
    } finally { await imported.resourceLease.release(); }
    expect((await s.resources.garbageCollect(new Set((await s.documents.list()).flatMap(entry => entry.resourceRefs)), { minimumAgeMs: 0 })).deleted).toEqual([]);
  });

  it('检查 CAS 后才准备页；原子发布失败或取消保留旧检查点，重试不重放编辑', async () => {
    const s = await storage(); const f = historyFixture(64);
    await s.documents.create({ documentId: f.document.id, revision: f.document.revision, ...f });
    const file = path.join(s.directory, 'documents/publication.json'); const original = await fsp.readFile(file);
    const next = historyFixture(65);
    const prepare = vi.spyOn(ImageEditHistoryPageStoreV3.prototype, 'prepare');
    await expect(s.documents.save({ documentId: next.document.id, expectedRevision: 63, nextRevision: 65, ...next, resourceRefs: [] })).rejects.toThrow('revision conflict');
    expect(prepare).not.toHaveBeenCalled();
    const failure = new ImageEditDocumentRepository(path.join(s.directory, 'documents'), { resources: s.resources,
      writeAtomically: async () => { throw Object.assign(new Error('磁盘已满'), { code: 'ENOSPC' }); } });
    await expect(failure.save({ documentId: next.document.id, expectedRevision: 64, nextRevision: 65, ...next, resourceRefs: [] })).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await fsp.readFile(file)).toEqual(original);
    const abort = new AbortController(); abort.abort();
    await expect(s.documents.save({ documentId: next.document.id, expectedRevision: 64, nextRevision: 65, ...next, resourceRefs: [], signal: abort.signal })).rejects.toThrow();
    expect(await fsp.readFile(file)).toEqual(original);
    await s.documents.save({ documentId: next.document.id, expectedRevision: 64, nextRevision: 65, ...next, resourceRefs: [] });
    expect((await s.documents.load(next.document.id)).history).toEqual(next.history);
    expect((await s.resources.garbageCollect(new Set((await s.documents.list()).flatMap(entry => entry.resourceRefs)), { minimumAgeMs: 0 })).retainedByLease).toEqual([]);
  });

  it('历史页在字节发布之前取得租约，零最低年龄并发 GC 不删准备页', async () => {
    const s = await storage(); const f = historyFixture(2);
    const write = s.resources.putBuffer.bind(s.resources);
    vi.spyOn(s.resources, 'putBuffer').mockImplementation(async (bytes, options) => {
      const result = await write(bytes, options);
      expect((await s.resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted).toEqual([]);
      return result;
    });
    const prepared = await new ImageEditHistoryPageStoreV3(s.resources).prepare(f.history);
    await prepared.release();
    expect((await s.resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted).toEqual(prepared.resourceIds);
  });

  it('扫描与复制不调用全量恢复；损坏页拒绝打开且不改写文档', async () => {
    const s = await storage(); const f = historyFixture(2);
    await s.documents.create({ documentId: f.document.id, revision: f.document.revision, ...f });
    const restore = vi.spyOn(ImageEditHistoryPageStoreV3.prototype, 'restore');
    await s.documents.list(); await s.documents.fork({ sourceDocumentRef: 'image-edit-v3:publication', expectedRevision: 2, targetDocumentId: 'copy' });
    expect(restore).not.toHaveBeenCalled();
    const checkpoint = (await s.documents.loadCheckpoint(f.document.id)).historyCheckpoint!;
    const file = path.join(s.directory, 'documents/publication.json'); const original = await fsp.readFile(file);
    await fsp.writeFile(s.resources.getFilesystemPath(checkpoint.pages[0].resourceId as `sha256:${string}`), 'broken');
    await expect(s.documents.load(f.document.id)).rejects.toThrow('Corrupt resource');
    expect(await fsp.readFile(file)).toEqual(original);
  });

  it('GC 在同一发布屏障内读取最新根，根扫描失败不删除资源', async () => {
    const s = await storage(); const f = historyFixture(2);
    let entered!: () => void; let resume!: () => void;
    const barrier = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocking = new ImageEditDocumentRepository(path.join(s.directory, 'documents'), { resources: s.resources,
      writeAtomically: async (target, bytes) => { entered(); await barrier; await writeBufferAtomically(target, bytes); },
    });
    const published = blocking.create({ documentId: f.document.id, revision: 2, ...f });
    await started;
    const readRoots = vi.fn(async () => new Set((await s.documents.list()).flatMap(envelope => envelope.resourceRefs)));
    const collecting = s.resources.garbageCollect(new Set(), { minimumAgeMs: 0, resolveReferences: readRoots });
    expect(readRoots).not.toHaveBeenCalled(); resume(); const envelope = await published;
    expect((await collecting).deleted).toEqual([]);
    await fsp.writeFile(path.join(s.directory, 'documents/broken.json'), '{');
    await expect(s.resources.garbageCollect(new Set(), { minimumAgeMs: 0, resolveReferences: readRoots })).rejects.toThrow();
    expect(await s.resources.has(envelope.resourceRefs[0])).toBe(true);
  });
});

it.runIf(process.env.HENJI_HISTORY_BENCH_REPORT !== undefined)('实测一万步超过单块 JSON 预算的正式保存与冷打开', async () => {
  const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  collectGarbage?.(); const runtimeBaseline = process.memoryUsage();
  const s = await storage(); const f = historyFixture(10_000, 'x'.repeat(2100));
  const jsonBytes = Buffer.byteLength(JSON.stringify({ ...f.history, undo: [] }))
    + f.history.undo.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0) + f.history.undo.length - 1;
  expect(jsonBytes).toBeGreaterThan(32 * 1024 * 1024);
  collectGarbage?.();
  const baseline = process.memoryUsage(); let peakRss = baseline.rss; let peakHeap = baseline.heapUsed;
  const sampler = setInterval(() => { const memory = process.memoryUsage(); peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed); }, 5);
  try {
    const start = performance.now();
    await s.documents.create({ documentId: f.document.id, revision: f.document.revision, ...f });
    const saveMs = performance.now() - start; const savePeakRss = peakRss; const savePeakHeap = peakHeap;
    const checkpointStart = performance.now(); const envelope = await s.documents.loadCheckpoint(f.document.id);
    const checkpointOpenMs = performance.now() - checkpointStart;
    peakRss = process.memoryUsage().rss; peakHeap = process.memoryUsage().heapUsed;
    const openStart = performance.now();
    const opened = await new ImageEditDocumentRepository(path.join(s.directory, 'documents'), { resources: s.resources }).load(f.document.id);
    const openMs = performance.now() - openStart;
    expect(opened.history?.undo).toHaveLength(10_000);
    const state = new ImageEditCommandHistoryV3(); const busStart = performance.now(); state.restore(opened.document as ImageEditDocumentV3, opened.history);
    const restoreMs = performance.now() - busStart;
    expect(state.undo(opened.document as ImageEditDocumentV3).document.layers[0].name).toBe(`操作 9998${'x'.repeat(2100)}`);
    const after = process.memoryUsage(); peakRss = Math.max(peakRss, after.rss); peakHeap = Math.max(peakHeap, after.heapUsed);
    await fsp.writeFile(process.env.HENJI_HISTORY_BENCH_REPORT!, JSON.stringify({ steps: 10_000, jsonBytes,
      checkpointBytes: (await fsp.stat(path.join(s.directory, 'documents/publication.json'))).size,
      pages: envelope.historyCheckpoint!.pages.length, saveMs, checkpointOpenMs, openMs, restoreMs,
      runtimeBaseline, explicitGc: Boolean(collectGarbage), baseline, savePeakRss, savePeakHeap, openAndRestorePeakRss: peakRss, openAndRestorePeakHeap: peakHeap, after,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      scope: 'Node/Windows 正式仓库及同步 core 历史，无 Electron 窗口；操作系统文件缓存未清空。' }, null, 2));
  } finally { clearInterval(sampler); }
}, 120_000);
