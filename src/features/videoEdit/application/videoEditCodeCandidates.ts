import { changedCodeMaterialVersions } from '@/core/videoEdit/codeMaterialDocument'
import { ensureVideoEditChangedCodeMetadata, ensureVideoEditCodeParameterMetadata } from './videoEditCodeState'
import type { CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { withVideoEditCurrentMetadata, editVideoProject, requireVideoEditInstance, subscribeVideoEditDomain, type VideoEditInstance } from './videoEditService'
import { prepareCodeVersionPublication, discardVideoEditCodeFiles } from './videoEditCodeStorage'
import { documentCodeSourceResolver, loadCodeSourceReferences, normalizeCodeMaterialFiles, type CodeMaterialFiles, type CodeFileReference } from '@/core/videoEdit/codeMaterial/sources'
import { appendCodeMaterialVersion } from '@/core/videoEdit/codeMaterialVersions'
import type { CodeMaterialMigrationImpact } from '@/core/videoEdit/codeMaterialAnimation'
import { retargetCodeMaterialInstances, validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditComposition, videoEditDocumentSchema, type VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditCodeTarget } from './videoEditCodeParameters'
import { compileVideoEditCode, forgetVideoEditCodeMetadata, readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { trialVideoEditCodeFrames, videoEditCodeValidationFrames } from './videoEditCodeTrial'
import { videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.codeCandidates')
export type VideoEditCodeApplyScope = 'single' | 'matching'
export interface VideoEditCodeCandidate {
  readonly performance?: CodeFramePerformance[]
  /** 试渲染帧里片子数据需要用户处理的问题（不是源码的错，不挡提交）。 */
  readonly notices?: readonly string[]
  readonly target: VideoEditCodeTarget
  readonly scope: VideoEditCodeApplyScope
  readonly files: CodeMaterialFiles
  readonly versionId: string
  readonly clipCount: number
  readonly bitmap: ImageBitmap
  readonly impacts: ReadonlyArray<CodeMaterialMigrationImpact & { sequenceName: string; clipName: string }>
}
interface CandidateState { owner: VideoEditInstance; contentVersion: number; document: VideoEditDocument; controller: AbortController; clean: () => void; needsConfirmation: boolean }
const candidates = new WeakMap<VideoEditCodeCandidate, CandidateState>()
const active = new WeakMap<VideoEditInstance, Set<VideoEditCodeCandidate>>()
const preparing = new WeakMap<VideoEditInstance, number>()

/** The candidate is an opaque proof of the exact checked source and document;
 * its public display fields cannot be used to forge a publication. */
export async function prepareVideoEditCodeCandidate(target: VideoEditCodeTarget, source: string | CodeMaterialFiles, scope: VideoEditCodeApplyScope = 'single', signal?: AbortSignal, options: { clearElementOverrides?: readonly string[] } = {}): Promise<VideoEditCodeCandidate> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document; const contentVersion = owner.contentVersion
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
  const createdFiles: CodeFileReference[] = []
  const unsubscribe = subscribeVideoEditDomain(() => {
    if (!isVideoEditContentCurrent(owner, contentVersion)) {
      controller.abort(new Error('原剪辑已关闭或内容已改变，请重新检查候选。'))
      if (candidate) disposeVideoEditCodeCandidate(candidate)
    }
  })
  const clean = (): void => {
    unsubscribe(); signal?.removeEventListener('abort', cancel)
    controller.abort(new Error('源码候选已释放。')); bitmap?.close(); bitmap = undefined
    if (candidate) { candidates.delete(candidate); active.get(owner)?.delete(candidate) }
    if (!committed) void discardVideoEditCodeFiles(createdFiles).catch(error => logger.warn('源码候选回收失败', { event: 'video_edit.code.candidate.cleanup.failed', error }))
    if (!committed && newVersion && !baseline.codeMaterials?.some(definition => definition.versions.some(version => version.id === newVersion))) forgetVideoEditCodeMetadata(owner, newVersion)
  }
  logger.info('检查源码候选', { event: 'video_edit.code.candidate.start', context: { projectId: target.projectId, clipId: target.clipId, scope } })
  try {
    await loadCodeSourceReferences(definition.versions.find(version => version.id === definition.defaultVersionId)!)
    const appended = await appendCodeMaterialVersion(definition, source, source => compileVideoEditCode(source, controller.signal), documentCodeSourceResolver(baseline), await prepareCodeVersionPublication(target.projectId, normalizeCodeMaterialFiles(source), undefined, undefined, createdFiles))
    controller.signal.throwIfAborted(); newVersion = appended.versionId
    if (appended.kindUnverified) logger.warn('原有代码版本都读不到，新版本未核对素材种类', { event: 'video_edit.code.version.kind_unverified', context: { projectId: target.projectId, definitionId: definition.id, versionId: newVersion } })
    const version = appended.definition.versions.find(version => version.id === newVersion)!
    rememberVideoEditCodeMetadata(owner, definition.id, version, appended.program)
    await ensureVideoEditCodeParameterMetadata(owner, baseline, definition.id, target.versionId)
    const read = readVideoEditCodeMetadata(owner, baseline)
    const selectedIds = new Set<string>()
    const selectedEffects = new Map<string, string[]>()
    const moved = retargetCodeMaterialInstances({ ...baseline, codeMaterials: baseline.codeMaterials!.map(value => value.id === definition.id ? appended.definition : value) }, definition.id, appended.versionId, appended.program, read, { select: (instance, code) => {
      if (instance.kind !== (target.effectId ? 'effect' : 'clip')) return false
      if (scope === 'matching') return code.versionId === target.versionId
      return instance.sequenceId === target.sequenceId && (instance.kind === 'effect' ? instance.clipId === target.clipId && instance.id === target.effectId : instance.id === target.clipId)
    } })
    const sequenceNames = new Map(baseline.sequences.map(sequence => [sequence.id, sequence.name]))
    const impacts: VideoEditCodeCandidate['impacts'][number][] = moved.instances.flatMap(({ target: instance, impacts }) => {
      if (instance.kind === 'item') return []
      const clipId = instance.kind === 'effect' ? instance.clipId : instance.id
      selectedIds.add(clipId)
      if (instance.kind === 'effect') selectedEffects.set(clipId, [...(selectedEffects.get(clipId) ?? []), instance.id])
      return impacts.map(impact => ({ ...impact, sequenceName: sequenceNames.get(instance.sequenceId)!, clipName: instance.label }))
    })
    const count = moved.instances.length
    if (!target.effectId && scope === 'single' && options.clearElementOverrides?.length) {
      const clip = moved.document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips.find(clip => clip.id === target.clipId)!
      for (const id of options.clearElementOverrides) delete clip.elementOverrides?.[id]
      if (clip.elementOverrides && !Object.keys(clip.elementOverrides).length) delete clip.elementOverrides
    }
    const document = videoEditDocumentSchema.parse(moved.document)
    await ensureVideoEditChangedCodeMetadata(owner, baseline, document, controller.signal)
    validateCodeMaterialDocument(document, readVideoEditCodeMetadata(owner, document), changedCodeMaterialVersions(baseline, document))
    const requested = owner.activeSequenceId === target.sequenceId ? owner.frame : owner.sequenceViews.get(target.sequenceId)?.frame ?? original.start
    const frame = videoEditTransitionsAt(videoEditComposition(document, target.sequenceId), requested).some(window => window.left.id === original.id || window.right.id === original.id) ? requested : Math.max(original.start, Math.min(original.start + original.duration - 1, requested))
    const uniqueFrames = videoEditCodeValidationFrames(document, document.sequences.flatMap(sequence => sequence.clips.filter(clip => selectedIds.has(clip.id)).map(clip => ({ sequenceId: sequence.id, clipId: clip.id, ...(target.effectId ? { effectIds: selectedEffects.get(clip.id) } : {}) }))), { sequenceId: target.sequenceId, frame })
    const measurements: CodeFramePerformance[] = [], notices = new Set<string>()
    bitmap = await trialVideoEditCodeFrames(uniqueFrames, controller.signal, true, undefined, measurements, undefined, notices)
    controller.signal.throwIfAborted()
    if (!bitmap || !isVideoEditContentCurrent(owner, contentVersion)) throw new Error('源码候选的原剪辑已改变。')
    candidate = Object.freeze({ ...(measurements.length ? { performance: measurements } : {}), ...(notices.size ? { notices: Object.freeze([...notices]) } : {}), target: Object.freeze({ ...target }), scope, files: normalizeCodeMaterialFiles(source), versionId: appended.versionId, clipCount: count, bitmap, impacts: structuredClone(impacts) })
    candidates.set(candidate, { owner, contentVersion, document, controller, clean: () => { committed = owner.document.codeMaterials?.some(definition => definition.versions.some(version => version.id === newVersion)) ?? false; clean() }, needsConfirmation: impacts.length > 0 })
    const set = active.get(owner) ?? new Set(); set.add(candidate); active.set(owner, set)
    logger.info('源码候选已生成', { event: 'video_edit.code.candidate.ready', context: { projectId: target.projectId, count, impacts: impacts.length } })
    return candidate
  } catch (error) { await discardVideoEditCodeFiles(createdFiles); createdFiles.length = 0; clean(); logger.debug('源码候选未完成', { event: 'video_edit.code.candidate.failed', error, context: { projectId: target.projectId } }); throw error }
  finally { preparing.set(owner, Math.max(0, (preparing.get(owner) ?? 1) - 1)) }
}
export function disposeVideoEditCodeCandidate(candidate: VideoEditCodeCandidate): void { candidates.get(candidate)?.clean() }
export function commitVideoEditCodeCandidate(candidate: VideoEditCodeCandidate, confirmMigration = false): string {
  const state = candidates.get(candidate)
  if (!state || state.controller.signal.aborted) throw new Error('源码候选已失效，请重新检查。')
  if (!isVideoEditContentCurrent(state.owner, state.contentVersion)) { state.clean(); throw new Error('原剪辑内容已改变，请重新检查候选。') }
  if (state.needsConfirmation && !confirmMigration) throw new Error('请先确认列出的参数和关键帧迁移。')
  try { editVideoProject(candidate.target.projectId, current => withVideoEditCurrentMetadata(state.document, current)); return candidate.versionId }
  finally { state.clean() }
}
