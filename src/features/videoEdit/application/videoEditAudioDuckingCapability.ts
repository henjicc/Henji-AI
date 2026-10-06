import type { z } from 'zod'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { generateVideoEditAudioDuckingCapability } from '@/core/application-control/domains/videoEdit/videoEditAudioDuckingCapability'
import { generateVideoEditAudioDucking } from './videoEditAudioDucking'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'

export async function executeVideoEditAudioDuckingCapability(input: z.infer<typeof generateVideoEditAudioDuckingCapability.inputSchema>, signal?: AbortSignal): Promise<z.infer<typeof generateVideoEditAudioDuckingCapability.outputSchema>> {
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
  const ids = input.musicClipRefs.map(ref => { const target = splitVideoEditRef(ref); if (target.projectId !== id || !target.childId) throw new Error('musicClipRefs 必须属于 documentRef 指定的剪辑。'); return target.childId })
  if (new Set(ids).size !== ids.length) throw new Error('musicClipRefs 不能重复。')
  const sequence = owner.document.sequences.find(sequence => ids.every(id => sequence.clips.some(clip => clip.id === id)))
  if (!sequence) throw new Error('音乐片段必须属于同一序列。')
  const changed = await generateVideoEditAudioDucking({ projectId: id, sequenceId: sequence.id, clipIds: ids }, input.settings, signal)
  const expected = owner.document
  try { await saveVideoEdit(id) } catch (error) {
    throw new ApplicationPersistenceFailure('回避已生成但未保存，请重试保存，不要重复生成。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error)
  }
  const verified = requireVideoEditInstance(id) === owner && owner.document === expected && await verifyVideoEditSaved(id, expected)
  return { resultRef: input.documentRef, clipRefs: changed.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })), message: '已根据目标声音生成音乐回避，手动关键帧已保留，可一步撤销。', verified }
}
