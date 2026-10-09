import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { imageEditSubjectRegionSchemaV3 } from '../../../src/core/imageEdit/v3/subjectSelection'
import { ensureLocalModel } from '../services/local-models/runtime'
import { getLocalInferenceHost } from '../services/smart-regions/runtime'
import { executionProviderOrder } from '../services/local-inference/providers'
import type { LocalInferenceModelFile } from '../services/local-inference/protocol'
import { registerIpcHandler } from './registry'
import { createMainLogger } from '../services/logging'

const schema = z.object({ requestId: z.string().min(1).max(256), width: z.number().int().positive().max(512), height: z.number().int().positive().max(512),
  rgba: z.custom<ArrayBuffer>(value => value instanceof ArrayBuffer), region: imageEditSubjectRegionSchemaV3 }).strict()
export function parseImageEditorV3SubjectPayload(value: unknown): z.infer<typeof schema> {
  const input = schema.parse(value)
  if (input.rgba.byteLength !== input.width * input.height * 4) throw new Error('主体选择工作图的像素长度不匹配')
  if (input.region.kind === 'box' && (input.region.x + input.region.width > 1 || input.region.y + input.region.height > 1)) throw new Error('主体框必须在画面范围内')
  return input
}
export function registerImageEditorV3SubjectIpc(deps: {
  guard(event: IpcMainInvokeEvent): void
  runRequest<T>(operation: string, requestId: string, senderId: number, work: (signal: AbortSignal) => Promise<T>, estimatedBytes?: number): Promise<T>
}): void {
  const logger = createMainLogger('ipc.image_editor_v3.subject')
  registerIpcHandler('imageEditorV3:selection:infer', parseImageEditorV3SubjectPayload, async (input, event) => {
    deps.guard(event)
    return deps.runRequest('select-region', input.requestId, event.sender.id, async signal => {
      signal.throwIfAborted()
      const id = randomUUID(), host = getLocalInferenceHost(), models: LocalInferenceModelFile[] = []
      const started = performance.now()
      logger.info('主体选择开始', { event: 'image_edit.subject.start', context: { requestId: id, kind: input.region.kind } })
      try {
        if (input.region.kind === 'portrait') {
          if (input.region.quality === 'fine') {
            try { const ready = await ensureLocalModel('person_matting_rvm'); models.push({ name: 'rvm', path: ready.files[0].path }) }
            catch (error) { signal.throwIfAborted(); logger.warn('人像抠像模型不可用', { event: 'image_edit.subject.model_fallback', error }) }
          }
          signal.throwIfAborted()
          try { const ready = await ensureLocalModel('selfie_segmentation'); models.push({ name: 'selfie', path: ready.files[0].path }) }
          catch (error) { signal.throwIfAborted(); if (!models.some(model => model.name === 'rvm')) throw error; logger.warn('快速人像回退模型不可用，继续精细模型', { event: 'image_edit.subject.fallback_unavailable', error }) }
        } else {
          const ready = await ensureLocalModel('object_tracking_efficienttam')
          for (const [suffix, name] of [['image_encoder.onnx', 'etam_image_encoder'], ['mask_decoder.onnx', 'etam_mask_decoder']] as const) {
            const file = ready.files.find(entry => entry.name.endsWith(suffix)); if (!file) throw new Error('主体选择模型文件未就绪，请重新下载')
            models.push({ name, path: file.path })
          }
        }
        signal.throwIfAborted()
        const abort = (): void => host.cancel(id)
        signal.addEventListener('abort', abort, { once: true })
        try {
          const result = await host.selectImageRegion({ id, width: input.width, height: input.height, rgba: input.rgba, region: input.region, models, providers: executionProviderOrder(process.platform) })
          signal.throwIfAborted()
          logger.info('主体选择完成', { event: 'image_edit.subject.completed', context: { requestId: id, model: result.model, providers: result.providers, inferenceMs: result.inferenceMs, durationMs: performance.now() - started } })
          return result
        } finally { signal.removeEventListener('abort', abort) }
      } catch (error) { logger.warn('主体选择未完成', { event: 'image_edit.subject.failed', error, context: { requestId: id, cancelled: signal.aborted } }); throw error }
    }, input.rgba.byteLength * 8)
  })
}
