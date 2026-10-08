import { prepareVideoEditSubtitleCapability, generateVideoEditSubtitleCapability, translateVideoEditSubtitleCapability, segmentVideoEditSubtitleCapability } from '@/core/application-control/domains/videoEdit/videoEditSubtitleCapabilities'
import { generateVideoEditBilingualSubtitles } from './videoEditBilingualSubtitles'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { prepareVideoEditSubtitleAudio, generateVideoEditSubtitles, segmentVideoEditSubtitles, verifyAutoSubtitles } from './videoEditAutoSubtitles'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit } from './videoEditService'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

export async function handleVideoEditSubtitleCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  if (![prepareVideoEditSubtitleCapability.id, generateVideoEditSubtitleCapability.id, translateVideoEditSubtitleCapability.id, segmentVideoEditSubtitleCapability.id].includes(id)) return undefined
  const child = (projectId: string, ref: { kind: string; id: string }): string => {
    const split = splitVideoEditRef(ref)
    if (split.projectId !== projectId || !split.childId) throw new ApplicationPreflightFailure('序列与轨道引用须属于指定剪辑。')
    return split.childId
  }
  if (id === prepareVideoEditSubtitleCapability.id) {
    const input = prepareVideoEditSubtitleCapability.inputSchema.parse(raw)
    const audioId = await prepareVideoEditSubtitleAudio(input.documentRef.id, child(input.documentRef.id, input.sequenceRef), input.scope, input.trackRef ? child(input.documentRef.id, input.trackRef) : undefined, context.signal)
    return { documentRef: input.documentRef, audioDocumentRef: { kind: 'audio_edit.document', id: audioId }, message: '声音已准备，可转录生成字幕；识别可能计费。', verified: true }
  }
  if (id === segmentVideoEditSubtitleCapability.id) {
    const input = segmentVideoEditSubtitleCapability.inputSchema.parse(raw)
    const result = segmentVideoEditSubtitles(input.documentRef.id, child(input.documentRef.id, input.sequenceRef), { maxCharacters: input.maxCharacters, maxLines: input.maxLines }, input.captionRefs?.map(ref => child(input.documentRef.id, ref)))
    await saveVideoEdit(input.documentRef.id)
    const refs = (ids: string[]): Array<{ kind: string; id: string }> => ids.map(id => ({ kind: 'video_edit.caption', id: `${input.documentRef.id}:${id}` }))
    return { documentRef: input.documentRef, captionRefs: refs(result.captionIds), createdCaptionRefs: refs(result.createdIds), updatedCaptionRefs: refs(result.updatedIds), message: `已整理为 ${result.captionIds.length} 条字幕。`, verified: await verifyAutoSubtitles(input.documentRef.id) }
  }
  if (id === translateVideoEditSubtitleCapability.id) {
    const input = translateVideoEditSubtitleCapability.inputSchema.parse(raw)
    const sequenceId = child(input.documentRef.id, input.sequenceRef)
    const ids = await generateVideoEditBilingualSubtitles(input.documentRef.id, sequenceId, { targetLanguage: input.targetLanguage, providerId: input.providerId, modelId: input.modelId, captionIds: input.captionRefs?.map(ref => child(input.documentRef.id, ref)) }, context.signal, context.requestId)
    return { documentRef: input.documentRef, captionRefs: ids.map(id => ({ kind: 'video_edit.caption', id: `${input.documentRef.id}:${id}` })), message: `已生成 ${ids.length} 条双语字幕。`, verified: await verifyAutoSubtitles(input.documentRef.id) }
  }
  const input = generateVideoEditSubtitleCapability.inputSchema.parse(raw)
  const sequenceId = child(input.documentRef.id, input.sequenceRef)
  const previous = new Set(requireVideoEditInstance(input.documentRef.id).document.sequences.find(sequence => sequence.id === sequenceId)?.captions?.map(caption => caption.id))
  const ids = await generateVideoEditSubtitles(input.documentRef.id, sequenceId, input.audioDocumentRef.id, input.modelId, { maxCharacters: input.maxCharacters, maxLines: input.maxLines, pauseSeconds: input.pauseSeconds, minDurationSeconds: input.minDurationSeconds, language: input.language }, context.signal, context.requestId)
  const captionRefs = ids.map(id => ({ kind: 'video_edit.caption', id: `${input.documentRef.id}:${id}` }))
  return { documentRef: input.documentRef, audioDocumentRef: input.audioDocumentRef, captionRefs, createdCaptionRefs: captionRefs.filter((_ref, index) => !previous.has(ids[index])), message: `已生成 ${ids.length} 段字幕，可逐行校正或导出 SRT。`, verified: await verifyAutoSubtitles(input.documentRef.id) }
}
