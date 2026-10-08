import { registry } from '@/core/ModelRegistry'
import { createLogger } from '@/core/logging'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { generationService } from '@/core/services/GenerationService'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import type { CodeDrawCommand } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditDocument, VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { readVideoEditCodeEditor, type VideoEditCodeTarget } from './videoEditCodeParameters'
import { compileVideoEditCode } from './videoEditCodeState'
import { prepareVideoEditCodeImageBinding } from './videoEditCodeImages'
import { videoEditInPlaceDefaultParams, waitVideoEditGenerationTask } from './videoEditInPlaceGeneration'
import { prepareVideoEditCreativeResult } from './videoEditCreativeSources'
import { placeVideoEditFileInProject } from './videoEditResultTarget'
import { importVideoEditSources } from './videoEditMedia'
import { holdVideoEditActivity, requireVideoEditInstance, saveVideoEdit } from './videoEditService'
import { measureCodeText } from '../videoEditGlyphMetrics'

export const VIDEO_EDIT_CODE_IMAGE_DEFAULT_MODEL = 'kie-gpt-image-2'
const logger = createLogger('features.videoEdit.codeImageGeneration')
export interface CodeImageGenerationContext { prompt: string; width: number; height: number }
export interface CodeImageGenerationRequest {
  target: VideoEditCodeTarget; parameterKey: string; prompt: string; modelId?: string; params?: Record<string, unknown>
}
export interface CodeImageGenerationJob {
  id: string; request: CodeImageGenerationRequest; modelId: string; taskId: string
  status: 'generating' | 'placing' | 'placed' | 'failed' | 'cancelled'; progress: number
  mediaId?: string; error?: string; generated?: boolean
  bindingValue: string | null
}
const jobs = new Map<string, CodeImageGenerationJob>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let revision = 0
export function subscribeCodeImageGeneration(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function codeImageGenerationRevision(): number { return revision }
function publish(): void { revision++; for (const listener of listeners) listener() }
function update(job: CodeImageGenerationJob, patch: Partial<CodeImageGenerationJob>): void { Object.assign(job, patch); publish() }
export function sameCodeImageParameter(target: VideoEditCodeTarget, key: string, candidate: Pick<VideoEditCodeTarget, 'sequenceId' | 'clipId' | 'versionId' | 'effectId'> & { parameterKey: string }): boolean {
  return target.sequenceId === candidate.sequenceId && target.clipId === candidate.clipId && target.versionId === candidate.versionId && target.effectId === candidate.effectId && key === candidate.parameterKey
}
export function codeImageGenerationJobs(target: VideoEditCodeTarget, key: string): CodeImageGenerationJob[] {
  return [...jobs.values()].filter(job => job.request.target.projectId === target.projectId && sameCodeImageParameter(target, key, { ...job.request.target, parameterKey: job.request.parameterKey }))
}
export function codeImageGenerationCandidates(target: VideoEditCodeTarget, key: string): VideoEditMedia[] {
  return requireVideoEditInstance(target.projectId).document.media.filter(media => media.kind === 'image' && media.codeImageGeneration && sameCodeImageParameter(target, key, media.codeImageGeneration))
}
/** 仅在已检查的作者 IR 上求当前绘制矩形，不执行作者 JavaScript。 */
export async function prepareCodeImageGenerationContext(target: VideoEditCodeTarget, key: string, signal?: AbortSignal): Promise<CodeImageGenerationContext> {
  const editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId, target.effectId)
  if (editor.target.versionId !== target.versionId) throw new Error('原代码版本已改变，请重新打开生成面板。')
  const parameter = editor.metadata.parameters.find(parameter => parameter.key === key && parameter.type === 'image')
  if (!parameter) throw new Error('此参数不是图片引用。')
  const program = await compileVideoEditCode(editor.files, signal)
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(target.projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!
  let width = program.width; let height = program.height
  if (program.kind === 'generator') {
    const marker = `image-parameter-${key}`
    const values = { ...editor.parameters, [key]: { kind: 'image', mediaId: marker } }
    const time = (editor.sourceTime.sourceInUs + editor.sourceTime.sourceRemainder.numerator / editor.sourceTime.sourceRemainder.denominator) / 1e6
    const fps = videoEditFps(sequence.frameRate)
    const draws = evaluateCodeMaterial(program, { time, localTime: time, sequenceTime: editor.frame / fps, width, height, frame: Math.floor(time * fps), fps }, values, { measureText: measureCodeText })
    const visit = (draws: CodeDrawCommand[]): void => {
      for (const draw of draws) {
        if (draw.kind === 'group') visit(draw.children)
        else if (draw.kind === 'image' && draw.source.mediaId === marker && draw.width > 0 && draw.height > 0 && (!found || draw.width * draw.height > width * height)) { width = draw.width; height = draw.height; found = true }
      }
    }
    let found = false; visit(draws)
  }
  return { prompt: `为「${editor.metadata.name}」创作「${parameter.title}」图片素材`, width, height }
}
/** 比例借用正式原地生成的语义参数换算，不认识模型的私有字段。 */
export function codeImageGenerationDefaultParams(modelId: string, context: Pick<CodeImageGenerationContext, 'width' | 'height'>): Record<string, unknown> {
  return videoEditInPlaceDefaultParams(modelId, { action: 'generate_shot', mediaType: 'video', sequenceId: '', width: Math.max(1, Math.round(context.width)), height: Math.max(1, Math.round(context.height)), fps: 30, frame: 0, duration: 30, fill: false, trackIndex: null, placement: 'add', references: [] })
}
export async function codeImageGenerationProviderConfigured(modelId: string): Promise<boolean> {
  const model = registry.getModel(modelId)
  return Boolean(model && (await generationService.getConfiguredProviders()).includes(model.meta.provider))
}
function targetCode(document: VideoEditDocument, target: VideoEditCodeTarget) {
  const clip = document.sequences.find(sequence => sequence.id === target.sequenceId)?.clips.find(clip => clip.id === target.clipId)
  return target.effectId ? clip?.effects?.find(effect => effect.id === target.effectId)?.code : clip?.code
}
async function land(job: CodeImageGenerationJob, signal: AbortSignal): Promise<void> {
  const { target, parameterKey, prompt } = job.request
  const owner = requireVideoEditInstance(target.projectId)
  const assertTarget = (): void => { signal.throwIfAborted(); if (requireVideoEditInstance(target.projectId) !== owner) throw new Error('原剪辑已关闭，图片保留在生成历史。') }
  const result = await prepareVideoEditCreativeResult({ type: 'generation', recordId: job.taskId, outputIndex: 0 }, { signal, assertTarget, place: path => placeVideoEditFileInProject(owner, path) })
  assertTarget()
  if (result.asset.mediaType !== 'image') throw new Error('生成结果不是图片，请选择图片模型。')
  await importVideoEditSources(target.projectId, [{ assetId: result.asset.id }], undefined, signal, async (document, ids) => {
    assertTarget()
    const media = document.media.find(media => document.items.some(item => ids.includes(item.id) && item.mediaId === media.id) && media.assetId === result.asset.id)
    if (!media) throw new Error('生成图片未能导入，请重试应用结果。')
    const current = targetCode(document, target)?.parameters[parameterKey]
    const currentId = typeof current === 'object' && current && 'mediaId' in current ? current.mediaId : null
    if (currentId !== job.bindingValue) throw new Error('生成期间此参数已选择其他图片。完成图片已保留，可点击“应用完成图片”确认替换。')
    const { projectId: _projectId, ...scope } = target
    media.codeImageGeneration = { ...scope, parameterKey, prompt, modelId: job.modelId, taskId: job.taskId, outputIndex: 0 }
    return await prepareVideoEditCodeImageBinding(target, parameterKey, document, media.id, owner.document, signal)
  })
  const media = codeImageGenerationCandidates(target, parameterKey).find(media => media.codeImageGeneration?.taskId === job.taskId)
  // 编辑已提交：保存失败重试只保存，不再次生成、导入或绑定。
  update(job, { mediaId: media?.id })
  await saveVideoEdit(target.projectId)
}
async function run(job: CodeImageGenerationJob, submit: boolean, controller: AbortController): Promise<void> {
  const { target } = job.request
  let release = (): void => undefined
  const signal = controller.signal
  try {
    release = holdVideoEditActivity(target.projectId, 'code-image-generation')
    if (submit) {
      await generationApplicationService.submit({ modelId: job.modelId, mediaType: 'image', prompt: job.request.prompt, options: job.request.params ?? {} }, job.taskId)
      if (signal.aborted) { await cancelTask(job); return }
      const outcome = await waitVideoEditGenerationTask(job.taskId, signal, false, progress => update(job, { progress }))
      signal.throwIfAborted()
      if (!outcome.ok) throw new Error(outcome.error)
      update(job, { generated: true })
    }
    update(job, { status: 'placing', error: undefined })
    if (job.mediaId) await saveVideoEdit(target.projectId)
    else await land(job, signal)
    update(job, { status: 'placed', progress: 100 })
    logger.info('代码图片已生成并绑定', { event: 'video_edit.code_image.completed', requestId: job.taskId, taskId: job.taskId, modelId: job.modelId, context: { ...target, parameterKey: job.request.parameterKey, mediaId: job.mediaId } })
  } catch (error) {
    if (signal.aborted && !job.mediaId) update(job, { status: 'cancelled' })
    else {
      update(job, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      logger.warn('代码图片生成或绑定未完成', { event: 'video_edit.code_image.failed', error, requestId: job.taskId, taskId: job.taskId, modelId: job.modelId, context: target })
    }
  } finally { release(); if (controllers.get(job.id) === controller) controllers.delete(job.id) }
}
export async function startCodeImageGeneration(request: CodeImageGenerationRequest): Promise<CodeImageGenerationJob> {
  const modelId = request.modelId ?? VIDEO_EDIT_CODE_IMAGE_DEFAULT_MODEL
  const model = registry.getModel(modelId)
  if (!model || model.meta.type !== 'image') throw new Error('请选择图片生成模型。')
  if (!await codeImageGenerationProviderConfigured(modelId)) throw new Error('所选供应商尚未配置密钥，请到设置中的“供应商与模型”配置后重试。')
  const context = await prepareCodeImageGenerationContext(request.target, request.parameterKey)
  const params = { ...codeImageGenerationDefaultParams(modelId, context), ...request.params }
  const prompt = request.prompt.trim()
  if (!prompt) throw new Error('请填写图片提示词。')
  generationApplicationService.prepare({ modelId, mediaType: 'image', prompt, options: params })
  const code = targetCode(requireVideoEditInstance(request.target.projectId).document, request.target)
  if (code?.versionId !== request.target.versionId) throw new Error('原代码版本已改变，请重新生成。')
  const id = crypto.randomUUID()
  const value = code.parameters[request.parameterKey]
  const bindingValue = isCodeImageReference(value) ? value.mediaId : null
  const job: CodeImageGenerationJob = { id, request: structuredClone({ ...request, prompt, params }), modelId, taskId: `code-image-${id}`, status: 'generating', progress: 0, bindingValue }
  jobs.set(id, job); publish()
  const controller = new AbortController(); controllers.set(id, controller)
  logger.info('代码图片生成开始', { event: 'video_edit.code_image.start', requestId: job.taskId, taskId: job.taskId, modelId, context: request.target })
  void run(job, true, controller)
  return job
}
async function cancelTask(job: CodeImageGenerationJob): Promise<void> {
  try { if (generationApplicationService.getTask(job.taskId).cancellable) await generationApplicationService.cancelTask(job.taskId, '已取消代码图片生成') }
  catch (error) { logger.warn('代码图片生成取消未确认', { event: 'video_edit.code_image.cancel.failed', error, requestId: job.taskId, taskId: job.taskId }) }
}
export async function cancelCodeImageGeneration(id: string): Promise<void> {
  const job = jobs.get(id)
  if (!job || !['generating', 'placing'].includes(job.status) || job.mediaId) return
  controllers.get(id)?.abort(); update(job, { status: 'cancelled' }); await cancelTask(job)
}
/** 成功图片的绑定/保存失败可重试应用，绝不再次付费。生成失败由用户明确再次生成。 */
export function retryCodeImageGenerationBinding(id: string): void {
  const job = jobs.get(id)
  if (!job || job.status !== 'failed' || !job.generated) throw new Error('此任务没有可重新应用的完成图片，请再次生成。')
  const current = targetCode(requireVideoEditInstance(job.request.target.projectId).document, job.request.target)?.parameters[job.request.parameterKey]
  job.bindingValue = isCodeImageReference(current) ? current.mediaId : null
  const controller = new AbortController(); controllers.set(id, controller)
  update(job, { status: 'placing', error: undefined }); void run(job, false, controller)
}
export function resetCodeImageGenerationForTest(): void { for (const controller of controllers.values()) controller.abort(); controllers.clear(); jobs.clear(); publish() }
