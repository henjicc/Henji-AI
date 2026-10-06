import { videoEditDocumentSchema, type VideoEditClip, type VideoEditSequence, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditEffectAccepts, videoEditEffectSchema, orderVideoEditEffects, VIDEO_EDIT_MAX_EFFECTS, type VideoEditEffect, type VideoEditEffectMask } from '@/core/videoEdit/compositing'
import { resolveVideoEditLibraryEffects } from './videoEditEffectPresets'
import { assertVideoEditMaskTrackers } from './videoEditTrackingEdits'
import { isSmartRegionMask } from '@/core/videoEdit/effectMasks'
import { normalizeVideoEditBuiltinParams, requireVideoEditBuiltinEffect, validateVideoEditBuiltinParams, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditTransitionClipIds, videoEditTransitionSchema, videoEditTransitionsAt, type VideoEditTransition } from '@/core/videoEdit/transitions'
import { assertVideoEditLockedTracks } from '@/core/videoEdit/lockedTracks'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { trialVideoEditCodeDocument } from './videoEditCodeTrial'
import type { VideoEditGraphicClipTarget as VideoEditCompositeTarget } from './videoEditGraphics'

export type { VideoEditCompositeTarget }
function requireClip(sequence: VideoEditSequence, clipId: string): VideoEditClip {
  const clip = sequence.clips.find(clip => clip.id === clipId)
  if (!clip || clip.kind === 'audio') throw new Error('请选择可处理画面的片段。')
  return clip
}
/** 效果链所在的片段：画面片段挂画面效果，声音片段挂音频效果（4.7c），媒介是否匹配由文档校验把关。 */
function requireEffectClip(sequence: VideoEditSequence, clipId: string): VideoEditClip {
  const clip = sequence.clips.find(clip => clip.id === clipId)
  if (!clip) throw new Error('原片段已移除。')
  return clip
}
/** All structural effect/range/transition edits prove the exact draft before one
 * shared history/save publication. Scalars still use the established gestures. */
export async function editComposite(projectId: string, sequenceId: string, endpointIds: string[], change: (sequence: VideoEditSequence) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const draft = structuredClone(baseline); const sequence = draft.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) throw new Error('原序列已移除。')
  // 音频过渡两端是声音片段：不需要画面试渲染，只做结构校验。
  const clipIds = endpointIds.filter(id => sequence.clips.find(clip => clip.id === id)?.kind !== 'audio')
  clipIds.forEach(id => requireClip(sequence, id)); change(sequence)
  const next = videoEditDocumentSchema.parse(draft)
  assertVideoEditLockedTracks(baseline, next)
  if (!clipIds.length) { editVideoProject(projectId, () => next); return }
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
    const clip = requireEffectClip(sequence, target.clipId); const effect = clip.effects?.find(effect => effect.id === effectId)
    if (!effect) throw new Error('原效果已移除。')
    const { versionId, parameters, curves, ...presentation } = changes
    Object.assign(effect, presentation)
    if (effect.builtin) {
      if (versionId !== undefined || curves !== undefined) throw new Error('内置效果没有源码版本与关键帧。')
      if (parameters !== undefined) effect.builtin = { id: effect.builtin.id, params: normalizeVideoEditBuiltinParams(effect.builtin.id, parameters, effect.builtin.params) }
    } else effect.code = { ...effect.code!, ...(versionId !== undefined ? { versionId } : {}), ...(parameters !== undefined ? { parameters } : {}), ...(curves !== undefined ? { curves } : {}) }
  }, signal)
}
export async function resetVideoEditEffect(target: VideoEditCompositeTarget, effectId: string, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(target.projectId); const sequence = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)
  const effect = sequence && requireEffectClip(sequence, target.clipId).effects?.find(effect => effect.id === effectId)
  if (!effect) throw new Error('原效果已移除。')
  if (effect.builtin) { updateVideoEditBuiltinEffect(target, effectId, { enabled: true, amount: 1, params: videoEditBuiltinDefaults(requireVideoEditBuiltinEffect(effect.builtin.id)) }); return }
  const metadata = readVideoEditCodeMetadata(owner, owner.document)(effect.code!)
  await updateVideoEditEffect(target, effectId, { enabled: true, amount: 1, parameters: validateCodeMaterialParameters(metadata), curves: {} }, signal)
}
/** 新建一项内置效果（参数按登记校验）。默认存完整参数表；`sparse` 时只存给出的键（助手创建，读回与写入一致，缺的键按默认值渲染）。 */
export function makeVideoEditBuiltinEffect(builtinId: string, params: Readonly<Record<string, unknown>> = {}, name?: string, sparse = false): VideoEditEffect {
  const definition = requireVideoEditBuiltinEffect(builtinId)
  return videoEditEffectSchema.parse({ id: crypto.randomUUID(), name: name ?? definition.name, enabled: true, amount: 1, builtin: { id: definition.id, params: sparse ? validateVideoEditBuiltinParams(definition.id, params) : normalizeVideoEditBuiltinParams(definition.id, params) } })
}
function editBuiltin(target: VideoEditCompositeTarget, change: (clip: VideoEditClip) => void, gesture?: VideoEditGesture): void {
  // 拖动参数时每次指针移动都会调用：只复制目标片段的效果链并校验改动的效果，不整份克隆与校验文档。
  const update = (document: VideoEditDocument): VideoEditDocument => {
    const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
    if (!sequence) throw new Error('原序列已移除。')
    const original = requireEffectClip(sequence, target.clipId)
    if (sequence.tracks.find(track => track.index === original.track)?.locked) throw new Error('所属轨道已锁定，请先解锁。')
    const clip: VideoEditClip = { ...original, ...(original.effects ? { effects: original.effects.map(effect => ({ ...effect })) } : {}) }
    change(clip)
    clip.effects?.forEach(effect => { videoEditEffectSchema.parse(effect) })
    return { ...document, sequences: document.sequences.map(value => value === sequence ? { ...sequence, clips: sequence.clips.map(item => item === original ? clip : item) } : value) }
  }
  if (gesture) {
    if (gesture.projectId !== target.projectId) throw new Error('原参数调整已结束，请重新编辑。')
    updateVideoEditGesture(gesture, update)
  } else editVideoProject(target.projectId, update)
}
/**
 * 把内置效果加到片段效果链末尾（效果面板拖到片段上、双击、助手共用；一步撤销）。内置效果是确定的 GPU 实现，
 * 不需要像代码滤镜那样先试渲染检查。返回新效果的 ID。
 */
export function addVideoEditBuiltinEffect(target: VideoEditCompositeTarget, builtinId: string, params?: Readonly<Record<string, unknown>>): string {
  return applyVideoEditBuiltinEffect(target.projectId, target.sequenceId, [target.clipId], builtinId, params)[0]
}
/**
 * 把同一个内置效果加到多个片段（PR：选中多个片段后双击效果），整体一步撤销。画面效果跳过声音片段、音频效果只加声音片段，
 * 锁定轨道上的片段跳过；一个都加不上时报错并说明原因。返回新效果 ID（与加上的片段一一对应）。
 */
export function applyVideoEditBuiltinEffect(projectId: string, sequenceId: string, clipIds: readonly string[], templateRef: string, params?: Readonly<Record<string, unknown>>): string[] {
  // 模板引用：内置效果 ID，或智能预设 `smart:<预设>`（内置效果 + 作用区域，4.7d）。
  const resolved = resolveVideoEditLibraryEffects(templateRef)
  // 不认识的 ID 交给登记表报错（会列出可用的内置效果）。
  if (!resolved) { requireVideoEditBuiltinEffect(templateRef); throw new Error(`没有这个效果：${templateRef}。`) }
  const templates = resolved.effects.map(effect => params ? { ...effect, builtin: { id: effect.builtin!.id, params: normalizeVideoEditBuiltinParams(effect.builtin!.id, params) } } : effect)
  const created: string[] = []
  editVideoProject(projectId, document => {
    created.length = 0
    const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
    if (!sequence) throw new Error('原序列已移除。')
    const locked = new Set(sequence.tracks.filter(track => track.locked).map(track => track.index))
    const media = resolved.media
    // 作用区域要逐帧分析素材画面：只加到视频、图片片段上。
    const targets = new Set(sequence.clips.filter(clip => clipIds.includes(clip.id) && videoEditEffectAccepts(media, clip) && !locked.has(clip.track) && (!resolved.needsSource || clip.kind === 'video' || clip.kind === 'image')).map(clip => clip.id))
    if (!targets.size && resolved.needsSource) throw new Error('请选择视频或图片片段：智能效果要分析素材画面，文字、图形、调整图层与声音片段不能使用；锁定轨道上的片段不能修改。')
    if (!targets.size) throw new Error(media === 'audio' ? '请选择声音片段：音频效果只能加到声音片段，锁定轨道上的片段不能修改。' : '请选择画面片段：声音片段和锁定轨道上的片段不能加画面效果。')
    const clips = sequence.clips.map(clip => {
      if (!targets.has(clip.id)) return clip
      if ((clip.effects?.length ?? 0) + templates.length > VIDEO_EDIT_MAX_EFFECTS) throw new Error(`片段“${clip.name}”最多只能放${VIDEO_EDIT_MAX_EFFECTS}项效果，请先删除不用的效果。`)
      const effects = templates.map(template => videoEditEffectSchema.parse({ ...structuredClone(template), id: crypto.randomUUID() }))
      created.push(...effects.map(effect => effect.id))
      return { ...clip, effects: [...(clip.effects ?? []), ...effects] }
    })
    return { ...document, sequences: document.sequences.map(value => value === sequence ? { ...sequence, clips } : value) }
  })
  return [...created]
}
/** `mask`：作用区域（4.7d），null 回到整个画面。 */
export interface VideoEditBuiltinEffectChanges { name?: string; enabled?: boolean; amount?: number; params?: Readonly<Record<string, unknown>>; mask?: VideoEditEffectMask | null }
/**
 * 改内置效果的参数、强度或开关。带手势时只预览（拖动中实时出画面），由 `finishVideoEditGesture` 提交成一步撤销。
 * 数值先夹进登记的范围（界面拖动、步进产生不了非法值）；未知参数与错类型仍报错。
 */
export function updateVideoEditBuiltinEffect(target: VideoEditCompositeTarget, effectId: string, changes: VideoEditBuiltinEffectChanges, gesture?: VideoEditGesture): void {
  editBuiltin(target, clip => {
    const effect = clip.effects?.find(effect => effect.id === effectId)
    if (!effect?.builtin) throw new Error('原内置效果已移除。')
    if (changes.name !== undefined) effect.name = changes.name
    if (changes.enabled !== undefined) effect.enabled = changes.enabled
    if (changes.amount !== undefined) effect.amount = Math.min(1, Math.max(0, changes.amount))
    if (changes.params) effect.builtin = { id: effect.builtin.id, params: normalizeVideoEditBuiltinParams(effect.builtin.id, changes.params, effect.builtin.params, true) }
    if (changes.mask === null) delete effect.mask
    else if (changes.mask) {
      assertVideoEditMaskTrackers(clip, changes.mask)
      if (isSmartRegionMask(changes.mask) && clip.kind !== 'video' && clip.kind !== 'image') throw new Error('智能区域只能用在视频、图片片段上。')
      effect.mask = changes.mask
    }
  }, gesture)
}
export async function reorderVideoEditEffects(target: VideoEditCompositeTarget, ids: string[], signal?: AbortSignal): Promise<void> {
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => {
    const clip = requireEffectClip(sequence, target.clipId)
    clip.effects = orderVideoEditEffects(clip.effects ?? [], ids)
  }, signal)
}
export async function deleteVideoEditEffects(target: VideoEditCompositeTarget, ids: string[], signal?: AbortSignal): Promise<void> {
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => {
    const clip = requireEffectClip(sequence, target.clipId)
    if (!ids.length || ids.some(id => !clip.effects?.some(effect => effect.id === id))) throw new Error('原效果已移除。')
    clip.effects = clip.effects!.filter(effect => !ids.includes(effect.id))
  }, signal)
}
export async function copyVideoEditEffects(target: VideoEditCompositeTarget, source: Pick<VideoEditCompositeTarget, 'sequenceId' | 'clipId'>, signal?: AbortSignal): Promise<void> {
  const sequence = requireVideoEditInstance(target.projectId).document.sequences.find(sequence => sequence.id === source.sequenceId)
  if (!sequence) throw new Error('原效果来源序列已移除。')
  const effects: VideoEditEffect[] = structuredClone(requireEffectClip(sequence, source.clipId).effects ?? []).map(effect => ({ ...effect, id: crypto.randomUUID() }))
  if (!effects.length) throw new Error('来源片段没有效果可复制。')
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => { requireEffectClip(sequence, target.clipId).effects = effects }, signal)
}
export async function updateVideoEditAdjustmentRange(target: VideoEditCompositeTarget, fromTrack: number, signal?: AbortSignal): Promise<void> {
  await editComposite(target.projectId, target.sequenceId, [target.clipId], sequence => {
    const clip = requireClip(sequence, target.clipId)
    if (clip.kind !== 'adjustment') throw new Error('请选择调整图层。')
    clip.adjustment = { fromTrack }
  }, signal)
}
export async function createVideoEditTransition(projectId: string, sequenceId: string, input: { leftClipId?: string; rightClipId?: string; durationFrames: number } & Partial<Pick<VideoEditTransition, 'kind' | 'alignment' | 'framesBeforeCut'>>, signal?: AbortSignal): Promise<string> {
  const transition = videoEditTransitionSchema.parse({ id: crypto.randomUUID(), kind: 'cross_dissolve', ...input })
  await editComposite(projectId, sequenceId, videoEditTransitionClipIds(transition), sequence => { (sequence.transitions ??= []).push(transition) }, signal)
  return transition.id
}
/** `changes` 为数字时只改时长（旧调用）；对象可同时改种类、时长与对齐（对齐不是自定义起点时去掉切点前帧数）。 */
export async function updateVideoEditTransition(projectId: string, sequenceId: string, transitionId: string, changes: number | Partial<Pick<VideoEditTransition, 'kind' | 'durationFrames' | 'alignment' | 'framesBeforeCut'>>, signal?: AbortSignal): Promise<void> {
  const transition = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)?.transitions?.find(transition => transition.id === transitionId)
  if (!transition) throw new Error('原转场已移除。')
  const patch = typeof changes === 'number' ? { durationFrames: changes } : changes
  await editComposite(projectId, sequenceId, videoEditTransitionClipIds(transition), sequence => {
    const list = sequence.transitions!; const index = list.findIndex(value => value.id === transitionId)
    const next = videoEditTransitionSchema.parse({ ...list[index], ...patch, ...(patch.kind && patch.kind !== list[index].kind ? { parameters: undefined } : {}) })
    // 换了种类：旧种类的参数不再适用，按新种类的默认值
    if (!next.parameters) delete next.parameters
    if (next.alignment === 'center') delete next.alignment
    if (next.alignment !== 'custom') delete next.framesBeforeCut
    list[index] = next
  }, signal)
}
export async function deleteVideoEditTransition(projectId: string, sequenceId: string, transitionId: string, signal?: AbortSignal): Promise<void> {
  const transition = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)?.transitions?.find(transition => transition.id === transitionId)
  if (!transition) throw new Error('原转场已移除。')
  await editComposite(projectId, sequenceId, videoEditTransitionClipIds(transition), sequence => { sequence.transitions = sequence.transitions!.filter(value => value.id !== transitionId) }, signal)
}
