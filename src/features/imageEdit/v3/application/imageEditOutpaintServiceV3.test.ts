// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { ImageEditCommandBusV3 } from './imageEditCommandBus';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import { cancelImageEditOutpaintV3, prepareImageEditOutpaintV3, readImageEditOutpaintJobV3, recoverImageEditOutpaintV3, restoreImageEditOutpaintJobsV3, startImageEditOutpaintV3 } from './imageEditOutpaintServiceV3';

const fake = vi.hoisted(() => ({ bus: null as unknown as ImageEditCommandBusV3,
  save: vi.fn(async () => undefined), release: vi.fn(), referenceSave: vi.fn(), referenceDelete: vi.fn(), appearance: vi.fn(), submit: vi.fn(), cancel: vi.fn(), history: new Map<string, { params: Record<string, unknown> }>(),
  waits: new Map<string, { resolve(value: { ok: true } | { ok: false; error: string }): void; progress(value: number): void }>() }));
vi.mock('@/core/ModelRegistry', () => ({ registry: { getModel: () => ({ params: [] }), getDefaultValues: () => ({ quality: 'fine' }) } }));
vi.mock('@/features/generation', () => ({ generationApplicationService: {
  resolveModel: vi.fn(async () => ({ modelId: 'fixture-image', providerId: 'fixture' })),
  prepare: vi.fn((request: { modelId: string; options: Record<string, unknown> }) => ({ prepared: true, modelId: request.modelId, providerId: 'fixture', mediaType: 'image', options: request.options, priceEstimate: { display: '测试估价' } })),
  submit: fake.submit, getTask: () => ({ cancellable: true }), cancelTask: fake.cancel,
}, waitForGenerationCompletion: (id: string, signal: AbortSignal, _recovering: boolean, progress: (value: number) => void) => new Promise((resolve, reject) => {
  fake.waits.set(id, { resolve: value => { fake.waits.delete(id); resolve(value); }, progress }); signal.addEventListener('abort', () => reject(signal.reason), { once: true });
}) }));
vi.mock('@/services/database', () => ({ databaseService: {
  getHistoryById: async (id: string) => fake.history.get(id),
  getHistory: async ({ offset, limit }: { offset: number; limit: number }) => [...fake.history].slice(offset, offset + limit).map(([id, record]) => ({ ...record, id, status: 'completed', errorMessage: null })),
} }));
vi.mock('@/services/imageSource', () => ({ toFetchableMediaUrl: (url: string) => url }));
vi.mock('@/commands/imageEditorV3', () => ({
  saveImageEditorV3Document: fake.referenceSave, deleteImageEditorV3DocumentIfRevision: fake.referenceDelete,
  loadImageEditorV3Document: async () => ({ document: fake.bus.getSnapshot().document }),
}));
vi.mock('./imageEditDocumentLoading', () => ({ ensureImageEditDocumentInstanceV3: async () => ({ bus: fake.bus }) }));
vi.mock('./imageEditDocumentInstances', () => ({ requireImageEditDocumentInstanceV3: () => ({ bus: fake.bus }),
  leaseImageEditDocumentInstanceV3: () => fake.release, saveImageEditDocumentInstanceV3: fake.save }));
vi.mock('./imageEditPersistenceOperations', () => ({ requireImageEditPersistenceOwnerV3: () => ({ assertCurrent() {} }) }));
vi.mock('./imageEditMaterializationV3', () => ({ materializeImageEditSnapshotV3: async () => ({ raster: { mediaUrl: 'media://fixture/padded.png' } }) }));
vi.mock('../smartContent/service', () => ({ resolveSmartContentSourceV3: async () => ({ document: createImageEditDocumentV3({ width: 200, height: 160 }), bytes: {} }), prepareSmartContentAppearanceV3: fake.appearance }));
vi.mock('../smartContent/resourceLeases', () => ({ retainSmartContentResourcesV3: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks(); fake.waits.clear(); fake.history.clear();
  const doc = createImageEditDocumentV3({ width: 100, height: 80, documentId: crypto.randomUUID() }); doc.layers = [createImageEditRasterLayerV3('base', '原图')]; fake.bus = new ImageEditCommandBusV3(doc);
  fake.save.mockResolvedValue(undefined); fake.referenceSave.mockImplementation(async (request: { document: { id: string } }) => ({ documentRef: `image-edit-v3:${request.document.id}`, revision: 0 }));
  fake.referenceDelete.mockResolvedValue({ deleted: true });
  fake.appearance.mockResolvedValue({ source: { kind: 'empty' }, tiles: {}, width: 200, height: 160, bytes: {}, release: vi.fn(async () => undefined) });
  fake.submit.mockImplementation(async (request: { options: Record<string, unknown> }, taskId: string) => { fake.history.set(taskId, { params: request.options }); return { taskId }; });
  fake.cancel.mockResolvedValue({ cancelled: true });
});
afterEach(() => fake.bus.dispose());
const request = () => ({ documentId: fake.bus.getSnapshot().document.id, margins: { right: .5, bottom: .5 }, prompt: '自然延续砖墙' });
async function completionReady(taskId: string) { await vi.waitFor(() => expect(fake.waits.has(taskId)).toBe(true)); return fake.waits.get(taskId)!; }
async function settle(taskId: string, status: string) { await vi.waitFor(() => expect(readImageEditOutpaintJobV3(taskId)?.status).toBe(status)); }
describe('图片扩图正式队列编排（无网络模拟供应商）', () => {
  it('prepare 不导出或提交；参考画布补边，请求带媒体，进度后新智能层原子落位并保存', async () => {
    await prepareImageEditOutpaintV3(request()); expect(fake.submit).not.toHaveBeenCalled(); expect(fake.referenceSave).not.toHaveBeenCalled();
    fake.bus.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: .3, y: .3, width: .3, height: .3 }, 'replace'));
    const job = await startImageEditOutpaintV3(request());
    expect(fake.referenceSave.mock.calls[0][0].document.geometry).toMatchObject({ width: 150, height: 120 });
    expect(fake.submit.mock.calls[0][0]).toMatchObject({ mediaType: 'image', options: { uploadedFilePaths: ['media://fixture/padded.png'], images: ['media://fixture/padded.png'] } });
    expect(fake.bus.getSnapshot().document.revision).toBe(0);
    (await completionReady(job.taskId)).progress(45); expect(readImageEditOutpaintJobV3(job.taskId)?.progress).toBe(45);
    (await completionReady(job.taskId)).resolve({ ok: true }); await settle(job.taskId, 'placed');
    expect(fake.bus.getSnapshot().document.layers).toHaveLength(2); expect(fake.bus.getPersistenceSnapshot().history.undo).toHaveLength(1);
    const selected = fake.bus.getSnapshot().selection!.operations[0].shape;
    expect(selected.type).toBe('rectangle'); if (selected.type === 'rectangle') { expect(selected.x).toBeCloseTo(.2); expect(selected.y).toBeCloseTo(.2); }
    expect(fake.save).toHaveBeenCalledWith(job.documentId, true);
    fake.bus.undo(); expect(fake.bus.getSnapshot().document.geometry.width).toBe(100); expect(fake.bus.getSnapshot().document.layers).toHaveLength(1);
    await recoverImageEditOutpaintV3(job.documentId, job.taskId); await settle(job.taskId, 'cancelled');
    expect(fake.bus.getSnapshot().document.layers).toHaveLength(1); expect(fake.submit).toHaveBeenCalledTimes(1); expect(fake.appearance).toHaveBeenCalledTimes(1);
  });
  it('保存失败保留已落位内容，恢复只续保存，无重复付费或加层', async () => {
    fake.save.mockRejectedValueOnce(new Error('disk full'));
    const job = await startImageEditOutpaintV3(request()); (await completionReady(job.taskId)).resolve({ ok: true }); await settle(job.taskId, 'failed');
    expect(fake.bus.getSnapshot().document.layers).toHaveLength(2);
    await recoverImageEditOutpaintV3(job.documentId, job.taskId); await settle(job.taskId, 'placed');
    expect(fake.submit).toHaveBeenCalledTimes(1); expect(fake.appearance).toHaveBeenCalledTimes(1); expect(fake.bus.getSnapshot().document.layers).toHaveLength(2);
  });
  it('取消与供应商失败不改图片；失败恢复等待原任务，不提交新任务', async () => {
    const job = await startImageEditOutpaintV3(request()); await cancelImageEditOutpaintV3(job.taskId); await settle(job.taskId, 'cancelled');
    expect(fake.cancel).toHaveBeenCalledTimes(1); expect(fake.bus.getSnapshot().document.revision).toBe(0);
    const next = await startImageEditOutpaintV3(request()); (await completionReady(next.taskId)).resolve({ ok: false, error: 'fixture provider failed' }); await settle(next.taskId, 'failed');
    await recoverImageEditOutpaintV3(next.documentId, next.taskId); (await completionReady(next.taskId)).resolve({ ok: true }); await settle(next.taskId, 'placed');
    expect(fake.submit).toHaveBeenCalledTimes(2);
  });
  it('HDR 拒绝在提交前；准备失败清理参考，尺寸改变拒绝迟到落位', async () => {
    const doc = fake.bus.getSnapshot().document;
    fake.bus.dispose(); fake.bus = new ImageEditCommandBusV3({ ...doc, color: { ...doc.color, transferFunction: 'pq' } });
    await expect(startImageEditOutpaintV3(request())).rejects.toThrow('HDR'); expect(fake.submit).not.toHaveBeenCalled();
    fake.bus.dispose(); fake.bus = new ImageEditCommandBusV3(doc);
    const job = await startImageEditOutpaintV3(request());
    fake.bus.dispatch({ type: 'document.set-canvas-size', commandId: 'manual-size', expectedRevision: 0, width: 200, height: 80, rasterCanvases: {} });
    (await completionReady(job.taskId)).resolve({ ok: true }); await settle(job.taskId, 'failed');
    expect(readImageEditOutpaintJobV3(job.taskId)?.error).toContain('原画幅已变化'); expect(fake.bus.getSnapshot().document.layers).toHaveLength(1);
  });
  it('供应商取消失败保留可见错误，不把计费取消报告为成功', async () => {
    const job = await startImageEditOutpaintV3(request());
    fake.cancel.mockRejectedValueOnce(new Error('transport unavailable'));
    await expect(cancelImageEditOutpaintV3(job.taskId)).rejects.toThrow('供应商取消未确认');
    await settle(job.taskId, 'failed');
    expect(readImageEditOutpaintJobV3(job.taskId)?.error).toContain('核对费用与结果');
    expect(fake.bus.getSnapshot().document.revision).toBe(0);
  });
  it('重新打开分页发现未回填记录，显式恢复原结果，不重新提交', async () => {
    const input = request(), metadata = { documentId: input.documentId, original: { width: 100, height: 80 }, margins: input.margins };
    for (let i = 0; i < 100; i++) fake.history.set(`other-${i}`, { params: { imageEditOutpaint: { ...metadata, documentId: 'other-document' } } });
    const taskId = crypto.randomUUID(); fake.history.set(taskId, { params: { imageEditOutpaint: metadata } });
    await restoreImageEditOutpaintJobsV3(input.documentId, new AbortController().signal);
    expect(readImageEditOutpaintJobV3(taskId)?.status).toBe('failed');
    expect(fake.submit).not.toHaveBeenCalled(); expect(fake.bus.getSnapshot().document.revision).toBe(0);
    await recoverImageEditOutpaintV3(input.documentId, taskId);
    (await completionReady(taskId)).resolve({ ok: true }); await settle(taskId, 'placed');
    expect(fake.submit).not.toHaveBeenCalled(); expect(fake.bus.getSnapshot().document.layers).toHaveLength(2);
  });
  it('提交回执等待期间取消，不再回填；收到正式回执后取消原任务并清理参考', async () => {
    let finishSubmit!: () => void;
    fake.submit.mockImplementationOnce(async (_request: unknown, taskId: string) => {
      await new Promise<void>(resolve => { finishSubmit = resolve; }); return { taskId };
    });
    const taskId = crypto.randomUUID(), pending = startImageEditOutpaintV3(request(), { operationId: taskId });
    await vi.waitFor(() => expect(fake.submit).toHaveBeenCalledTimes(1));
    await cancelImageEditOutpaintV3(taskId); expect(fake.cancel).not.toHaveBeenCalled();
    finishSubmit(); await pending; await settle(taskId, 'cancelled');
    expect(fake.cancel).toHaveBeenCalledTimes(1); expect(fake.bus.getSnapshot().document.revision).toBe(0);
    await vi.waitFor(() => expect(fake.referenceDelete).toHaveBeenCalledTimes(1));
  });
});
