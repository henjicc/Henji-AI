import { applicationGenerationTaskId } from '@/core/application-control/operationIdentity';
import { applicationWritePreflight } from '@/core/application-control/execution/writeExecution';
import { generateImageEditOutpaintCapability, getImageEditOutpaintCapability, prepareImageEditOutpaintCapability, recoverImageEditOutpaintCapability } from '@/core/application-control/domains/imageEdit/imageEditOutpaintCapabilities';
import type { ApplicationCapabilityHandlerRegistrar, CapabilityExecutionContext } from '@/features/application-control';

import { ensureImageEditDocumentInstanceV3 } from '../v3/application/imageEditDocumentLoading';
import { imageEditV3LayerRef, splitImageEditV3DocumentRef } from '../v3/application/imageEditDocumentRefs';
import { requireImageEditPersistenceOwnerV3 } from '../v3/application/imageEditPersistenceOperations';
import { prepareImageEditOutpaintV3, readImageEditOutpaintJobV3, recoverImageEditOutpaintV3, startImageEditOutpaintV3, type ImageEditOutpaintJobV3 } from '../v3/application/imageEditOutpaintServiceV3';

async function assertHost(documentId: string, context: CapabilityExecutionContext, _write: boolean): Promise<void> {
  context.signal.throwIfAborted();
  await ensureImageEditDocumentInstanceV3(documentId);
  const owner = requireImageEditPersistenceOwnerV3(documentId);
  owner.assertCurrent();

}
function status(job: ImageEditOutpaintJobV3, documentRef: { kind: 'image_edit.document'; id: string }) {
  return { documentRef, taskRef: { kind: 'generation.task', id: job.taskId }, status: job.status, progress: job.progress,
    ...(job.layerId ? { layerRef: imageEditV3LayerRef(job.documentId, job.layerId) } : {}), ...(job.error ? { error: job.error } : {}),
    message: job.status === 'placed' ? '扩图已进入当前图片并保存，可读回新层或撤销。' : job.status === 'failed' ? '请恢复原任务，不要重复生成。' : '扩图任务已登记，请继续读取落位状态。' };
}
export function registerImageEditOutpaintHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  registrar.registerHandler(prepareImageEditOutpaintCapability.id, async (input, context) => {
    const parsed = prepareImageEditOutpaintCapability.inputSchema.parse(input), { documentId } = splitImageEditV3DocumentRef(parsed.documentRef);
    await assertHost(documentId, context, false);
    const prepared = await prepareImageEditOutpaintV3({ documentId, margins: parsed.margins, prompt: parsed.prompt, modelId: parsed.modelId, params: parsed.params });
    return { documentRef: parsed.documentRef, preparation: prepared.preparation, message: '扩图参数已检查；将按所选模型计费，生成后进入当前图片的新层。' };
  });
  registrar.registerHandler(generateImageEditOutpaintCapability.id, async (input, context) => {
    const parsed = generateImageEditOutpaintCapability.inputSchema.parse(input), { documentId } = splitImageEditV3DocumentRef(parsed.documentRef);
    const operationId = await applicationWritePreflight(context, async () => {
      await assertHost(documentId, context, true);
      const id = context.taskId ?? context.requestId;
      if (!id) throw new Error('扩图需要正式操作身份，请通过应用能力执行入口调用');
      return applicationGenerationTaskId(id);
    });
    const job = await startImageEditOutpaintV3({ documentId, margins: parsed.margins, prompt: parsed.prompt, modelId: parsed.modelId, params: parsed.params }, { operationId, signal: context.signal });
    context.execution?.report({ billing: 'submitted' });
    return { documentRef: parsed.documentRef, taskRef: { kind: 'generation.task', id: job.taskId }, status: 'submitted', verified: readImageEditOutpaintJobV3(job.taskId)?.documentId === documentId, message: '扩图已提交；请读回原任务，等待结果落入当前图片。' };
  });
  registrar.registerHandler(getImageEditOutpaintCapability.id, async (input, context) => {
    const parsed = getImageEditOutpaintCapability.inputSchema.parse(input), { documentId } = splitImageEditV3DocumentRef(parsed.documentRef);
    await assertHost(documentId, context, false);
    const job = readImageEditOutpaintJobV3(parsed.taskRef.id);
    if (!job || job.documentId !== documentId) throw new Error('原扩图任务尚未恢复，请按原任务引用调用恢复扩图');
    return status(job, parsed.documentRef);
  });
  registrar.registerHandler(recoverImageEditOutpaintCapability.id, async (input, context) => {
    const parsed = recoverImageEditOutpaintCapability.inputSchema.parse(input), { documentId } = splitImageEditV3DocumentRef(parsed.documentRef);
    await applicationWritePreflight(context, () => assertHost(documentId, context, true));
    const recovered = await recoverImageEditOutpaintV3(documentId, parsed.taskRef.id);
    const current = readImageEditOutpaintJobV3(parsed.taskRef.id);
    return { ...status(recovered, parsed.documentRef), verification: { verified: current?.documentId === documentId && ['generating', 'placing', 'placed'].includes(current.status), condition: '从原扩图任务源回读确认恢复等待、落位或保存已生效；最终结果请查询原任务。' } };
  });
}
