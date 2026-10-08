import type { VideoEditDocument } from './document'
import type { CodeMaterialInstance, CodeMaterialVersion } from './codeMaterialPersistence'
import type { CodeMaterialProgram } from './codeMaterial/contract'
import { CodeMaterialError } from './codeMaterial/contract'
import { prepareCodeMaterialParameters } from './codeMaterialAnimation'
import { codeMaterialImageIds } from './codeMaterialResources'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame } from './codeMaterialTiming'
import { validateVideoEditTransitions, videoEditTransitionWindow } from './transitions'
import { videoEditEffectCodes } from './compositing'

export type CodeMaterialMetadata = Pick<CodeMaterialProgram, 'name' | 'kind' | 'mode' | 'width' | 'height' | 'durationSeconds' | 'seed' | 'parameters' | 'types'>
export type CodeMaterialMetadataReader = (instance: CodeMaterialInstance) => CodeMaterialMetadata
export function videoEditCodeReferences(document: VideoEditDocument): CodeMaterialInstance[] {
  return [
    ...(document.codeMaterials ?? []).map(definition => ({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} })),
    ...document.items.flatMap(item => item.code ? [item.code] : []),
    ...document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(clip.effects)])),
  ]
}
export function codeMaterialSource(document: Pick<VideoEditDocument, 'codeMaterials'>, instance: CodeMaterialInstance): CodeMaterialVersion {
  const version = document.codeMaterials?.find(definition => definition.id === instance.definitionId)?.versions.find(version => version.id === instance.versionId)
  if (!version) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在，请恢复原源码引用。')
  return version
}
/** Metadata is checked against source by the host Worker, never trusted from the file. */
export function validateCodeMaterialDocument(document: VideoEditDocument, read: CodeMaterialMetadataReader): void {
  const images = new Set(document.media.filter(media => media.kind === 'image').map(media => media.id))
  const validate = (instance: CodeMaterialInstance, program: CodeMaterialMetadata): void => {
    prepareCodeMaterialParameters(program, instance)
    for (const mediaId of codeMaterialImageIds(instance)) if (!images.has(mediaId)) throw new CodeMaterialError('PARAMETERS', '图片参数引用不属于此剪辑，或引用的素材不是图片。')
  }
  for (const definition of document.codeMaterials ?? []) read({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} })
  for (const item of document.items) if (item.code) {
    if (item.elementOverrides && codeMaterialSource(document, item.code).languageVersion !== 3) throw new CodeMaterialError('TYPE', '元素覆盖需要第三版代码生成素材。')
    const program = read(item.code)
    if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜应作为附加效果使用，不能直接创建生成素材项。')
    validate(item.code, program)
  }
  for (const sequence of document.sequences) {
    for (const clip of sequence.clips) {
      if (clip.code) {
        if (clip.elementOverrides && codeMaterialSource(document, clip.code).languageVersion !== 3) throw new CodeMaterialError('TYPE', '元素覆盖需要第三版代码生成素材。')
        const program = read(clip.code)
        if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '代码片段需要生成素材。')
        validate(clip.code, program)
        codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program)
      }
      for (const code of videoEditEffectCodes(clip.effects)) {
        const program = read(code)
        if (program.kind !== 'filter') throw new CodeMaterialError('TYPE', '附加效果必须使用单输入滤镜源码。')
        validate(code, program)
        codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program)
      }
    }
    for (const transition of sequence.transitions ?? []) {
      const window = videoEditTransitionWindow(sequence, transition)
      for (const clip of [window.left, window.right]) for (const instance of [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(clip.effects)]) {
        const program = read(instance)
        codeMaterialContextForTransitionFrame(clip, window.start, sequence.frameRate, program, window)
        codeMaterialContextForTransitionFrame(clip, window.end - 1, sequence.frameRate, program, window)
      }
    }
  }
  validateVideoEditTransitions(document, read)
}
