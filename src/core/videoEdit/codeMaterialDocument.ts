import { expandPinnedCodeComponents } from './codeMaterial/components'
import { documentCodeSourceResolver, resolveCodeMaterialFiles, type CodeMaterialFiles } from './codeMaterial/sources'
import type { VideoEditDocument } from './document'
import type { CodeMaterialInstance, CodeMaterialVersion } from './codeMaterialPersistence'
import type { CodeMaterialProgram } from './codeMaterial/contract'
import { CodeMaterialError } from './codeMaterial/contract'
import { prepareCodeMaterialParameters } from './codeMaterialAnimation'
import { isCodeImageReference, isCodeAudioReference } from './codeMaterial/contract'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame } from './codeMaterialTiming'
import { validateVideoEditTransitions, videoEditTransitionWindow } from './transitions'
import { videoEditEffectCodes } from './compositing'

export type CodeMaterialMetadata = Pick<CodeMaterialProgram, 'name' | 'kind' | 'mode' | 'seed' | 'parameters' | 'types'> & Partial<Pick<CodeMaterialProgram, 'width' | 'height' | 'durationSeconds'>>
export type CodeMaterialMetadataReader = (instance: CodeMaterialInstance) => CodeMaterialMetadata
export function videoEditCodeReferences(document: VideoEditDocument): CodeMaterialInstance[] {
  return [
    ...(document.codeMaterials ?? []).map(definition => ({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} })),
    ...document.items.flatMap(item => item.code ? [item.code] : []),
    ...document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(clip.effects)])),
  ]
}
export function codeMaterialSource(document: Pick<VideoEditDocument, 'codeMaterials'>, instance: CodeMaterialInstance): CodeMaterialVersion & { contents: CodeMaterialFiles; compilation: CodeMaterialFiles } {
  const version = codeMaterialVersion(document, instance)
  const resolver = documentCodeSourceResolver(document); const contents = resolveCodeMaterialFiles(version, resolver)
  return { ...version, contents, compilation: expandPinnedCodeComponents(contents, version.imports ?? [], resolver) }
}
export function codeMaterialVersion(document: Pick<VideoEditDocument, 'codeMaterials'>, instance: CodeMaterialInstance): CodeMaterialVersion {
  const version = document.codeMaterials?.find(definition => definition.id === instance.definitionId)?.versions.find(version => version.id === instance.versionId)
  if (!version) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在，请恢复原源码引用。')
  return version
}
/** Metadata is checked against source by the host Worker, never trusted from the file. */
export function validateCodeMaterialDocument(document: VideoEditDocument, read: CodeMaterialMetadataReader): void {
  const validate = (instance: CodeMaterialInstance, program: CodeMaterialMetadata): void => {
    prepareCodeMaterialParameters(program, instance)
    for (const value of Object.values(instance.parameters)) {
      if (isCodeImageReference(value) && value.kind !== 'sequence' && !document.media.some(media => media.id === value.mediaId && media.kind === value.kind)) throw new CodeMaterialError('PARAMETERS', '图片或视频参数引用与剪辑素材类型不一致。')
      if (isCodeAudioReference(value) && !document.media.some(media => media.id === value.mediaId && ['audio', 'video'].includes(media.kind))) throw new CodeMaterialError('PARAMETERS', '音频参数须引用剪辑中的音频或视频。')
    }
  }
  for (const definition of document.codeMaterials ?? []) read({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} })
  for (const item of document.items) if (item.code) {
    const program = read(item.code)
    if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜应作为附加效果使用，不能直接创建生成素材项。')
    validate(item.code, program)
  }
  for (const sequence of document.sequences) {
    for (const clip of sequence.clips) {
      if (clip.code) {
        const program = read(clip.code)
        if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '代码片段需要生成素材。')
        validate(clip.code, program)
        codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program, sequence)
      }
      for (const code of videoEditEffectCodes(clip.effects)) {
        const program = read(code)
        if (program.kind !== 'filter') throw new CodeMaterialError('TYPE', '附加效果必须使用单输入滤镜源码。')
        validate(code, program)
        codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program, sequence)
      }
    }
    for (const transition of sequence.transitions ?? []) {
      const window = videoEditTransitionWindow(sequence, transition)
      for (const clip of [window.left, window.right]) for (const instance of [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(clip.effects)]) {
        const program = read(instance)
        codeMaterialContextForTransitionFrame(clip, window.start, sequence.frameRate, program, window, sequence)
        codeMaterialContextForTransitionFrame(clip, window.end - 1, sequence.frameRate, program, window, sequence)
      }
    }
  }
  validateVideoEditTransitions(document, read)
}
