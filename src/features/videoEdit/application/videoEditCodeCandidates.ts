import { appendCodeMaterialVersion } from '@/core/videoEdit/codeMaterialVersions'
import { proposeCodeMaterialMigration, type CodeMaterialMigrationImpact } from '@/core/videoEdit/codeMaterialAnimation'
import { validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditComposition, videoEditDocumentSchema, type VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditCodeTarget } from './videoEditCodeParameters'
import { compileVideoEditCode, forgetVideoEditCodeMetadata, readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { editVideoProject, listVideoEditInstances, requireVideoEditInstance, subscribeVideoEditDomain, type VideoEditInstance } from './videoEditService'
import { trialVideoEditCodeFrames, videoEditCodeValidationFrames } from './videoEditCodeTrial'
import { videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.codeCandidates')
export type VideoEditCodeApplyScope = 'single' | 'matching'
export interface VideoEditCodeCandidate {
  readonly target: VideoEditCodeTarget
  readonly scope: VideoEditCodeApplyScope
  readonly source: string
  readonly versionId: string
  readonly clipCount: number
  readonly bitmap: ImageBitmap
  readonly impacts: ReadonlyArray<CodeMaterialMigrationImpact & { sequenceName: string; clipName: string }>
}
interface CandidateState { owner: VideoEditInstance; baseline: VideoEditDocument; document: VideoEditDocument; controller: AbortController; clean: () => void; needsConfirmation: boolean }
const candidates = new WeakMap<VideoEditCodeCandidate, CandidateState>()
const active = new WeakMap<VideoEditInstance, Set<VideoEditCodeCandidate>>()
const preparing = new WeakMap<VideoEditInstance, number>()

/** The candidate is an opaque proof of the exact checked source and document;
 * its public display fields cannot be used to forge a publication. */
export async function prepareVideoEditCodeCandidate(target: VideoEditCodeTarget, source: string, scope: VideoEditCodeApplyScope = 'single', signal?: AbortSignal): Promise<VideoEditCodeCandidate> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document
  if ((active.get(owner)?.size ?? 0) + (preparing.get(owner) ?? 0) >= 2) throw new Error('请先关闭或提交现有源码候选。')
  const sequence = baseline.sequences.find(sequence => sequence.id === target.sequenceId)
  const original = sequence?.clips.find(clip => clip.id === target.clipId)
  const originalCode = target.effectId ? original?.effects?.find(effect => effect.id === target.effectId)?.code : original?.kind === 'code' ? original.code : undefined
  if (!sequence || !original || !originalCode || originalCode.versionId !== target.versionId) throw new Error('原代码片段或源码版本已改变，请重新选择。')
  if (!['single', 'matching'].includes(scope)) throw new Error('请选择此片段或相同原版本的所有片段。')
  const definition = baseline.codeMaterials!.find(definition => definition.id === originalCode.definitionId)!
  preparing.set(owner, (preparing.get(owner) ?? 0) + 1)
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(signal?.reason ?? new Error('源码候选已取消。')); if (candidate) disposeVideoEditCodeCandidate(candidate) }
  signal?.addEventListener('abort', cancel, { once: true })
  let candidate: VideoEditCodeCandidate | undefined; let newVersion: string | undefined; let bitmap: ImageBitmap | undefined
  let committed = false
  const unsubscribe = subscribeVideoEditDomain(() => {
    if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) {
      controller.abort(new Error('原剪辑已关闭或内容已改变，请重新检查候选。'))
      if (candidate) disposeVideoEditCodeCandidate(candidate)
    }
  })
  const clean = (): void => {
    unsubscribe(); signal?.removeEventListener('abort', cancel)
    controller.abort(new Error('源码候选已释放。')); bitmap?.close(); bitmap = undefined
    if (candidate) { candidates.delete(candidate); active.get(owner)?.delete(candidate) }
    if (!committed && newVersion && !baseline.codeMaterials?.some(definition => definition.versions.some(version => version.id === newVersion))) forgetVideoEditCodeMetadata(owner, newVersion)
  }
  logger.info('检查源码候选', { event: 'video_edit.code.candidate.start', context: { projectId: target.projectId, clipId: target.clipId, scope } })
  try {
    const appended = await appendCodeMaterialVersion(definition, source, source => compileVideoEditCode(source, controller.signal))
    controller.signal.throwIfAborted(); newVersion = appended.versionId
    const version = appended.definition.versions.find(version => version.id === newVersion)!
    rememberVideoEditCodeMetadata(owner, definition.id, version, appended.program)
    const read = readVideoEditCodeMetadata(owner, baseline)
    const impacts: VideoEditCodeCandidate['impacts'][number][] = []; let count = 0
    const selectedIds = new Set<string>()
    const selectedEffects = new Map<string, string[]>()
    const document = videoEditDocumentSchema.parse({ ...baseline, codeMaterials: baseline.codeMaterials!.map(value => value.id === definition.id ? appended.definition : value), sequences: baseline.sequences.map(value => ({ ...value, clips: value.clips.map(clip => {
      if (target.effectId) {
        return { ...clip, effects: clip.effects?.map(effect => {
          const selected = scope === 'single' ? value.id === target.sequenceId && clip.id === target.clipId && effect.id === target.effectId : effect.code?.definitionId === definition.id && effect.code.versionId === target.versionId
          if (!selected || !effect.code) return effect
          const migration = proposeCodeMaterialMigration(read(effect.code), appended.program, effect.code, appended.versionId)
          count++; selectedIds.add(clip.id); impacts.push(...migration.impacts.map(impact => ({ ...impact, sequenceName: value.name, clipName: `${clip.name} · ${effect.name}` })))
          selectedEffects.set(clip.id, [...(selectedEffects.get(clip.id) ?? []), effect.id])
          return { ...effect, code: migration.instance }
        }) }
      }
      const selected = scope === 'single' ? value.id === target.sequenceId && clip.id === target.clipId : clip.code?.definitionId === definition.id && clip.code.versionId === target.versionId
      if (!selected || !clip.code) return clip
      const migration = proposeCodeMaterialMigration(read(clip.code), appended.program, clip.code, appended.versionId)
      count++; selectedIds.add(clip.id); impacts.push(...migration.impacts.map(impact => ({ ...impact, sequenceName: value.name, clipName: clip.name })))
      return { ...clip, code: migration.instance }
    }) })) })
    validateCodeMaterialDocument(document, readVideoEditCodeMetadata(owner, document))
    const requested = owner.activeSequenceId === target.sequenceId ? owner.frame : owner.sequenceViews.get(target.sequenceId)?.frame ?? original.start
    const frame = videoEditTransitionsAt(videoEditComposition(document, target.sequenceId), requested).some(window => window.left.id === original.id || window.right.id === original.id) ? requested : Math.max(original.start, Math.min(original.start + original.duration - 1, requested))
    const uniqueFrames = videoEditCodeValidationFrames(document, document.sequences.flatMap(sequence => sequence.clips.filter(clip => selectedIds.has(clip.id)).map(clip => ({ sequenceId: sequence.id, clipId: clip.id, ...(target.effectId ? { effectIds: selectedEffects.get(clip.id) } : {}) }))), { sequenceId: target.sequenceId, frame })
    bitmap = await trialVideoEditCodeFrames(uniqueFrames, controller.signal, true)
    controller.signal.throwIfAborted()
    if (!bitmap || requireVideoEditInstance(target.projectId) !== owner || owner.document !== baseline) throw new Error('源码候选的原剪辑已改变。')
    candidate = Object.freeze({ target: Object.freeze({ ...target }), scope, source, versionId: appended.versionId, clipCount: count, bitmap, impacts: structuredClone(impacts) })
    candidates.set(candidate, { owner, baseline, document, controller, clean: () => { committed = owner.document.codeMaterials?.some(definition => definition.versions.some(version => version.id === newVersion)) ?? false; clean() }, needsConfirmation: impacts.length > 0 })
    const set = active.get(owner) ?? new Set(); set.add(candidate); active.set(owner, set)
    logger.info('源码候选已生成', { event: 'video_edit.code.candidate.ready', context: { projectId: target.projectId, count, impacts: impacts.length } })
    return candidate
  } catch (error) { clean(); logger.debug('源码候选未完成', { event: 'video_edit.code.candidate.failed', error, context: { projectId: target.projectId } }); throw error }
  finally { preparing.set(owner, Math.max(0, (preparing.get(owner) ?? 1) - 1)) }
}
export function disposeVideoEditCodeCandidate(candidate: VideoEditCodeCandidate): void { candidates.get(candidate)?.clean() }
export function commitVideoEditCodeCandidate(candidate: VideoEditCodeCandidate, confirmMigration = false): string {
  const state = candidates.get(candidate)
  if (!state || state.controller.signal.aborted) throw new Error('源码候选已失效，请重新检查。')
  if (requireVideoEditInstance(candidate.target.projectId) !== state.owner || state.owner.document !== state.baseline) { state.clean(); throw new Error('原剪辑内容已改变，请重新检查候选。') }
  if (state.needsConfirmation && !confirmMigration) throw new Error('请先确认列出的参数和关键帧迁移。')
  try { editVideoProject(candidate.target.projectId, () => state.document); return candidate.versionId }
  finally { state.clean() }
}
