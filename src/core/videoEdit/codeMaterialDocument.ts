import type { VideoEditDocument } from './document'
import type { CodeMaterialInstance, CodeMaterialVersion } from './codeMaterialPersistence'
import type { CodeMaterialProgram } from './codeMaterial/contract'
import { CodeMaterialError } from './codeMaterial/contract'
import { validateCodeMaterialParameters } from './codeMaterial/parameters'
import { codeMaterialContextForFrame } from './codeMaterialTiming'

export type CodeMaterialMetadata = Pick<CodeMaterialProgram, 'name' | 'kind' | 'mode' | 'width' | 'height' | 'durationSeconds' | 'seed' | 'parameters'>
export type CodeMaterialMetadataReader = (instance: CodeMaterialInstance) => CodeMaterialMetadata
export function codeMaterialSource(document: Pick<VideoEditDocument, 'codeMaterials'>, instance: CodeMaterialInstance): CodeMaterialVersion {
  const version = document.codeMaterials?.find(definition => definition.id === instance.definitionId)?.versions.find(version => version.id === instance.versionId)
  if (!version) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在，请恢复原源码引用。')
  return version
}
/** Metadata is checked against source by the host Worker, never trusted from the file. */
export function validateCodeMaterialDocument(document: VideoEditDocument, read: CodeMaterialMetadataReader): void {
  for (const definition of document.codeMaterials ?? []) read({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} })
  for (const item of document.items) if (item.code) {
    const program = read(item.code)
    if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜应作为附加效果使用，不能直接创建生成项目项。')
    validateCodeMaterialParameters(program, item.code.parameters)
  }
  for (const sequence of document.sequences) for (const clip of sequence.clips) if (clip.code) {
    const program = read(clip.code)
    if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '代码片段需要生成素材。')
    validateCodeMaterialParameters(program, clip.code.parameters)
    codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program)
  }
}
