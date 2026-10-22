import { expandPinnedCodeComponents } from './codeMaterial/components'
import { documentCodeSourceResolver, resolveCodeMaterialFiles, type CodeMaterialFiles } from './codeMaterial/sources'
import type { VideoEditDocument } from './document'
import type { CodeMaterialInstance, CodeMaterialVersion } from './codeMaterialPersistence'
import type { CodeParameterDeclaration, CodeParameterTypeDefinition } from './codeMaterial/contract'
import { CodeMaterialError } from './codeMaterial/contract'
import { prepareCodeMaterialParameters } from './codeMaterialAnimation'
import { isCodeImageReference, isCodeAudioReference } from './codeMaterial/contract'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame } from './codeMaterialTiming'
import { validateVideoEditTransitions, videoEditTransitionWindow } from './transitions'
import { videoEditEffectCodes } from './compositing'

/** Control metadata normalized from an author module; drawing code is never part of it. */
export interface CodeMaterialMetadata {
  name: string; kind: 'generator' | 'filter'; mode: 'static' | 'dynamic'; seed: number
  parameters: CodeParameterDeclaration[]; types?: Record<string, CodeParameterTypeDefinition>
  width?: number; height?: number; durationSeconds?: number
}
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
export function validateCodeMaterialDocument(document: VideoEditDocument, read: CodeMaterialMetadataReader, versions?: ReadonlySet<string>): void {
  const selected = (instance: CodeMaterialInstance): boolean => !versions || versions.has(instance.versionId)
  const validate = (instance: CodeMaterialInstance, program: CodeMaterialMetadata): void => {
    prepareCodeMaterialParameters(program, instance)
    for (const value of Object.values(instance.parameters)) {
      if (isCodeImageReference(value) && value.kind !== 'sequence' && !document.media.some(media => media.id === value.mediaId && media.kind === value.kind)) throw new CodeMaterialError('PARAMETERS', '图片或视频参数引用与剪辑素材类型不一致。')
      if (isCodeAudioReference(value) && !document.media.some(media => media.id === value.mediaId && ['audio', 'video'].includes(media.kind))) throw new CodeMaterialError('PARAMETERS', '音频参数须引用剪辑中的音频或视频。')
    }
  }
  for (const definition of document.codeMaterials ?? []) if (!versions || versions.has(definition.defaultVersionId)) read({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} })
  for (const item of document.items) if (item.code && selected(item.code)) {
    const program = read(item.code)
    if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜应作为附加效果使用，不能直接创建生成素材项。')
    validate(item.code, program)
  }
  for (const sequence of document.sequences) {
    for (const clip of sequence.clips) {
      if (clip.code && selected(clip.code)) {
        const program = read(clip.code)
        if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '代码片段需要生成素材。')
        validate(clip.code, program)
        codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program, sequence)
      }
      for (const code of videoEditEffectCodes(clip.effects)) {
        if (!selected(code)) continue
        const program = read(code)
        if (program.kind !== 'filter') throw new CodeMaterialError('TYPE', '附加效果必须使用单输入滤镜源码。')
        validate(code, program)
        codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program, sequence)
      }
    }
    for (const transition of sequence.transitions ?? []) {
      const window = videoEditTransitionWindow(sequence, transition)
      for (const clip of [window.left, window.right]) for (const instance of [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(clip.effects)]) {
        if (!selected(instance)) continue
        const program = read(instance)
        codeMaterialContextForTransitionFrame(clip, window.start, sequence.frameRate, program, window, sequence)
        codeMaterialContextForTransitionFrame(clip, window.end - 1, sequence.frameRate, program, window, sequence)
      }
    }
  }
  if (!versions) validateVideoEditTransitions(document, read)
  else {
    validateVideoEditTransitions(document)
    const scoped = { ...document, sequences: document.sequences.map(sequence => ({ ...sequence, transitions: sequence.transitions?.filter(transition => {
      const window = videoEditTransitionWindow(sequence, transition)
      return [window.left, window.right].some(clip => [clip.code, ...videoEditEffectCodes(clip.effects)].some(code => code && selected(code)))
    }) })) }
    validateVideoEditTransitions(scoped, read)
  }
}

/** 写入时只检查实际变化涉及的版本，普通剪辑操作不唤醒无关源码。 */
export function changedCodeMaterialVersions(before: VideoEditDocument, next: VideoEditDocument): Set<string> {
  const result = new Set<string>()
  const signature = (value: VideoEditDocument['items'][number] | VideoEditDocument['sequences'][number]['clips'][number]): string => JSON.stringify([value.code, 'effects' in value ? videoEditEffectCodes(value.effects) : [], ...('start' in value ? [value.start, value.duration, value.sourceInUs, value.sourceRemainder, value.speed, value.reverse, value.timeRemap, value.frameHold] : [])])
  const previous = new Map([...before.items, ...before.sequences.flatMap(sequence => sequence.clips)].map(value => [value.id, signature(value)]))
  for (const value of [...next.items, ...next.sequences.flatMap(sequence => sequence.clips)]) {
    if (previous.get(value.id) === signature(value)) continue
    if (value.code) result.add(value.code.versionId)
    if ('effects' in value) for (const code of videoEditEffectCodes(value.effects)) result.add(code.versionId)
  }
  const known = new Set(before.codeMaterials?.flatMap(definition => definition.versions.map(version => version.id)))
  for (const definition of next.codeMaterials ?? []) for (const version of definition.versions) if (!known.has(version.id)) result.add(version.id)
  for (const sequence of next.sequences) {
    const old = before.sequences.find(value => value.id === sequence.id)
    if (JSON.stringify([old?.frameRate, old?.width, old?.height]) !== JSON.stringify([sequence.frameRate, sequence.width, sequence.height])) {
      for (const clip of sequence.clips) for (const code of [clip.code, ...videoEditEffectCodes(clip.effects)]) if (code) result.add(code.versionId)
    }
    for (const transition of sequence.transitions ?? []) {
      const window = videoEditTransitionWindow(sequence, transition)
      const codes = [window.left, window.right].flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(clip.effects)])
      if (JSON.stringify(old?.transitions?.find(value => value.id === transition.id)) !== JSON.stringify(transition) || codes.some(code => result.has(code.versionId))) for (const code of codes) result.add(code.versionId)
    }
  }
  return result
}
