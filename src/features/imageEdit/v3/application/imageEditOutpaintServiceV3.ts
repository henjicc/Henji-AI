import { createDocumentGeometryCommandV3 } from '@/core/imageEdit/v3/documentGeometry';
import { rebaseImageEditSelectionForOutpaintV3 } from '@/core/imageEdit/v3/aiWorkflows/outpaint';
import { z } from 'zod';
import { registry } from '@/core/ModelRegistry';
import { getAspectChoiceParams, resolveClosestAspectValue } from '@/core/params/ratioResolution';
import { completeInPlaceGeneration } from '@/core/services/inPlaceGeneration';
import { createLogger } from '@/core/logging';
import { createImageEditDocumentV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import { createImageEditLayerCommonV3, type ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes';
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences';
import { planImageEditOutpaintV3, createImageEditOutpaintCommandV3, imageEditOutpaintMarginsSchemaV3 } from '@/core/imageEdit/v3/aiWorkflows/outpaint';
import { applyImageEditCommandV3 } from '@/core/imageEdit/v3/commandReducer';
import { generationApplicationService, waitForGenerationCompletion } from '@/features/generation';
import { databaseService } from '@/services/database';
import { toFetchableMediaUrl } from '@/services/imageSource';
import { deleteImageEditorV3DocumentIfRevision, loadImageEditorV3Document, saveImageEditorV3Document } from '@/commands/imageEditorV3';
import type { ImageEditorV3DocumentRef, ImageEditorV3ResourceRef } from '@/platform/contracts/imageEditorV3';
import { ensureImageEditDocumentInstanceV3 } from './imageEditDocumentLoading';
import { leaseImageEditDocumentInstanceV3, requireImageEditDocumentInstanceV3, saveImageEditDocumentInstanceV3 } from './imageEditDocumentInstances';
import { requireImageEditPersistenceOwnerV3 } from './imageEditPersistenceOperations';
import { materializeImageEditSnapshotV3 } from './imageEditMaterializationV3';
import { prepareSmartContentAppearanceV3, resolveSmartContentSourceV3 } from '../smartContent/service';
import { retainSmartContentResourcesV3 } from '../smartContent/resourceLeases';
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes';
import type { ImageEditCommandBusV3 } from './imageEditCommandBus';

const logger = createLogger('features.imageEdit.v3.outpaint');
import { imageEditOutpaintJobsV3 as jobs, updateImageEditOutpaintJobV3 as update, type ImageEditOutpaintJobV3 } from './imageEditOutpaintJobsV3';
export { subscribeImageEditOutpaintV3, imageEditOutpaintVersionV3, listImageEditOutpaintJobsV3, readImageEditOutpaintJobV3, type ImageEditOutpaintJobV3 } from './imageEditOutpaintJobsV3';
export const imageEditOutpaintRequestSchemaV3 = z.object({ documentId: z.string().min(1), margins: imageEditOutpaintMarginsSchemaV3,
  prompt: z.string().trim().min(1), modelId: z.string().min(1).optional(), params: z.record(z.string(), z.unknown()).optional() }).strict();
export type ImageEditOutpaintRequestV3 = z.infer<typeof imageEditOutpaintRequestSchemaV3>;
const controllers = new Map<string, AbortController>();
const storedOutpaintSchema = z.object({ documentId: z.string().min(1), margins: imageEditOutpaintMarginsSchemaV3,
  original: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict() }).strict();
function restorePlan(metadata: z.infer<typeof storedOutpaintSchema>) {
  return planImageEditOutpaintV3(createImageEditDocumentV3({ documentId: metadata.documentId, ...metadata.original }), metadata.margins);
}

/** 分页发现原生成记录，只恢复可见占位；必须由用户或助手明确续接，不发起第二次生成。 */
export async function restoreImageEditOutpaintJobsV3(documentId: string, signal: AbortSignal): Promise<void> {
  const { bus } = await ensureImageEditDocumentInstanceV3(documentId);
  for (let offset = 0; ; offset += 100) {
    signal.throwIfAborted();
    const records = await databaseService.getHistory({ type: 'image', limit: 100, offset });
    signal.throwIfAborted();
    for (const record of records) {
      const metadata = storedOutpaintSchema.safeParse(record.params.imageEditOutpaint);
      if (!metadata.success || metadata.data.documentId !== documentId || jobs.has(record.id) || record.status === 'cancelled' || findApplied(bus, record.id)) continue;
      jobs.set(record.id, { taskId: record.id, documentId, plan: restorePlan(metadata.data), status: 'failed', progress: 0,
        error: record.errorMessage ?? '发现尚未回填的扩图，请恢复原任务；不会重新生成或重复计费' });
      update(record.id, {});
    }
    if (records.length < 100) return;
  }
}

export async function prepareImageEditOutpaintV3(request: ImageEditOutpaintRequestV3) {
  request = imageEditOutpaintRequestSchemaV3.parse(request);
  const { bus } = await ensureImageEditDocumentInstanceV3(request.documentId);
  requireImageEditPersistenceOwnerV3(request.documentId).assertCurrent();
  const plan = planImageEditOutpaintV3(bus.getSnapshot().document, request.margins);
  // 只做纯请求校验；媒体占位不进行读取、上传或付费调用。
  const placeholder = 'https://example.invalid/image-edit-outpaint-preflight.png';
  const input = { mediaType: 'image' as const, prompt: request.prompt, options: { ...request.params, images: [placeholder], uploadedFilePaths: [placeholder] } };
  const resolved = await generationApplicationService.resolveModel({ ...input, requestedModelId: request.modelId });
  const model = registry.getModel(resolved.modelId);
  const params: Record<string, unknown> = { ...registry.getDefaultValues(resolved.modelId), ...request.params };
  for (const aspect of getAspectChoiceParams(model?.params ?? [])) {
    const value = resolveClosestAspectValue(aspect, plan.output.width / plan.output.height);
    if (value !== null) params[aspect.id] = value;
  }
  const preparation = generationApplicationService.prepare({ ...input, modelId: resolved.modelId, options: { ...params, images: [placeholder], uploadedFilePaths: [placeholder] } });
  return { plan, modelId: resolved.modelId, providerId: resolved.providerId, params, preparation };
}

/** 原任务来源是持久回执；恢复、保存重试都不再添加第二层。 */
function findPlaced(layers: readonly ImageEditLayerV3[], taskId: string): string | undefined {
  for (const layer of layers) {
    if (layer.type === 'smart' && layer.content.origin?.kind === 'generation.result' && layer.content.origin.id === taskId) return layer.id;
    if (layer.type === 'group') { const id = findPlaced(layer.children, taskId); if (id) return id; }
  }
}
function findApplied(bus: ImageEditCommandBusV3, taskId: string): string | undefined {
  const placed = findPlaced(bus.getSnapshot().document.layers, taskId);
  if (placed) return placed;
  const visit = (command: ImageEditCommandV3): string | undefined => {
    if (command.type === 'document.atomic') { for (const child of command.commands) { const id = visit(child); if (id) return id; } }
    if (command.type === 'layer.add' || command.type === 'layer.replace') return findPlaced([command.layer], taskId);
  };
  const history = bus.getPersistenceSnapshot().history;
  for (const entry of [...history.undo, ...history.redo]) { const id = visit(entry.forward); if (id) return id; }
}
async function complete(job: ImageEditOutpaintJobV3, controller: AbortController, recovering: boolean): Promise<void> {
  const { bus } = requireImageEditDocumentInstanceV3(job.documentId);
  const release = leaseImageEditDocumentInstanceV3(job.documentId);
  const signal = AbortSignal.any([controller.signal, bus.getLifecycleSignal()]);
  try {
    const layerId = await completeInPlaceGeneration({ signal,
      readApplied: () => jobs.get(job.taskId)?.layerId ?? findApplied(bus, job.taskId),
      wait: () => waitForGenerationCompletion(job.taskId, signal, recovering, progress => update(job.taskId, { progress })),
      place: async () => {
        update(job.taskId, { status: 'placing' });
        const source = await resolveSmartContentSourceV3({ kind: 'generation.result', id: job.taskId }, signal);
        const before = bus.getSnapshot().document;
        requireImageEditPersistenceOwnerV3(job.documentId).assertCurrent();
        const appearance = await prepareSmartContentAppearanceV3(source.document, before, source.bytes, signal,
          (done, total) => update(job.taskId, { progress: done / total * 100 }));
        let applied = false;
        try {
          signal.throwIfAborted();
          const current = bus.getSnapshot().document;
          // 生成期间允许继续编辑；画幅变化时拒绝错误落位，原生成记录仍可恢复。
          const id = createImageEditIdV3('outpaint-layer');
          const layer = { ...createImageEditLayerCommonV3(id, 'AI 扩图'), type: 'smart' as const, source: appearance.source, tiles: appearance.tiles,
            transform: [job.plan.output.width / appearance.width, 0, 0, job.plan.output.height / appearance.height, 0, 0] as const,
            content: { id: createImageEditIdV3('outpaint-content'), origin: { kind: 'generation.result' as const, id: job.taskId },
              document: source.document, width: appearance.width, height: appearance.height } };
          const selection = bus.getSnapshot().selection;
          bus.dispatch(createImageEditOutpaintCommandV3(current, job.plan, layer, appearance.bytes, `outpaint-${job.taskId}`), selection ? rebaseImageEditSelectionForOutpaintV3(selection, job.plan) : null);
          applied = true;
          retainSmartContentResourcesV3(bus, appearance.release);
          return id;
        } finally { if (!applied) await appearance.release(); }
      }, markApplied: layerId => update(job.taskId, { layerId }),
      save: async () => { await saveImageEditDocumentInstanceV3(job.documentId, true); },
    });
    const present = Boolean(findPlaced(bus.getSnapshot().document.layers, job.taskId));
    update(job.taskId, { status: present ? 'placed' : 'cancelled', progress: 100, layerId: present ? layerId : undefined, error: undefined });
    logger.info('扩图已进入当前文档', { event: 'image_edit.outpaint.placed', taskId: job.taskId, context: { documentId: job.documentId, layerId } });
  } catch (error) {
    if (signal.aborted) update(job.taskId, { status: 'cancelled' });
    else { update(job.taskId, { status: 'failed', error: error instanceof Error ? error.message : String(error) }); logger.error('扩图未完成，可恢复原生成结果', error, { event: 'image_edit.outpaint.failed', taskId: job.taskId }); }
  } finally { release(); if (controllers.get(job.taskId) === controller) controllers.delete(job.taskId); }
}

/** 提交后立即返回，生成占位独立于工具面板与视图生命周期。费用确认由界面或正式 R2 调用边界负责。 */
export async function startImageEditOutpaintV3(request: ImageEditOutpaintRequestV3, options: { operationId?: string; signal?: AbortSignal } = {}) {
  const prepared = await prepareImageEditOutpaintV3(request);
  const { bus } = requireImageEditDocumentInstanceV3(request.documentId);
  const taskId = options.operationId ?? createImageEditIdV3('outpaint-task');
  const existing = jobs.get(taskId);
  if (existing) {
    if (existing.documentId !== request.documentId) throw new Error('生成操作身份已属于其他图片');
    if (existing.status === 'failed') throw new Error('原扩图未完成，请恢复原任务，不要重复提交');
    return existing;
  }
  if (options.operationId && await databaseService.getHistoryById(taskId)) return recoverImageEditOutpaintV3(request.documentId, taskId);
  const release = leaseImageEditDocumentInstanceV3(request.documentId);
  const controller = new AbortController(); controllers.set(taskId, controller);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal, bus.getLifecycleSignal()]) : AbortSignal.any([controller.signal, bus.getLifecycleSignal()]);
  const temporaryId = createImageEditIdV3('outpaint-reference');
  const temporaryRef = `image-edit-v3:${temporaryId}` as ImageEditorV3DocumentRef;
  let temporaryRevision: number | undefined;
  let submitted = false;
  jobs.set(taskId, { taskId, documentId: request.documentId, plan: prepared.plan, status: 'preparing', progress: 0 }); update(taskId, {});
  try {
    signal.throwIfAborted();
    const original = structuredClone(bus.getSnapshot().document);
    if (original.revision !== prepared.plan.sourceVersion) throw new Error('图片在检查后已改变，请重新确认扩图');
    const resized = applyImageEditCommandV3(original, createDocumentGeometryCommandV3(original, prepared.plan.output, [1, 0, 0, 1, prepared.plan.offset.x, prepared.plan.offset.y], `${taskId}:reference-size`)).document;
    const padded = { ...resized, id: temporaryId, revision: 0, namedRegions: [], color: { ...resized.color, bitDepth: 8 as const, transferFunction: 'srgb' as const } };
    const ref = await saveImageEditorV3Document({ requestId: `${taskId}:reference-save`, document: padded, expectedRevision: 0,
      resourceRefs: collectImageEditJsonResourceIdsV3(padded) as ImageEditorV3ResourceRef[], history: null });
    temporaryRevision = ref.revision;
    const snapshot = await loadImageEditorV3Document({ requestId: `${taskId}:reference-read`, documentRef: temporaryRef }, signal);
    if (!snapshot) throw new Error('扩图参考画面没有保存成功');
    const materialized = await materializeImageEditSnapshotV3(snapshot, 'outpaint-reference.png', signal);
    signal.throwIfAborted();
    const path = materialized.raster.mediaUrl;
    const prompt = `Extend the image naturally into the transparent margins of the reference canvas. Keep the existing image at its reference position unchanged. Fill only the transparent added margins on all requested sides, matching perspective, lighting and texture. Output a complete canvas of aspect ${prepared.plan.output.width}:${prepared.plan.output.height}. ${request.prompt}`;
    const task = await generationApplicationService.submit({ modelId: prepared.modelId, mediaType: 'image', prompt,
      options: { ...prepared.params, images: [toFetchableMediaUrl(path)], uploadedFilePaths: [path], imageEditOutpaint: { documentId: request.documentId, margins: request.margins, original: prepared.plan.original } } }, taskId);
    if (task.taskId !== taskId) throw new Error('生成任务身份与扩图落点不一致，请从生成记录核对');
    submitted = true;
    if (signal.aborted) controller.abort(signal.reason);
    update(taskId, { status: signal.aborted ? 'cancelled' : 'generating' });
    // 参考保留到生成完成（提交只入队，供应商上传可能尚未开始）。
    void complete(jobs.get(taskId)!, controller, false).finally(async () => {
      try { await deleteImageEditorV3DocumentIfRevision({ requestId: `${taskId}:reference-delete`, documentRef: temporaryRef, expectedRevision: temporaryRevision! }); }
      catch (error) { logger.warn('扩图参考清理未确认', { event: 'image_edit.outpaint.reference_cleanup_failed', error, taskId }); }
    });
    if (signal.aborted) await cancelImageEditOutpaintV3(taskId);
    return jobs.get(taskId)!;
  } catch (error) {
    const cancellationFailed = submitted && jobs.get(taskId)?.status === 'failed';
    if (!cancellationFailed) update(taskId, { status: signal.aborted ? 'cancelled' : 'failed', error: signal.aborted ? undefined : error instanceof Error ? error.message : String(error) });
    if (!submitted) controllers.delete(taskId);
    throw signal.aborted && !cancellationFailed ? signal.reason : error;
  } finally {
    release();
    if (!submitted && temporaryRevision !== undefined) await deleteImageEditorV3DocumentIfRevision({ requestId: `${taskId}:reference-delete`, documentRef: temporaryRef, expectedRevision: temporaryRevision }).catch(error => logger.warn('扩图参考清理未确认', { event: 'image_edit.outpaint.reference_cleanup_failed', error, taskId }));
  }
}

export async function recoverImageEditOutpaintV3(documentId: string, taskId: string): Promise<ImageEditOutpaintJobV3> {
  if (controllers.has(taskId)) { const current = jobs.get(taskId)!; if (current.documentId !== documentId) throw new Error('扩图任务与图片文档不一致'); return current; }
  const { bus } = await ensureImageEditDocumentInstanceV3(documentId);
  let job = jobs.get(taskId);
  if (!job) {
    const record = await databaseService.getHistoryById(taskId);
    const metadata = storedOutpaintSchema.parse(record?.params.imageEditOutpaint);
    if (metadata.documentId !== documentId) throw new Error('扩图任务与图片文档不一致');
    const plan = restorePlan(metadata);
    job = { taskId, documentId, plan, status: 'placing', progress: 0, layerId: findApplied(bus, taskId) };
    jobs.set(taskId, job);
  }
  if (job.documentId !== documentId) throw new Error('扩图任务与图片文档不一致');
  update(taskId, { status: 'placing', error: undefined });
  const controller = new AbortController(); controllers.set(taskId, controller);
  void complete(jobs.get(taskId)!, controller, true);
  return jobs.get(taskId)!;
}
export async function cancelImageEditOutpaintV3(taskId: string): Promise<void> {
  const job = jobs.get(taskId);
  if (!job || job.layerId || job.status === 'placed') return;
  controllers.get(taskId)?.abort(new DOMException('已取消扩图', 'AbortError'));
  update(taskId, { status: 'cancelled' });
  if (job.status === 'preparing') return;
  try { if (generationApplicationService.getTask(taskId).cancellable) await generationApplicationService.cancelTask(taskId, '已在图片编辑器取消扩图'); }
  catch (error) {
    const message = '已停止回填，但供应商取消未确认，请从生成记录核对费用与结果';
    update(taskId, { status: 'failed', error: message });
    logger.warn(message, { event: 'image_edit.outpaint.cancel_failed', error, taskId });
    throw new Error(message, { cause: error });
  }
}
