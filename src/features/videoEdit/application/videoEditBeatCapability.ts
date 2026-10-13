import { verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'
import type { z } from 'zod'
import { analyzeVideoEditBeatsCapability } from '@/core/application-control/domains/videoEdit/videoEditBeatCapability'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { analyzeVideoEditBeats } from './videoEditBeatAnalysis'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit } from './videoEditService'
export async function executeVideoEditBeatCapability(input: z.infer<typeof analyzeVideoEditBeatsCapability.inputSchema>, signal?: AbortSignal): Promise<z.infer<typeof analyzeVideoEditBeatsCapability.outputSchema>> {
  const id = input.documentRef.id, owner = requireVideoEditInstance(id), sequence = splitVideoEditRef(input.sequenceRef), clip = input.clipRef ? splitVideoEditRef(input.clipRef) : undefined
  if (sequence.projectId !== id || !sequence.childId || clip && (clip.projectId !== id || !clip.childId)) throw new Error('sequenceRef 和 clipRef 必须属于 documentRef 指定的剪辑。')
  const markers = await analyzeVideoEditBeats({ projectId: id, sequenceId: sequence.childId, clipId: clip?.childId }, signal)
  const expected = owner.document; const contentVersion = owner.contentVersion
  try { await saveVideoEdit(id) } catch (error) {
    throw new ApplicationPersistenceFailure('节拍已生成但未保存，请重试保存。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error)
  }
  const verified = await verifyVideoEditContentSaved(owner, expected, contentVersion)
  return { resultRef: input.documentRef, markerRefs: markers.map(marker => ({ kind: 'video_edit.marker', id: `${id}:${marker.id}` })), message: '已生成节拍标记。', verified }
}
