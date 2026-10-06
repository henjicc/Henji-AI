import type { z } from 'zod'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { reframeVideoEditCapability } from '@/core/application-control/domains/videoEdit/videoEditReframeCapability'
import { reframeVideoEdit, type VideoEditReframeResult } from './videoEditReframe'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { enqueueVideoEditExports } from './videoEditExportQueue'
import { videoEditExportPresetLibrary } from './videoEditExportPresets'
import { videoEditTrackerEntityId } from './videoEditCompositeEntities'

export function videoEditReframeMessage(result: VideoEditReframeResult): string {
  return `已${result.created ? '创建新序列并' : ''}自动重构画幅，可一步撤销。${result.faceFrames ? '部分画面按人脸构图，请检查人物取景。' : ''}${result.missingFrames ? '部分画面未找到主体，已保持构图，请检查取景。' : ''}`
}
/** Queue errors are reported separately: an already generated sequence must never be replayed. */
export async function queueVideoEditReframe(projectId: string, sequenceId: string, presetId: string, signal?: AbortSignal): Promise<{ exportJobIds: string[]; exportIssue?: string }> {
  try {
    const preset = videoEditExportPresetLibrary.list().find(preset => preset.id === presetId)
    if (!preset || preset.settings.format !== 'mp4') throw new Error('请选择已有的视频导出预设。')
    const sequence = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)!
    if (!preset.settings.keepSequenceSize && preset.settings.width * sequence.height !== preset.settings.height * sequence.width) throw new Error('导出预设画幅与重构结果不同，请选择相同画幅的预设。')
    const jobs = await enqueueVideoEditExports([{ projectId, sequenceId, presetId }], signal)
    return jobs.length ? { exportJobIds: jobs.map(job => job.id) } : { exportJobIds: [], exportIssue: '已取消输出文件选择，重构结果已保留。' }
  } catch (error) { return { exportJobIds: [], exportIssue: `重构结果已保留，加入导出失败：${error instanceof Error ? error.message : String(error)}。请用现有导出入口重试导出。` } }
}
export async function executeVideoEditReframeCapability(input: z.infer<typeof reframeVideoEditCapability.inputSchema>, signal?: AbortSignal): Promise<z.infer<typeof reframeVideoEditCapability.outputSchema>> {
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
  const target = splitVideoEditRef(input.sequenceRef ?? input.clipRef!)
  if (target.projectId !== id) throw new Error('目标引用必须属于 documentRef。')
  const sequence = owner.document.sequences.find(sequence => input.sequenceRef ? sequence.id === target.childId : sequence.clips.some(clip => clip.id === target.childId))
  if (!sequence) throw new Error('目标序列或片段不存在。')
  const trackers: Record<string, string> = {}
  for (const binding of input.trackerBindings) {
    const clip = splitVideoEditRef(binding.clipRef); const tracker = splitVideoEditRef(binding.trackerRef)
    const targetClip = sequence.clips.find(value => value.id === clip.childId)
    // Composite tracker refs include the owning clip ID.
    const found = targetClip?.trackers?.find(value => tracker.childId === videoEditTrackerEntityId(targetClip.id, value.id))
    if (clip.projectId !== id || tracker.projectId !== id || !found || input.clipRef && targetClip?.id !== target.childId) throw new Error('trackerBindings 必须引用目标序列内对应片段自己的跟踪器。')
    if (trackers[clip.childId]) throw new Error('同一片段不能重复绑定跟踪器。')
    trackers[clip.childId] = found.id
  }
  const result = await reframeVideoEdit({ projectId: id, sequenceId: sequence.id, ...(input.clipRef ? { clipId: target.childId } : {}) }, { size: input.targetSize, name: input.name, settings: input.settings, trackers }, signal)
  const expected = owner.document
  try { await saveVideoEdit(id) } catch (error) { throw new ApplicationPersistenceFailure('自动重构已完成但未保存，请重试保存，不要重复生成。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
  const verified = requireVideoEditInstance(id) === owner && owner.document === expected && await verifyVideoEditSaved(id, expected)
  const exported = input.exportPresetRef && verified ? await queueVideoEditReframe(id, result.sequenceId, input.exportPresetRef.id, signal) : { exportJobIds: [] }
  return { resultRef: { kind: 'video_edit.sequence', id: `${id}:${result.sequenceId}` }, documentRef: input.documentRef, clipRefs: result.clipIds.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })), created: result.created, missingFrames: result.missingFrames, faceFrames: result.faceFrames, ...exported, message: videoEditReframeMessage(result) + (exported.exportIssue ?? '') + (exported.exportJobIds.length ? '已加入导出队列，请查询完成状态。' : ''), verified }
}
