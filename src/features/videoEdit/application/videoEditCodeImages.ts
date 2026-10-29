import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { withVideoEditCurrentMetadata, editVideoProject, requireVideoEditInstance } from './videoEditService'
import { validateCodeMaterialParameterValue } from '@/core/videoEdit/codeMaterial/parameters'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditCodeTarget } from './videoEditCodeParameters'
import { ensureVideoEditCodeParameterMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { importVideoEditSources } from './videoEditMedia'
import { trialVideoEditCodeDocument } from './videoEditCodeTrial'

export type VideoEditCodeImageBinding = { kind: 'media'; mediaId: string; time?: number } | { kind: 'below' } | { kind: 'file'; path: string } | { kind: 'asset'; assetId: string } | null
/** 现有图片选择与生成结果导入共用的候选文档检查；调用方负责一次提交。 */
export async function prepareVideoEditCodeImageBinding(target: VideoEditCodeTarget, key: string, document: VideoEditDocument, mediaId: string | null, contentVersion: number, signal?: AbortSignal, time?: number, below = false): Promise<VideoEditDocument> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(target.projectId)
  const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === target.clipId)
  const code = target.effectId ? clip?.effects?.find(effect => effect.id === target.effectId)?.code : clip?.code
  if (!code || !clip || !sequence || code.versionId !== target.versionId) throw new Error('原代码片段或源码版本已改变，请重新选择。')
  await ensureVideoEditCodeParameterMetadata(owner, document, code.definitionId, code.versionId, signal)
  const declaration = readVideoEditCodeMetadata(owner, document)(code).parameters.find(parameter => parameter.key === key)
  if (!declaration || !['image', 'audio'].includes(declaration.type)) throw new Error('此参数不是媒体引用。')
  const media = mediaId ? document.media.find(media => media.id === mediaId) : undefined
  if (mediaId && (!media || !(declaration.type === 'audio' ? ['audio', 'video'] : ['image', 'video']).includes(media.kind))) throw new Error('请选择与参数类型匹配的剪辑素材。')
  if (below && declaration.type !== 'image') throw new Error('下方画面只能绑定 image 参数。')
  code.parameters[key] = validateCodeMaterialParameterValue(declaration, below ? { kind: 'sequence', mediaId: 'below' } : media ? { kind: declaration.type === 'audio' ? 'audio' : media.kind, mediaId: media.id, ...(time === undefined ? {} : { time }) } : null)
  const frame = Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.activeSequenceId === target.sequenceId ? owner.frame : owner.sequenceViews.get(target.sequenceId)?.frame ?? clip.start))
  await trialVideoEditCodeDocument(owner, contentVersion, document, sequence.id, frame, signal, [{ sequenceId: sequence.id, clipId: clip.id, ...(target.effectId ? { effectIds: [target.effectId] } : {}) }])
  return document
}
export async function bindVideoEditCodeImage(target: VideoEditCodeTarget, key: string, input: VideoEditCodeImageBinding, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document; const contentVersion = owner.contentVersion
  const bind = (document: VideoEditDocument, mediaId: string | null): Promise<VideoEditDocument> => prepareVideoEditCodeImageBinding(target, key, document, mediaId, contentVersion, signal, input?.kind === 'media' ? input.time : undefined, input?.kind === 'below')
  if (!input || input.kind === 'media' || input.kind === 'below') {
    const document = await bind(structuredClone(baseline), input?.kind === 'media' ? input.mediaId : null)
    signal?.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('原剪辑已关闭或内容已改变，请重新选择素材。')
    editVideoProject(target.projectId, current => withVideoEditCurrentMetadata(document, current)); return
  }
  signal?.throwIfAborted()
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('原剪辑已关闭或内容已改变，请重新选择素材。')
  await importVideoEditSources(target.projectId, [input.kind === 'asset' ? { assetId: input.assetId } : { path: input.path }], undefined, signal, async (document, ids) => {
    const item = document.items.find(item => item.id === ids[0])
    if (!item?.mediaId || !['image', 'video', 'audio'].includes(item.kind)) throw new Error('此参数只接受媒体文件。')
    return bind(document, item.mediaId)
  })
}
export async function chooseVideoEditCodeImage(target: VideoEditCodeTarget, key: string, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(target.projectId)
  const contentVersion = owner.contentVersion
  const path = await getPlatform().system.dialog.open({ filters: [{ name: '媒体', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif', 'mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'm4a', 'ogg'] }] })
  if (!path || Array.isArray(path)) return
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('原剪辑已关闭或内容已改变，请重新选择素材。')
  await bindVideoEditCodeImage(target, key, { kind: 'file', path }, signal)
}
