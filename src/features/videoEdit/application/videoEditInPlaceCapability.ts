import { applicationGenerationTaskId } from '@/core/application-control/operationIdentity'
import {
  generateVideoEditInPlaceCapability, getVideoEditInPlaceGenerationCapability, prepareVideoEditInPlaceGenerationCapability, switchVideoEditClipTakeCapability,
  type VideoEditInPlaceCapabilityInput,
} from '@/core/application-control/domains/videoEdit/videoEditInPlaceGenerationCapabilities'
import { type VideoEditInPlaceIntent, type VideoEditInPlacePlan } from '@/core/videoEdit/inPlaceGeneration'
import { videoEditFps } from '@/core/videoEdit/time'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { findVideoEditInPlaceJobByTask, prepareVideoEditInPlace, startVideoEditInPlaceGeneration, switchVideoEditClipTakeInProject, videoEditInPlaceActionLabel, videoEditInPlaceReferenceLabel, selectedVideoEditInPlaceReferences, videoEditInPlaceDefaultParams, type VideoEditInPlaceRequest } from './videoEditInPlaceGeneration'

/** 助手入口只把引用与秒换成界面同一份请求（时间线帧、轨道编号、片段 ID），之后与时间线右键走同一个服务。 */
function childOf(projectId: string, ref: { kind: string; id: string }): string {
  const value = splitVideoEditRef(ref)
  if (value.projectId !== projectId || !value.childId) throw new Error(`${ref.kind} 必须属于目标剪辑，请使用目录返回的完整引用。`)
  return value.childId
}
function toRequest(input: VideoEditInPlaceCapabilityInput): VideoEditInPlaceRequest {
  const projectId = input.documentRef.id
  const owner = requireVideoEditInstance(projectId)
  const sequenceId = input.sequenceRef ? childOf(projectId, input.sequenceRef) : owner.activeSequenceId
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('sequenceRef 指向的序列不存在。')
  const fps = videoEditFps(sequence.frameRate)
  const frames = (value: number | undefined): number | undefined => value === undefined ? undefined : Math.max(1, Math.round(value * fps))
  const trackIndex = (ref: { kind: string; id: string } | undefined, kind: 'video' | 'audio'): number | undefined => {
    if (!ref) return undefined
    const track = sequence.tracks.find(value => value.id === childOf(projectId, ref))
    if (!track) throw new Error(`trackRef 不是这个序列的轨道；可用的${kind === 'video' ? '视频' : '音频'}轨道：${sequence.tracks.filter(value => value.kind === kind).map(value => `${projectId}:${value.id}（${value.name}）`).join('、')}。`)
    return track.index
  }
  const target = input.target
  let intent: VideoEditInPlaceIntent
  switch (target.action) {
    case 'generate_shot': intent = { action: 'generate_shot', frame: Math.round(target.startSeconds * fps), duration: frames(target.durationSeconds), trackIndex: trackIndex(target.trackRef, 'video') }; break
    case 'replace_shot': intent = { action: 'replace_shot', clipId: childOf(projectId, target.clipRef) }; break
    case 'extend_shot': intent = { action: 'extend_shot', clipId: childOf(projectId, target.clipRef), duration: frames(target.durationSeconds), mode: target.mode }; break
    case 'generate_audio': intent = target.clipRef ? { action: 'generate_audio', clipId: childOf(projectId, target.clipRef) } : { action: 'generate_audio', frame: Math.round(target.startSeconds! * fps), duration: frames(target.durationSeconds), trackIndex: trackIndex(target.trackRef, 'audio') }; break
  }
  for (const key of Object.keys(intent) as Array<keyof VideoEditInPlaceIntent>) if (intent[key] === undefined) delete intent[key]
  return { projectId, sequenceId, intent, prompt: input.prompt, ...(input.modelId ? { modelId: input.modelId } : {}), ...(input.params ? { params: input.params } : {}),
    ...(input.useReferenceFrames === false ? { referenceRoles: [] } : input.referenceRoles !== undefined ? { referenceRoles: input.referenceRoles } : {}),
    ...(input.referenceTimeSeconds !== undefined ? { referenceFrame: Math.round(input.referenceTimeSeconds * fps) } : {}),
  }
}
function planSummary(projectId: string, plan: VideoEditInPlacePlan, references: string[]) {
  const owner = requireVideoEditInstance(projectId)
  const track = owner.document.sequences.find(value => value.id === plan.sequenceId)?.tracks.find(value => value.index === plan.trackIndex)
  return {
    action: plan.action, sequenceRef: { kind: 'video_edit.sequence' as const, id: `${projectId}:${plan.sequenceId}` }, startSeconds: Number((plan.frame / plan.fps).toFixed(3)), durationSeconds: Number((plan.duration / plan.fps).toFixed(3)),
    trackRef: track ? { kind: 'video_edit.track' as const, id: `${projectId}:${track.id}` } : null, placement: plan.placement, references,
  }
}

export async function handleVideoEditInPlaceCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  if (id === prepareVideoEditInPlaceGenerationCapability.id) {
    const input = prepareVideoEditInPlaceGenerationCapability.inputSchema.parse(raw)
    const prepared = await prepareVideoEditInPlace(toRequest(input))
    const references = prepared.references.map(reference => videoEditInPlaceReferenceLabel(reference, prepared.plan.fps))
    return { documentRef: input.documentRef, plan: planSummary(input.documentRef.id, prepared.plan, references), preparation: prepared.preparation,
      message: `${videoEditInPlaceActionLabel(prepared.plan.action)}：${(prepared.plan.frame / prepared.plan.fps).toFixed(2)} 秒起约 ${(prepared.plan.duration / prepared.plan.fps).toFixed(1)} 秒，模型 ${prepared.modelId}${references.length ? `，参考 ${references.join('、')}` : '，不带参考帧'}。` }
  }
  if (id === generateVideoEditInPlaceCapability.id) {
    const input = generateVideoEditInPlaceCapability.inputSchema.parse(raw)
    const taskId = applicationGenerationTaskId(context.requestId ?? crypto.randomUUID())
    // 同一操作重放时返回原任务，不重复生成。
    const existing = findVideoEditInPlaceJobByTask(taskId)
    const request = toRequest(input)
    const started = existing ? { job: existing, taskId } : await startVideoEditInPlaceGeneration(request, { taskId })
    const references = selectedVideoEditInPlaceReferences(started.job.plan, started.job.request, started.job.modelId,
      { ...videoEditInPlaceDefaultParams(started.job.modelId, started.job.plan), ...started.job.request.params })
      .map(reference => videoEditInPlaceReferenceLabel(reference, started.job.plan.fps))
    return { documentRef: input.documentRef, taskRef: { kind: 'generation.task', id: started.taskId }, plan: planSummary(input.documentRef.id, started.job.plan, references), status: 'submitted',
      message: `已提交${videoEditInPlaceActionLabel(started.job.plan.action)}，时间线上已放占位。用 wait_generation_task 等待，再用 get_video_edit_in_place_generation 确认落位。` }
  }
  if (id === getVideoEditInPlaceGenerationCapability.id) {
    const input = getVideoEditInPlaceGenerationCapability.inputSchema.parse(raw)
    const job = findVideoEditInPlaceJobByTask(input.taskRef.id)
    if (!job || job.projectId !== input.documentRef.id) throw new Error('这个剪辑里没有该任务的原地生成记录，请先打开原剪辑恢复占位。已经落位或移除的占位不再恢复，生成结果仍可从生成历史放入。')
    let progress: number | undefined
    if (job.status === 'generating') try { progress = Math.max(0, Math.min(100, generationApplicationService.getTask(input.taskRef.id).progress)) } catch { progress = undefined }
    const clipRef = job.clipId ? { kind: 'video_edit.clip' as const, id: `${job.projectId}:${job.clipId}` } : undefined
    const messages = { preparing: '正在取参考帧并提交。', generating: '生成中，占位在时间线上。', placing: '生成完成，正在复制进项目并落进时间线。', failed: `生成没有完成：${job.error ?? '原因未知'}。占位保留错误，可换模型重新生成。`, placed: job.fallback === 'slot_taken' ? '已落进时间线；原落点在生成期间被占用，放到了新建的轨道上。' : job.fallback === 'clip_missing' ? '已落进时间线；原片段已删除，放在原位置的新轨道上。' : '已落进时间线并保存，可一次撤销移除。', cancelled: '已取消，剪辑没有改动。' }
    return { documentRef: input.documentRef, taskRef: input.taskRef, status: job.status, ...(progress !== undefined ? { progress } : {}), ...(clipRef ? { clipRef } : {}), ...(job.error ? { error: job.error } : {}), message: messages[job.status] }
  }
  if (id === switchVideoEditClipTakeCapability.id) {
    const input = switchVideoEditClipTakeCapability.inputSchema.parse(raw)
    const projectId = input.documentRef.id; const clipId = childOf(projectId, input.clipRef)
    const owner = requireVideoEditInstance(projectId)
    const sequence = owner.document.sequences.find(value => value.clips.some(clip => clip.id === clipId))
    if (!sequence) throw new Error('clipRef 指向的片段不存在。')
    context.signal.throwIfAborted()
    switchVideoEditClipTakeInProject(projectId, sequence.id, clipId, input.takeIndex ?? 0)
    await saveVideoEdit(projectId)
    const verified = await verifyVideoEditSaved(projectId, requireVideoEditInstance(projectId).document)
    return { resultRef: input.clipRef, documentRef: input.documentRef, message: '已切换镜头版本并保存，原来的画面保留为可切回的版本。', verification: { verified, target: input.clipRef, condition: '已从剪辑文件回读并核对片段内容。' } }
  }
  return undefined
}
