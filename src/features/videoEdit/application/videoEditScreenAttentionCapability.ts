import type { z } from 'zod'
import { screenAttentionVideoEditCapability } from '@/core/application-control/domains/videoEdit/videoEditScreenAttentionCapability'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { generateVideoEditScreenAttention } from './videoEditScreenAttention'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit } from './videoEditService'
import { verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'

export async function executeVideoEditScreenAttentionCapability(input: z.infer<typeof screenAttentionVideoEditCapability.inputSchema>, signal?: AbortSignal): Promise<z.infer<typeof screenAttentionVideoEditCapability.outputSchema>> {
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
  const target = splitVideoEditRef(input.clipRef ?? input.sequenceRef!)
  if (target.projectId !== id) throw new Error('clipRef 或 sequenceRef 必须属于 documentRef。')
  const sequence = owner.document.sequences.find(value => input.sequenceRef ? value.id === target.childId : value.clips.some(clip => clip.id === target.childId))
  if (!sequence) throw new Error('目标片段或序列不存在，请重新读取剪辑。')
  const result = await generateVideoEditScreenAttention({ projectId: id, sequenceId: sequence.id, ...(input.clipRef ? { clipId: target.childId } : {}) }, { settings: input.settings, size: input.targetSize, name: input.name }, signal)
  const expected = owner.document; const version = owner.contentVersion
  try { await saveVideoEdit(id) } catch (error) { throw new ApplicationPersistenceFailure('注意力推近已生成但未保存，请重试保存，不要重复生成。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
  const verified = await verifyVideoEditContentSaved(owner, expected, version)
  return { documentRef: input.documentRef, resultRef: { kind: 'video_edit.sequence', id: `${id}:${result.sequenceId}` }, clipRefs: result.clipIds.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })), created: result.created, quietFrames: result.quietFrames, impreciseCapabilities: result.impreciseCapabilities, verified,
    message: `已${result.created ? '创建新画幅并' : ''}生成注意力推近，可修改关键帧或一步撤销。${result.impreciseCapabilities ? '部分操作没有捕获时的目标区域，已按可用信号估计，请检查取景。' : ''}` }
}
