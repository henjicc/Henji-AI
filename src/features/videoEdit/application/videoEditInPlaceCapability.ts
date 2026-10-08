import { applicationGenerationTaskId } from '@/core/application-control/operationIdentity'
import {
  generateVideoEditInPlaceCapability, getVideoEditInPlaceGenerationCapability, prepareVideoEditInPlaceGenerationCapability, switchVideoEditClipTakeCapability,
  type VideoEditInPlaceCapabilityInput,
  recoverVideoEditInPlaceGenerationCapability, discardVideoEditInPlaceGenerationCapability,
} from '@/core/application-control/domains/videoEdit/videoEditInPlaceGenerationCapabilities'
import { type VideoEditInPlaceIntent, type VideoEditInPlacePlan } from '@/core/videoEdit/inPlaceGeneration'
import { videoEditFps } from '@/core/videoEdit/time'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { VideoEditOperationFailure } from '@/core/videoEdit/operationFailure'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { findVideoEditInPlaceJobByTask, findVideoEditPlacedGeneration, requireVideoEditFailedGeneration, assertVideoEditInPlaceRegeneration, retryVideoEditInPlaceJob, dismissVideoEditInPlaceJob, prepareVideoEditInPlace, startVideoEditInPlaceGeneration, switchVideoEditClipTakeInProject, videoEditInPlaceActionLabel, videoEditInPlaceReferenceLabel, selectedVideoEditInPlaceReferences, videoEditInPlaceDefaultParams, type VideoEditInPlaceRequest } from './videoEditInPlaceGeneration'

/** 助手入口只把引用与秒换成界面同一份请求（时间线帧、轨道编号、片段 ID），之后与时间线右键走同一个服务。 */
function childOf(projectId: string, ref: { kind: string; id: string }): string {
  const value = splitVideoEditRef(ref)
  if (value.projectId !== projectId || !value.childId) throw referenceFailure(projectId, ref.kind)
  return value.childId
}
function referenceFailure(projectId: string, kind: string, sequenceId?: string): VideoEditOperationFailure {
  const sequences = requireVideoEditInstance(projectId).document.sequences.filter(sequence => !sequenceId || sequence.id === sequenceId)
  const availableRefs = kind === 'video_edit.sequence' ? sequences.map(value => ({ kind, id: `${projectId}:${value.id}` })) : sequences.flatMap(sequence => sequence.clips.map(value => ({ kind: 'video_edit.clip', id: `${projectId}:${value.id}` })))
  return new VideoEditOperationFailure(`请使用目标剪辑当前可用的 ${kind} 引用：${availableRefs.map(ref => ref.id).join('、') || '无'}。`, { reason: 'reference_missing', availableRefs })
}
function toRequest(input: VideoEditInPlaceCapabilityInput): VideoEditInPlaceRequest {
  const projectId = input.documentRef.id
  const owner = requireVideoEditInstance(projectId)
  const sequenceId = input.sequenceRef ? childOf(projectId, input.sequenceRef) : owner.activeSequenceId
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw referenceFailure(projectId, 'video_edit.sequence')
  const fps = videoEditFps(sequence.frameRate)
  const frames = (value: number | undefined): number | undefined => value === undefined ? undefined : Math.max(1, Math.round(value * fps))
  const trackIndex = (ref: { kind: string; id: string } | undefined, kind: 'video' | 'audio'): number | undefined => {
    if (!ref) return undefined
    const track = sequence.tracks.find(value => value.id === childOf(projectId, ref))
    if (!track) throw new Error(`trackRef 不是这个序列的轨道；可用的${kind === 'video' ? '视频' : '音频'}轨道：${sequence.tracks.filter(value => value.kind === kind).map(value => `${projectId}:${value.id}（${value.name}）`).join('、')}。`)
    return track.index
  }
  const target = input.target
  if ('clipRef' in target && target.clipRef && !sequence.clips.some(clip => clip.id === childOf(projectId, target.clipRef!))) throw referenceFailure(projectId, 'video_edit.clip', sequenceId)
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
    if (input.replacesTaskRef) await assertVideoEditInPlaceRegeneration(requireVideoEditFailedGeneration(input.documentRef.id, input.replacesTaskRef.id))
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
    const original = !existing && input.replacesTaskRef ? requireVideoEditFailedGeneration(input.documentRef.id, input.replacesTaskRef.id) : undefined
    const started = existing ? { job: existing, taskId } : await startVideoEditInPlaceGeneration(request, { taskId, ...(original ? { replacesJobId: original.id } : {}) })
    const references = selectedVideoEditInPlaceReferences(started.job.plan, started.job.request, started.job.modelId,
      { ...videoEditInPlaceDefaultParams(started.job.modelId, started.job.plan), ...started.job.request.params })
      .map(reference => videoEditInPlaceReferenceLabel(reference, started.job.plan.fps))
    return { documentRef: input.documentRef, taskRef: { kind: 'generation.task', id: started.taskId }, plan: planSummary(input.documentRef.id, started.job.plan, references), status: 'submitted',
      message: `已提交${videoEditInPlaceActionLabel(started.job.plan.action)}，时间线上已放占位。用 wait_generation_task 等待，再用 get_video_edit_in_place_generation 确认落位。` }
  }
  if (id === getVideoEditInPlaceGenerationCapability.id) {
    const input = getVideoEditInPlaceGenerationCapability.inputSchema.parse(raw)
    requireVideoEditInstance(input.documentRef.id)
    const job = findVideoEditInPlaceJobByTask(input.taskRef.id)
    if (!job || job.projectId !== input.documentRef.id || job.status === 'placed') {
      const placed = findVideoEditPlacedGeneration(input.documentRef.id, input.taskRef.id)
      if (placed) return { documentRef: input.documentRef, taskRef: input.taskRef, status: 'placed', clipRef: { kind: 'video_edit.clip', id: `${input.documentRef.id}:${placed.clipId}` }, ...(placed.takeIndex !== undefined ? { takeIndex: placed.takeIndex } : {}), message: placed.takeIndex !== undefined ? `结果已保存在片段镜头版本 ${placed.takeIndex}，可切回。` : '结果已落进当前剪辑，可读取片段核对。' }
      if (!job || job.status === 'placed' || job.projectId !== input.documentRef.id) throw new Error('当前剪辑中没有该任务的占位、片段或镜头版本。请核对原剪辑与任务引用；已撤销或删除的结果可从生成历史读取。')
    }
    let progress: number | undefined
    if (job.status === 'generating') try { progress = Math.max(0, Math.min(100, generationApplicationService.getTask(input.taskRef.id).progress)) } catch { progress = undefined }
    const clipRef = job.clipId ? { kind: 'video_edit.clip' as const, id: `${job.projectId}:${job.clipId}` } : undefined
    const messages = { preparing: '正在取参考帧并提交。', generating: '生成中，占位在时间线上。', placing: '生成完成，正在复制进项目并落进时间线。', failed: `原地生成未完成：${job.error ?? '原因未知'}。请先用 recover_video_edit_in_place_generation 恢复原结果落位或保存；只有确认原生成失败才携带 replacesTaskRef 重新付费提交。`, placed: job.fallback === 'slot_taken' ? '已落进时间线；原落点在生成期间被占用，放到了新建的轨道上。' : job.fallback === 'clip_missing' ? '已落进时间线；原片段已删除，放在原位置的新轨道上。' : '已落进时间线并保存，可一次撤销移除。', cancelled: '已取消，剪辑没有改动。' }
    return { documentRef: input.documentRef, taskRef: input.taskRef, status: job.status, ...(progress !== undefined ? { progress } : {}), ...(clipRef ? { clipRef } : {}), ...(job.error ? { error: job.error } : {}), message: messages[job.status] }
  }
  if (id === recoverVideoEditInPlaceGenerationCapability.id || id === discardVideoEditInPlaceGenerationCapability.id) {
    const input = recoverVideoEditInPlaceGenerationCapability.inputSchema.parse(raw)
    context.signal.throwIfAborted()
    const current = findVideoEditInPlaceJobByTask(input.taskRef.id)
    if (id === recoverVideoEditInPlaceGenerationCapability.id) {
      if (current?.projectId === input.documentRef.id && current.status === 'placing') return { ...input, status: 'placing', message: '原任务正在恢复，请查询落位结果。' }
      if ((!current || current.status === 'placed') && findVideoEditPlacedGeneration(input.documentRef.id, input.taskRef.id)) {
        await saveVideoEdit(input.documentRef.id)
        return { ...input, status: 'placed', message: '原结果已保留在片段或镜头版本中，保存已确认，未重新生成。' }
      }
    }
    const job = requireVideoEditFailedGeneration(input.documentRef.id, input.taskRef.id)
    if (id === recoverVideoEditInPlaceGenerationCapability.id) {
      const resumed = await retryVideoEditInPlaceJob(job.id, { recoveryOnly: true })
      return { ...input, status: resumed.job.status, message: '已恢复原任务结果，未发起新的付费生成。请查询最终落位状态。' }
    }
    dismissVideoEditInPlaceJob(job.id)
    try { await saveVideoEdit(input.documentRef.id) } catch (error) {
      throw new ApplicationPersistenceFailure('失败占位已移除，保存尚未确认。请重试保存，不要重复移除或生成。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error)
    }
    const verified = await verifyVideoEditSaved(input.documentRef.id, requireVideoEditInstance(input.documentRef.id).document)
    return { ...input, status: 'removed', verified, message: '失败占位已移除并保存；生成历史与已编辑片段保留。' }
  }
  if (id === switchVideoEditClipTakeCapability.id) {
    const input = switchVideoEditClipTakeCapability.inputSchema.parse(raw)
    const projectId = input.documentRef.id; const clipId = childOf(projectId, input.clipRef)
    const owner = requireVideoEditInstance(projectId)
    const sequence = owner.document.sequences.find(value => value.clips.some(clip => clip.id === clipId))
    if (!sequence) throw referenceFailure(projectId, 'video_edit.clip')
    context.signal.throwIfAborted()
    switchVideoEditClipTakeInProject(projectId, sequence.id, clipId, input.takeIndex ?? 0)
    await saveVideoEdit(projectId)
    const verified = await verifyVideoEditSaved(projectId, requireVideoEditInstance(projectId).document)
    return { resultRef: input.clipRef, documentRef: input.documentRef, message: '已切换镜头版本并保存，原来的画面保留为可切回的版本。', verification: { verified, target: input.clipRef, condition: '已从剪辑文件回读并核对片段内容。' } }
  }
  return undefined
}
