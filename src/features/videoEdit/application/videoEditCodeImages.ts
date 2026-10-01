import { validateCodeMaterialParameterValue } from '@/core/videoEdit/codeMaterial/parameters'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditCodeTarget } from './videoEditCodeParameters'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import { importVideoEditSources } from './videoEditMedia'
import { trialVideoEditCodeDocument } from './videoEditCodeTrial'

export type VideoEditCodeImageBinding = { kind: 'media'; mediaId: string } | { kind: 'file'; path: string } | { kind: 'asset'; assetId: string } | null
export async function bindVideoEditCodeImage(target: VideoEditCodeTarget, key: string, input: VideoEditCodeImageBinding, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document
  const bind = async (document: VideoEditDocument, mediaId: string | null): Promise<VideoEditDocument> => {
    const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
    const clip = sequence?.clips.find(clip => clip.id === target.clipId)
    const code = target.effectId ? clip?.effects?.find(effect => effect.id === target.effectId)?.code : clip?.code
    if (!code || !clip || !sequence || code.versionId !== target.versionId) throw new Error('原代码片段或源码版本已改变，请重新选择。')
    const declaration = readVideoEditCodeMetadata(owner, document)(code).parameters.find(parameter => parameter.key === key)
    if (!declaration || declaration.type !== 'image') throw new Error('此参数不是图片引用。')
    if (mediaId && !document.media.some(media => media.id === mediaId && media.kind === 'image')) throw new Error('请选择此工程中的图片。')
    code.parameters[key] = validateCodeMaterialParameterValue(declaration, mediaId ? { kind: 'image', mediaId } : null)
    const frame = Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.activeSequenceId === target.sequenceId ? owner.frame : owner.sequenceViews.get(target.sequenceId)?.frame ?? clip.start))
    await trialVideoEditCodeDocument(owner, baseline, document, sequence.id, frame, signal, [{ sequenceId: sequence.id, clipId: clip.id, ...(target.effectId ? { effectIds: [target.effectId] } : {}) }])
    return document
  }
  if (!input || input.kind === 'media') {
    const document = await bind(structuredClone(baseline), input?.mediaId ?? null)
    signal?.throwIfAborted()
    if (requireVideoEditInstance(target.projectId) !== owner || owner.document !== baseline) throw new Error('原工程已关闭或内容已改变，请重新选择图片。')
    editVideoProject(target.projectId, () => document); return
  }
  signal?.throwIfAborted()
  if (requireVideoEditInstance(target.projectId) !== owner || owner.document !== baseline) throw new Error('原工程已关闭或内容已改变，请重新选择图片。')
  await importVideoEditSources(target.projectId, [input.kind === 'asset' ? { assetId: input.assetId } : { path: input.path }], undefined, signal, async (document, ids) => {
    const item = document.items.find(item => item.id === ids[0])
    if (!item?.mediaId || item.kind !== 'image') throw new Error('此参数只接受图片文件。')
    return bind(document, item.mediaId)
  })
}
export async function chooseVideoEditCodeImage(target: VideoEditCodeTarget, key: string, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(target.projectId)
  const baseline = owner.document
  const path = await getPlatform().system.dialog.open({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif'] }] })
  if (!path || Array.isArray(path)) return
  if (requireVideoEditInstance(target.projectId) !== owner || owner.document !== baseline) throw new Error('原工程已关闭或内容已改变，请重新选择图片。')
  await bindVideoEditCodeImage(target, key, { kind: 'file', path }, signal)
}
