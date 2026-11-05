import { videoEditLostCodeClipReferences, type VideoEditPastedClip } from '@/core/videoEdit/codeClipReferences'
import type { VideoEditDocument } from '@/core/videoEdit/document'

export const VIDEO_EDIT_CODE_CLIP_REFERENCE_CASCADE = { declarationId: 'video_edit.code_clip_reference_detach', effect: 'update' as const, entityType: 'video_edit.clip', propertyIds: ['video_edit.clip.code_parameters'], revisionScopes: ['video_edit'] }

export interface VideoEditLostCodeClipReferenceReport {
  fact: string
  references: Array<{ clipRef: { kind: string; id: string }; clipName: string; effectRef?: { kind: string; id: string }; parameter: string; targetClipRef: { kind: string; id: string }; targetClipName: string }>
}

/**
 * 比较一次编辑前后的文档：哪些片段的哪些代码参数因为被引用的片段不在同一序列了而变空。没有时返回 undefined。
 * `pasted` 是这次粘贴出的片段与它们的来源，粘贴到别的序列置空的引用靠它对照。
 */
export function videoEditLostCodeClipReferenceReport(before: VideoEditDocument, after: VideoEditDocument, pasted: readonly VideoEditPastedClip[] = []): VideoEditLostCodeClipReferenceReport | undefined {
  const clipNames = new Map(before.sequences.flatMap(sequence => sequence.clips.map(clip => [clip.id, clip.name] as const)))
  const references = before.sequences.flatMap(previous => {
    const sequence = after.sequences.find(value => value.id === previous.id)
    if (!sequence || sequence.clips === previous.clips) return []
    return videoEditLostCodeClipReferences(previous.clips, sequence.clips, pasted).map(reference => ({
      clipRef: { kind: 'video_edit.clip', id: `${after.id}:${reference.clipId}` },
      clipName: sequence.clips.find(clip => clip.id === reference.clipId)!.name,
      ...(reference.effectId ? { effectRef: { kind: 'video_edit.effect', id: `${after.id}:${reference.effectId}` } } : {}),
      parameter: reference.parameter,
      targetClipRef: { kind: 'video_edit.clip', id: `${after.id}:${reference.targetClipId}` },
      // 剪切后再粘贴时，被引用的片段可能早已不在工程里。
      targetClipName: clipNames.get(reference.targetClipId) ?? '已删除的片段',
    }))
  })
  if (!references.length) return undefined
  const listed = references.slice(0, 5).map(reference => `片段“${reference.clipName}”的参数 ${reference.parameter}（原来引用“${reference.targetClipName}”）`).join('；')
  return { references, fact: `${listed}${references.length > 5 ? `；等共 ${references.length} 处` : ''}：被引用的片段已不在同一序列里，这些参数现在为空。需要时请重新绑定。`.slice(0, 1000) }
}

/** 给界面的说法：参数键是作者代码里的内部名，用户看到的是参数显示名。声明没读到时只说“一个参数”。 */
export function videoEditLostCodeClipReferenceUserFact(report: VideoEditLostCodeClipReferenceReport, after: VideoEditDocument, program: (versionId: string) => { parameters: ReadonlyArray<{ key: string; title: string }> } | undefined): string {
  const child = (ref: { id: string }): string => ref.id.slice(after.id.length + 1)
  const clips = after.sequences.flatMap(sequence => sequence.clips)
  const listed = report.references.slice(0, 5).map(reference => {
    const clip = clips.find(value => value.id === child(reference.clipRef))
    const code = reference.effectRef ? clip?.effects?.find(effect => effect.id === child(reference.effectRef!))?.code : clip?.code
    const title = code && program(code.versionId)?.parameters.find(parameter => parameter.key === reference.parameter)?.title
    return `“${reference.clipName}”的${title ? `“${title}”` : '一个参数'}（原来引用“${reference.targetClipName}”）`
  }).join('；')
  return `${listed}${report.references.length > 5 ? `；等共 ${report.references.length} 处` : ''}现在为空：被引用的片段已不在同一序列里，需要时请重新绑定。`
}
