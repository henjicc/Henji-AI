import { videoEditLostCodeClipReferences } from '@/core/videoEdit/codeClipReferences'
import type { VideoEditDocument } from '@/core/videoEdit/document'

export const VIDEO_EDIT_CODE_CLIP_REFERENCE_CASCADE = { declarationId: 'video_edit.code_clip_reference_detach', effect: 'update' as const, entityType: 'video_edit.clip', propertyIds: ['video_edit.clip.code_parameters'], revisionScopes: ['video_edit'] }

export interface VideoEditLostCodeClipReferenceReport {
  fact: string
  references: Array<{ clipRef: { kind: string; id: string }; clipName: string; effectRef?: { kind: string; id: string }; parameter: string; targetClipRef: { kind: string; id: string }; targetClipName: string }>
}

/** 比较一次编辑前后的文档：哪些片段的哪些代码参数因为被引用的片段不在了而变空。没有时返回 undefined。 */
export function videoEditLostCodeClipReferenceReport(before: VideoEditDocument, after: VideoEditDocument): VideoEditLostCodeClipReferenceReport | undefined {
  const references = before.sequences.flatMap(previous => {
    const sequence = after.sequences.find(value => value.id === previous.id)
    if (!sequence || sequence.clips === previous.clips) return []
    return videoEditLostCodeClipReferences(previous.clips, sequence.clips).map(reference => ({
      clipRef: { kind: 'video_edit.clip', id: `${after.id}:${reference.clipId}` },
      clipName: previous.clips.find(clip => clip.id === reference.clipId)!.name,
      ...(reference.effectId ? { effectRef: { kind: 'video_edit.effect', id: `${after.id}:${reference.effectId}` } } : {}),
      parameter: reference.parameter,
      targetClipRef: { kind: 'video_edit.clip', id: `${after.id}:${reference.targetClipId}` },
      targetClipName: previous.clips.find(clip => clip.id === reference.targetClipId)!.name,
    }))
  })
  if (!references.length) return undefined
  const listed = references.slice(0, 5).map(reference => `片段“${reference.clipName}”的参数 ${reference.parameter}（原来引用“${reference.targetClipName}”）`).join('；')
  return { references, fact: `${listed}${references.length > 5 ? `；等共 ${references.length} 处` : ''}：被引用的片段已不在序列里，这些参数现在为空。需要时请重新绑定。`.slice(0, 1000) }
}
