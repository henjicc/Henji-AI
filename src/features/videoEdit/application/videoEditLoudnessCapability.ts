import type { z } from 'zod'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { measureVideoEditLoudnessCapability, normalizeVideoEditLoudnessCapability } from '@/core/application-control/domains/videoEdit/videoEditLoudnessCapabilities'
import { applyVideoEditAudioGain, measureVideoEditClips, type VideoEditGainTarget } from './videoEditLoudness'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'

type Input = z.infer<typeof measureVideoEditLoudnessCapability.inputSchema> & { targetLufs?: number }
type Output = z.infer<typeof measureVideoEditLoudnessCapability.outputSchema>
export async function executeVideoEditLoudnessCapability(input: Input, normalize: boolean, signal?: AbortSignal): Promise<Output> {
  const owner = requireVideoEditInstance(input.documentRef.id)
  const ids = input.clipRefs.map(ref => { const target = splitVideoEditRef(ref); if (target.projectId !== input.documentRef.id || !target.childId) throw new Error('clipRefs 必须属于目标剪辑。'); return target.childId })
  if (new Set(ids).size !== ids.length) throw new Error('clipRefs 不能重复。')
  const sequence = owner.document.sequences.find(sequence => ids.every(id => sequence.clips.some(clip => clip.id === id)))
  if (!sequence) throw new Error('所选片段必须属于同一序列。')
  const clips = sequence.clips.filter(clip => ids.includes(clip.id))
  const target: VideoEditGainTarget = { projectId: input.documentRef.id, sequenceId: sequence.id, clipIds: ids }
  if (!normalize) {
    const measurements = await measureVideoEditClips(target, signal)
    return { resultRef: input.documentRef, results: clips.map((clip, index) => ({ clipRef: { kind: 'video_edit.clip', id: `${target.projectId}:${clip.id}` }, volume: clip.volume, measurement: measurements[index] })), message: '已测量所选片段的声音，未修改音量。', verified: true }
  }
  const parsed = normalizeVideoEditLoudnessCapability.inputSchema.parse(input)
  const changes = await applyVideoEditAudioGain(target, 'loudness', parsed.targetLufs, signal)
  const expected = owner.document
  try { await saveVideoEdit(target.projectId) } catch (error) {
    throw new ApplicationPersistenceFailure('响度已调整但未保存，请重试保存，不要重复标准化。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error)
  }
  const verified = requireVideoEditInstance(target.projectId) === owner && owner.document === expected && await verifyVideoEditSaved(target.projectId, expected)
  return { resultRef: input.documentRef, results: changes.map(change => ({ clipRef: { kind: 'video_edit.clip', id: `${target.projectId}:${change.clipId}` }, volume: change.volume, measurement: change.measurement! })), message: `所选声音已标准化到 ${parsed.targetLufs} LUFS，可一步撤销。`, verified }
}
