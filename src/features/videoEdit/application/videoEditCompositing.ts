import { videoEditDocumentSchema, type VideoEditClip, type VideoEditSequence, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditEffectSchema, orderVideoEditEffects, type VideoEditEffect } from '@/core/videoEdit/compositing'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditTransitionSchema, videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import { assertVideoEditLockedTracks } from '@/core/videoEdit/lockedTracks'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { trialVideoEditCodeDocument } from './videoEditCodeTrial'
import type { VideoEditGraphicClipTarget as VideoEditCompositeTarget } from './videoEditGraphics'

export type { VideoEditCompositeTarget }
function requireClip(sequence: VideoEditSequence, clipId: string): VideoEditClip {
  const clip = sequence.clips.find(clip => clip.id === clipId)
  if (!clip || clip.kind === 'audio') throw new Error('请选择可处理画面的片段。')
  return clip
}
/** All structural effect/range/transition edits prove the exact draft before one
 * shared history/save publication. Scalars still use the established gestures. */
async function editComposite(projectId: string, sequenceId: string, clipIds: string[], change: (sequence: VideoEditSequence) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const draft = structuredClone(baseline); const sequence = draft.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) throw new Error('原序列已移除。')
  clipIds.forEach(id => requireClip(sequence, id)); change(sequence)
  const next = videoEditDocumentSchema.parse(draft)
  assertVideoEditLockedTracks(baseline, next)
  const requested = owner.activeSequenceId === sequenceId ? owner.frame : owner.sequenceViews.get(sequenceId)?.frame ?? 0
  const active = clipIds.some(id => { const clip = requireClip(sequence, id); return requested >= clip.start && requested < clip.start + clip.duration }) || videoEditTransitionsAt(sequence, requested).some(window => clipIds.includes(window.left.id) || clipIds.includes(window.right.id))
  const frame = active ? requested : requireClip(sequence, clipIds[0]).start
  await trialVideoEditCodeDocument(owner, baseline, next, sequenceId, frame, signal, clipIds.map(clipId => ({ sequenceId, clipId })))
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('原剪辑已改变，请重新检查此编辑。')
  editVideoProject(projectId, () => next)
}
export function listVideoEditFilterDefinitions(projectId: string): Array<{ id: string; name: string; versionId: string }> {
  const owner = requireVideoEditInstance(projectId); const read = readVideoEditCodeMetadata(owner, owner.document)
  return (owner.document.codeMaterials ?? []).filter(definition => read({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} }).kind === 'filter').map(definition => ({ id: definition.id, name: definition.name, versionId: definition.defaultVersionId }))
}
export interface VideoEditEffectInput { definitionId: string; versionId?: string; name?: string; parameters?: CodeMaterialInstance['parameters'] }
export function makeVideoEditEffect(document: VideoEditDocument, input: VideoEditEffectInput, read: CodeMaterialMetadataReader): VideoEditEffect {
  const definition = document.codeMaterials?.find(definition => definition.id === input.definitionId)
  if (!definition) throw new Error('滤镜源码不属于此剪辑。')
  const code = { definitionId: definition.id, versionId: input.versionId ?? definition.defaultVersionId, parameters: input.parameters ?? {} }
  const metadata = read(code)
  if (metadata.kind !== 'filter') throw new Error('附加效果需要输入滤镜源码。')
  return videoEditEffectSchema.parse({ id: crypto.randomUUID(), name: input.name ?? definition.name, enabled: true, amount: 1, code: { ...code, parameters: validateCodeMaterialParameters(metadata, code.parameters) } })
}
export async function createVideoEditEffect(target: VideoEditCompositeTarget, input: VideoEditEffectInput, signal?: AbortSignal): Promise<string> {
  const owner = requireVideoEditInstance(target.projectId)
  const effect = makeVideoEditEffect(owner.document, input, readVideoEditCodeMetadata(owner, owner.document))
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => { const clip = requireClip(sequence, target.clipId); clip.effects = [...(clip.effects ?? []), effect] }, signal)
  return effect.id
}
export interface VideoEditEffectChanges { name?: string; enabled?: boolean; amount?: number; versionId?: string; parameters?: CodeMaterialInstance['parameters']; curves?: CodeMaterialInstance['curves'] }
export async function updateVideoEditEffect(target: VideoEditCompositeTarget, effectId: string, changes: VideoEditEffectChanges, signal?: AbortSignal): Promise<void> {
  const allowed = ['name', 'enabled', 'amount', 'versionId', 'parameters', 'curves']
  if (Object.keys(changes).some(key => !allowed.includes(key))) throw new Error('效果修改仅接受名称、开关、强度和固定源码参数。')
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => {
    const clip = requireClip(sequence, target.clipId); const effect = clip.effects?.find(effect => effect.id === effectId)
    if (!effect) throw new Error('原效果已移除。')
    const { versionId, parameters, curves, ...presentation } = changes
    Object.assign(effect, presentation)
    effect.code = { ...effect.code, ...(versionId !== undefined ? { versionId } : {}), ...(parameters !== undefined ? { parameters } : {}), ...(curves !== undefined ? { curves } : {}) }
  }, signal)
}
export async function resetVideoEditEffect(target: VideoEditCompositeTarget, effectId: string, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(target.projectId); const sequence = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)
  const effect = sequence && requireClip(sequence, target.clipId).effects?.find(effect => effect.id === effectId)
  if (!effect) throw new Error('原效果已移除。')
  const metadata = readVideoEditCodeMetadata(owner, owner.document)(effect.code)
  await updateVideoEditEffect(target, effectId, { enabled: true, amount: 1, parameters: validateCodeMaterialParameters(metadata), curves: {} }, signal)
}
export async function reorderVideoEditEffects(target: VideoEditCompositeTarget, ids: string[], signal?: AbortSignal): Promise<void> {
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => {
    const clip = requireClip(sequence, target.clipId)
    clip.effects = orderVideoEditEffects(clip.effects ?? [], ids)
  }, signal)
}
export async function deleteVideoEditEffects(target: VideoEditCompositeTarget, ids: string[], signal?: AbortSignal): Promise<void> {
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => {
    const clip = requireClip(sequence, target.clipId)
    if (!ids.length || ids.some(id => !clip.effects?.some(effect => effect.id === id))) throw new Error('原效果已移除。')
    clip.effects = clip.effects!.filter(effect => !ids.includes(effect.id))
  }, signal)
}
export async function copyVideoEditEffects(target: VideoEditCompositeTarget, source: Pick<VideoEditCompositeTarget, 'sequenceId' | 'clipId'>, signal?: AbortSignal): Promise<void> {
  const sequence = requireVideoEditInstance(target.projectId).document.sequences.find(sequence => sequence.id === source.sequenceId)
  if (!sequence) throw new Error('原效果来源序列已移除。')
  const effects: VideoEditEffect[] = structuredClone(requireClip(sequence, source.clipId).effects ?? []).map(effect => ({ ...effect, id: crypto.randomUUID() }))
  if (!effects.length) throw new Error('来源片段没有效果可复制。')
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => { requireClip(sequence, target.clipId).effects = effects }, signal)
}
export async function updateVideoEditAdjustmentRange(target: VideoEditCompositeTarget, fromTrack: number, signal?: AbortSignal): Promise<void> {
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => {
    const clip = requireClip(sequence, target.clipId)
    if (clip.kind !== 'adjustment') throw new Error('请选择调整图层。')
    clip.adjustment = { fromTrack }
  }, signal)
}
export async function createVideoEditTransition(projectId: string, sequenceId: string, input: { leftClipId: string; rightClipId: string; durationFrames: number }, signal?: AbortSignal): Promise<string> {
  const transition = videoEditTransitionSchema.parse({ id: crypto.randomUUID(), kind: 'cross_dissolve', ...input })
  await editComposite(projectId, sequenceId, [transition.leftClipId, transition.rightClipId], sequence => { (sequence.transitions ??= []).push(transition) }, signal)
  return transition.id
}
export async function updateVideoEditTransition(projectId: string, sequenceId: string, transitionId: string, durationFrames: number, signal?: AbortSignal): Promise<void> {
  const transition = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)?.transitions?.find(transition => transition.id === transitionId)
  if (!transition) throw new Error('原转场已移除。')
  await editComposite(projectId, sequenceId, [transition.leftClipId, transition.rightClipId], sequence => { sequence.transitions!.find(value => value.id === transitionId)!.durationFrames = durationFrames }, signal)
}
export async function deleteVideoEditTransition(projectId: string, sequenceId: string, transitionId: string, signal?: AbortSignal): Promise<void> {
  const transition = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)?.transitions?.find(transition => transition.id === transitionId)
  if (!transition) throw new Error('原转场已移除。')
  await editComposite(projectId, sequenceId, [transition.leftClipId, transition.rightClipId], sequence => { sequence.transitions = sequence.transitions!.filter(value => value.id !== transitionId) }, signal)
}
