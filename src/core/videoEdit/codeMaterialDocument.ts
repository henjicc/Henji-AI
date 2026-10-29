import { jsonEqual } from '../jsonEqual'
import { expandPinnedCodeComponents } from './codeMaterial/components'
import { documentCodeSourceResolver, resolveCodeMaterialFiles, type CodeMaterialFiles } from './codeMaterial/sources'
import type { VideoEditClip, VideoEditDocument } from './document'
import type { CodeMaterialInstance, CodeMaterialVersion } from './codeMaterialPersistence'
import type { CodeAuthorApiVersion } from './codeAuthorProgram'
import type { CodeParameterDeclaration, CodeParameterTypeDefinition } from './codeMaterial/contract'
import { CodeMaterialError } from './codeMaterial/contract'
import { prepareCodeMaterialParameters, proposeCodeMaterialMigration, type CodeMaterialMigrationImpact } from './codeMaterialAnimation'
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
  // 编译按版本记录的作者接口与内置库版本；记录的 apiVersion 已由 schema 限定在 4–5。
  const options = { apiVersion: version.apiVersion as CodeAuthorApiVersion, ...(version.libraries ? { libraries: version.libraries } : {}) }
  return { ...version, contents, compilation: { ...expandPinnedCodeComponents(contents, version.imports ?? [], resolver), ...options, trustContext: version.foreign ? [version.foreign] : [] } }
}
export function codeMaterialVersion(document: Pick<VideoEditDocument, 'codeMaterials'>, instance: CodeMaterialInstance): CodeMaterialVersion {
  const version = document.codeMaterials?.find(definition => definition.id === instance.definitionId)?.versions.find(version => version.id === instance.versionId)
  if (!version) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在，请恢复原源码引用。')
  return version
}
export type CodeMaterialInstanceTarget = { kind: 'item'; id: string; label: string } | { kind: 'clip'; id: string; label: string; sequenceId: string } | { kind: 'effect'; id: string; label: string; sequenceId: string; clipId: string }
const instanceKindNames = { item: '素材条目', clip: '片段', effect: '附加效果' } as const
/** 代码参数错误补上用户能认出的实例名；读取中等非代码错误原样抛出，调用方据此等待重试。 */
function withInstanceName<T>(target: CodeMaterialInstanceTarget, operation: () => T): T {
  try { return operation() }
  catch (error) { if (error instanceof CodeMaterialError) throw new CodeMaterialError(error.code, `${instanceKindNames[target.kind]}“${target.label}”：${error.message}`, error.sourceSpan); throw error }
}
const itemTarget = (item: VideoEditDocument['items'][number]): CodeMaterialInstanceTarget => ({ kind: 'item', id: item.id, label: item.name })
const clipTarget = (sequenceId: string, clip: VideoEditClip): CodeMaterialInstanceTarget => ({ kind: 'clip', id: clip.id, label: clip.name, sequenceId })
const effectTarget = (sequenceId: string, clip: VideoEditClip, effect: NonNullable<VideoEditClip['effects']>[number]): CodeMaterialInstanceTarget => ({ kind: 'effect', id: effect.id, label: `${clip.name} · ${effect.name}`, sequenceId, clipId: clip.id })

export interface CodeMaterialRetargetedInstance { target: CodeMaterialInstanceTarget; removedParameters: string[]; resetParameters: string[]; impacts: CodeMaterialMigrationImpact[]; note?: string }
export interface CodeMaterialRetargetOptions {
  /** 省略时换掉全部未指向目标版本的实例。 */
  select?: (target: CodeMaterialInstanceTarget, instance: CodeMaterialInstance) => boolean
  /** 声明读不到的原版本（源码缺失或编译不过）；这些实例只按新版本声明核对。 */
  unreadable?: ReadonlySet<string>
}
/**
 * 把一个定义的实例换到另一版本的唯一入口：素材条目、片段与附加效果一样经迁移提案，
 * 新版本不再声明的参数与曲线随换版本去掉，不再适用的值重置为默认，没写过的参数跟随新版本默认值。
 * 返回新文档，不改原文档。read 读实例当前版本的声明，next 是目标版本的声明。
 */
export function retargetCodeMaterialInstances(document: VideoEditDocument, definitionId: string, versionId: string, next: CodeMaterialMetadata, read: CodeMaterialMetadataReader, options: CodeMaterialRetargetOptions = {}): { document: VideoEditDocument; instances: CodeMaterialRetargetedInstance[] } {
  const { select = () => true, unreadable } = options
  const result = structuredClone(document); const instances: CodeMaterialRetargetedInstance[] = []
  const declared = new Set(next.parameters.map(parameter => parameter.key))
  const migrate = (owner: { code?: CodeMaterialInstance }, target: CodeMaterialInstanceTarget): void => {
    const code = owner.code
    if (!code || code.definitionId !== definitionId || code.versionId === versionId || !select(target, code)) return
    const fallback = unreadable?.has(code.versionId) ?? false
    const proposal = withInstanceName(target, () => proposeCodeMaterialMigration(fallback ? undefined : read(code), next, code, versionId))
    const removed = [...new Set([...Object.keys(code.parameters), ...Object.keys(code.curves ?? {})])].filter(key => !declared.has(key)).sort()
    owner.code = proposal.instance
    instances.push({ target, removedParameters: removed, resetParameters: [...new Set(proposal.impacts.filter(impact => declared.has(impact.key) && (impact.resetValue || impact.removeCurve)).map(impact => impact.key))].sort(), impacts: proposal.impacts, ...(fallback ? { note: '旧版本无法读取，按新版本声明处理' } : {}) })
  }
  for (const item of result.items) migrate(item, itemTarget(item))
  for (const sequence of result.sequences) for (const clip of sequence.clips) {
    migrate(clip, clipTarget(sequence.id, clip))
    for (const effect of clip.effects ?? []) migrate(effect, effectTarget(sequence.id, clip, effect))
  }
  return { document: result, instances }
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
  for (const item of document.items) {
    const code = item.code
    if (!code || !selected(code)) continue
    withInstanceName(itemTarget(item), () => {
      const program = read(code)
      if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜应作为附加效果使用，不能直接创建生成素材项。')
      validate(code, program)
    })
  }
  for (const sequence of document.sequences) {
    for (const clip of sequence.clips) {
      const code = clip.code
      if (code && selected(code)) withInstanceName(clipTarget(sequence.id, clip), () => {
        const program = read(code)
        if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '代码片段需要生成素材。')
        validate(code, program)
        codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program, sequence)
      })
      for (const effect of clip.effects ?? []) {
        const code = effect.code
        if (!code || !selected(code)) continue
        withInstanceName(effectTarget(sequence.id, clip, effect), () => {
          const program = read(code)
          if (program.kind !== 'filter') throw new CodeMaterialError('TYPE', '附加效果必须使用单输入滤镜源码。')
          validate(code, program)
          codeMaterialContextForFrame(clip, clip.start + clip.duration - 1, sequence.frameRate, program, sequence)
        })
      }
    }
    for (const transition of sequence.transitions ?? []) {
      const window = videoEditTransitionWindow(sequence, transition)
      for (const clip of [window.left, window.right]) {
        const uses = [...(clip.code ? [{ instance: clip.code, target: clipTarget(sequence.id, clip) }] : []), ...(clip.effects ?? []).flatMap(effect => effect.code ? [{ instance: effect.code, target: effectTarget(sequence.id, clip, effect) }] : [])]
        for (const { instance, target } of uses) {
          if (!selected(instance)) continue
          withInstanceName(target, () => {
            const program = read(instance)
            codeMaterialContextForTransitionFrame(clip, window.start, sequence.frameRate, program, window, sequence)
            codeMaterialContextForTransitionFrame(clip, window.end - 1, sequence.frameRate, program, window, sequence)
          })
        }
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
  const signature = (value: VideoEditDocument['items'][number] | VideoEditDocument['sequences'][number]['clips'][number]): unknown[] => [value.code, 'effects' in value ? videoEditEffectCodes(value.effects) : [], ...('start' in value ? [value.start, value.duration, value.sourceInUs, value.sourceRemainder, value.speed, value.reverse, value.timeRemap, value.frameHold] : [])]
  const previous = new Map([...before.items, ...before.sequences.flatMap(sequence => sequence.clips)].map(value => [value.id, value]))
  for (const value of [...next.items, ...next.sequences.flatMap(sequence => sequence.clips)]) {
    const old = previous.get(value.id)
    if (old === value || old && jsonEqual(signature(old), signature(value))) continue
    if (value.code) result.add(value.code.versionId)
    if ('effects' in value) for (const code of videoEditEffectCodes(value.effects)) result.add(code.versionId)
  }
  const known = new Set(before.codeMaterials?.flatMap(definition => definition.versions.map(version => version.id)))
  for (const definition of next.codeMaterials ?? []) for (const version of definition.versions) if (!known.has(version.id)) result.add(version.id)
  for (const sequence of next.sequences) {
    const old = before.sequences.find(value => value.id === sequence.id)
    if (old === sequence && !result.size) continue
    if (!jsonEqual([old?.frameRate, old?.width, old?.height], [sequence.frameRate, sequence.width, sequence.height])) {
      for (const clip of sequence.clips) for (const code of [clip.code, ...videoEditEffectCodes(clip.effects)]) if (code) result.add(code.versionId)
    }
    for (const transition of sequence.transitions ?? []) {
      const window = videoEditTransitionWindow(sequence, transition)
      const codes = [window.left, window.right].flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(clip.effects)])
      if (!jsonEqual(old?.transitions?.find(value => value.id === transition.id), transition) || codes.some(code => result.has(code.versionId))) for (const code of codes) result.add(code.versionId)
    }
  }
  return result
}

export function codeMaterialTrustContext(document: Pick<VideoEditDocument, 'codeMaterials'>, instance: { definitionId: string; versionId?: string }) {
  const definition = document.codeMaterials?.find(value => value.id === instance.definitionId)
  const version = definition?.versions.find(value => value.id === (instance.versionId ?? definition.defaultVersionId))
  return version?.foreign ? [version.foreign] : []
}
