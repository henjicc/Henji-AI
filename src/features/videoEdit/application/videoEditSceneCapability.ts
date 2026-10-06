import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { detectVideoEditScenesCapability, applyVideoEditScenesCapability } from '@/core/application-control/domains/videoEdit/videoEditSceneCapabilities'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { splitVideoEditRef } from './videoEditReflection'
import { applyVideoEditScenes, detectVideoEditScenes, type VideoEditSceneTarget } from './videoEditSceneDetection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'

function targetOf(input: { documentRef: { id: string }; clipRef: { kind: string; id: string } }): VideoEditSceneTarget {
  const ref = splitVideoEditRef(input.clipRef)
  if (ref.projectId !== input.documentRef.id || !ref.childId) throw new Error('clipRef 必须属于目标剪辑，请使用目录返回的完整引用。')
  const sequence = requireVideoEditInstance(ref.projectId).document.sequences.find(sequence => sequence.clips.some(clip => clip.id === ref.childId))
  if (!sequence) throw new Error('原视频片段已不存在，请重新读取片段目录。')
  return { projectId: ref.projectId, sequenceId: sequence.id, clipId: ref.childId }
}
export async function handleVideoEditSceneCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  if (id === detectVideoEditScenesCapability.id) {
    const input = detectVideoEditScenesCapability.inputSchema.parse(raw)
    const result = await detectVideoEditScenes(targetOf(input), input.sensitivity, context.signal)
    return { ...result, resultRef: input.documentRef, message: `发现 ${result.cutFrames.length} 个镜头切点，可批量应用。` }
  }
  if (id !== applyVideoEditScenesCapability.id) return undefined
  const input = applyVideoEditScenesCapability.inputSchema.parse(raw); const target = targetOf(input)
  const owner = requireVideoEditInstance(target.projectId)
  const result = await applyVideoEditScenes(target, input.analysisId, input.options, context.signal)
  const expected = owner.document
  try { await saveVideoEdit(target.projectId) } catch (error) { throw new ApplicationPersistenceFailure('切点已应用但未保存，请重试保存，不要重复应用。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
  const verified = requireVideoEditInstance(target.projectId) === owner && owner.document === expected && await verifyVideoEditSaved(target.projectId, expected)
  const changedRefs = [
    ...result.clipIds.map(id => ({ kind: 'video_edit.clip' as const, id: `${target.projectId}:${id}` })),
    ...result.markerIds.map(id => ({ kind: 'video_edit.marker' as const, id: `${target.projectId}:${id}` })),
    ...result.itemIds.map(id => ({ kind: 'video_edit.item' as const, id: `${target.projectId}:${id}` })),
  ]
  return { resultRef: input.documentRef, changedRefs, cutFrames: result.cutFrames, verified, message: '镜头切点已应用，可一步撤销。' }
}
