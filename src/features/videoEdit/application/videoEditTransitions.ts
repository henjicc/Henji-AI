import { createLogger } from '@/core/logging'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { setVideoEditClipFade } from '@/core/videoEdit/fades'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyVideoEditTransitionPairs, dragVideoEditTransition, videoEditTransitionClipIds, videoEditDefaultTransitionKind, videoEditDefaultTransitionPairs, videoEditTransitionMedium, videoEditTransitionPreset, type VideoEditTransitionAlignment, type VideoEditTransitionKind, type VideoEditTransitionMedium, type VideoEditTransitionPair } from '@/core/videoEdit/transitions'
import { normalizeVideoEditTransitionParams } from '@/core/videoEdit/transitionParams'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { editComposite } from './videoEditCompositing'
import { beginVideoEditGesture, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, requireVideoEditInstance, setVideoEditTimelineView, updateVideoEditGesture, type VideoEditGesture, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.transitions')

/** PR 默认过渡时长：1 秒（按序列帧率取整，至少两帧）。 */
export function videoEditDefaultTransitionFrames(sequence: Pick<VideoEditSequence, 'frameRate'>): number {
  return Math.max(2, Math.round(sequence.frameRate.numerator / sequence.frameRate.denominator))
}

// —— 过渡选择（视图状态，不进文档）：时间线上点选的过渡块，效果控件据此显示过渡属性。 ——
const selections = new WeakMap<VideoEditInstance, { sequenceId: string; transitionId: string }>()
const listeners = new Set<() => void>()
let selectionVersion = 0
function publishSelection(): void { selectionVersion++; for (const listener of listeners) listener() }
export function subscribeVideoEditTransitionSelection(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditTransitionSelectionVersion(): number { return selectionVersion }
/** 当前选中的过渡：只在没有选中片段、且过渡仍在当前序列时有效（选片段即取消过渡选择，同 PR）。 */
export function selectedVideoEditTransitionId(instance: VideoEditInstance): string | undefined {
  const value = selections.get(instance)
  if (!value || instance.selectedClipIds.length || value.sequenceId !== instance.activeSequenceId) return undefined
  return getActiveVideoEditSequence(instance).transitions?.some(transition => transition.id === value.transitionId) ? value.transitionId : undefined
}
/** 选中一个过渡（同时清空片段选择）；传 null 取消。 */
export function selectVideoEditTransition(projectId: string, transitionId: string | null): void {
  const owner = requireVideoEditInstance(projectId)
  if (transitionId === null) { if (selections.delete(owner)) publishSelection(); return }
  selections.set(owner, { sequenceId: owner.activeSequenceId, transitionId })
  if (owner.selectedClipIds.length) setVideoEditTimelineView(projectId, { selectedClipIds: [] })
  publishSelection()
}

function sequenceOf(projectId: string, sequenceId: string): VideoEditSequence {
  const sequence = requireVideoEditInstance(projectId).document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('原序列已移除。')
  return sequence
}
async function commitPairs(projectId: string, sequenceId: string, pairs: readonly VideoEditTransitionPair[], options: { kind?: (medium: VideoEditTransitionMedium) => VideoEditTransitionKind; durationFrames?: number; alignment?: VideoEditTransitionAlignment }, operation: string, signal?: AbortSignal): Promise<string[]> {
  const sequence = sequenceOf(projectId, sequenceId)
  assertVideoEditClipsEditable(sequence, pairs.flatMap(videoEditTransitionClipIds))
  const result = applyVideoEditTransitionPairs(sequence, pairs, { ...options, durationFrames: options.durationFrames ?? videoEditDefaultTransitionFrames(sequence) })
  logger.debug('应用过渡', { event: 'video_edit.transition.apply.start', context: { projectId, sequenceId, operation, count: result.transitionIds.length } })
  try {
    await editComposite(projectId, sequenceId, [...new Set(pairs.flatMap(videoEditTransitionClipIds))], draft => { draft.transitions = result.sequence.transitions }, signal)
  } catch (error) { logger.debug('过渡未应用', { event: 'video_edit.transition.apply.failed', error, context: { projectId, sequenceId, operation } }); throw error }
  logger.debug('过渡已应用', { event: 'video_edit.transition.apply.completed', context: { projectId, sequenceId, operation, count: result.transitionIds.length } })
  return result.transitionIds
}
export type VideoEditDefaultTransitionRequest = { mode: 'playhead'; medium: VideoEditTransitionMedium } | { mode: 'selection' }
/** 命令的目标编辑点（Ctrl+D／Ctrl+Shift+D 取播放头最近的编辑点，Shift+D 取所选片段两端）。 */
export function videoEditDefaultTransitionTargets(instance: VideoEditInstance, request: VideoEditDefaultTransitionRequest, clipIds: readonly string[] = instance.selectedClipIds, frame = instance.frame): VideoEditTransitionPair[] {
  const sequence = getActiveVideoEditSequence(instance)
  if (request.mode === 'selection') return videoEditDefaultTransitionPairs(sequence, { mode: 'selection', clipIds })
  const tracks = sequence.tracks.filter(track => track.kind === request.medium && instance.targetTrackIds.includes(track.id)).map(track => track.index)
  return videoEditDefaultTransitionPairs(sequence, { mode: 'playhead', medium: request.medium, frame, tracks })
}
/** PR 应用默认过渡（一步编辑）：用户设的默认过渡（未设时视频交叉溶解、音频恒定功率），各 1 秒，放不下时缩短。 */
export async function applyVideoEditDefaultTransitions(projectId: string, sequenceId: string, pairs: readonly VideoEditTransitionPair[], signal?: AbortSignal): Promise<string[]> {
  const preferences = useSettingsStore.getState().videoEditDefaultTransitions
  return commitPairs(projectId, sequenceId, pairs, { kind: medium => videoEditDefaultTransitionKind(preferences, medium) }, 'default', signal)
}
/** 从效果面板把过渡预设拖到编辑点上（一步编辑）；`alignment` 由落点在切点哪一侧决定。 */
export async function placeVideoEditTransition(projectId: string, sequenceId: string, pair: VideoEditTransitionPair, kind: VideoEditTransitionKind, alignment: VideoEditTransitionAlignment, signal?: AbortSignal): Promise<string> {
  const [id] = await commitPairs(projectId, sequenceId, [pair], { kind: () => kind, alignment }, 'drop', signal)
  return id
}

/** 效果面板里双击过渡（PR）：放到所选片段两端的编辑点（旁边是空白时为单侧过渡），只放同种媒介，一步编辑。 */
export async function applyVideoEditTransitionToSelection(projectId: string, kind: VideoEditTransitionKind, signal?: AbortSignal): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId)
  if (!owner.selectedClipIds.length) throw new Error('先在时间线上选中片段，再双击过渡；也可以把过渡拖到片段相接处或片段一端。')
  const medium = videoEditTransitionMedium(kind)
  const pairs = videoEditDefaultTransitionTargets(owner, { mode: 'selection' }).filter(pair => pair.medium === medium)
  if (!pairs.length) throw new Error(medium === 'audio' ? '所选片段里没有声音片段，音频过渡要放在声音片段上。' : '所选片段里没有画面片段，视频过渡要放在画面片段上。')
  return commitPairs(projectId, owner.activeSequenceId, pairs, { kind: () => kind }, 'library', signal)
}
/**
 * 改带参数过渡（擦除、推动……4.7）的参数：效果控件拖动数值时带手势只预览，松手提交成一步撤销；不带手势时就是一步编辑。
 * 内置过渡是确定的 GPU 实现，不走代码素材的试渲染。数值夹进登记范围，未知参数与错类型报错。
 */
export function updateVideoEditTransitionParams(projectId: string, sequenceId: string, transitionId: string, params: Readonly<Record<string, unknown>>, gesture?: VideoEditGesture): void {
  const update = (document: VideoEditDocument): VideoEditDocument => {
    const sequence = document.sequences.find(value => value.id === sequenceId)
    const transition = sequence?.transitions?.find(value => value.id === transitionId)
    if (!sequence || !transition) throw new Error('原过渡已移除。')
    assertVideoEditClipsEditable(sequence, videoEditTransitionClipIds(transition))
    const parameters = normalizeVideoEditTransitionParams(transition.kind, videoEditTransitionPreset(transition.kind).name, params, transition.parameters, true)
    return { ...document, sequences: document.sequences.map(value => value === sequence ? { ...sequence, transitions: sequence.transitions!.map(item => item === transition ? { ...transition, parameters } : item) } : value) }
  }
  if (gesture) {
    if (gesture.projectId !== projectId) throw new Error('原参数调整已结束，请重新编辑。')
    updateVideoEditGesture(gesture, update)
  } else editVideoProject(projectId, update)
}

// —— 时间线上的拖动：过渡块改时长／平移、淡化手柄改长度。整次拖动是一个手势（实时预览、松手只记一步撤销）。 ——
export interface VideoEditTimelineHandleDrag { readonly gesture: VideoEditGesture; readonly owner: VideoEditInstance; readonly sequenceId: string; readonly baseline: VideoEditSequence }
function beginDrag(projectId: string, sequenceId: string, clipIds: string[]): VideoEditTimelineHandleDrag {
  const owner = requireVideoEditInstance(projectId)
  if (owner.activeSequenceId !== sequenceId) throw new Error('请先打开目标序列。')
  const baseline = sequenceOf(projectId, sequenceId)
  assertVideoEditClipsEditable(baseline, clipIds)
  return { gesture: beginVideoEditGesture(projectId), owner, sequenceId, baseline }
}
function previewSequence(drag: VideoEditTimelineHandleDrag, change: (sequence: VideoEditSequence) => VideoEditSequence): void {
  updateVideoEditGesture(drag.gesture, document => ({ ...document, sequences: document.sequences.map(value => value.id === drag.sequenceId ? change(drag.baseline) : value) }))
}
export function beginVideoEditTransitionDrag(projectId: string, sequenceId: string, transitionId: string): VideoEditTimelineHandleDrag {
  const transition = sequenceOf(projectId, sequenceId).transitions?.find(value => value.id === transitionId)
  if (!transition) throw new Error('原过渡已移除。')
  return beginDrag(projectId, sequenceId, videoEditTransitionClipIds(transition))
}
/** 拖过渡块：`mode` in／out 改时长（另一缘不动），move 沿切点平移；`delta` 相对按下时的整数帧。 */
export function previewVideoEditTransitionDrag(drag: VideoEditTimelineHandleDrag, transitionId: string, mode: 'in' | 'out' | 'move', delta: number): void {
  previewSequence(drag, sequence => {
    const next = dragVideoEditTransition(sequence, transitionId, mode, delta)
    return { ...sequence, transitions: sequence.transitions!.map(value => value.id === transitionId ? next : value) }
  })
}
export function beginVideoEditFadeDrag(projectId: string, sequenceId: string, clipId: string): VideoEditTimelineHandleDrag { return beginDrag(projectId, sequenceId, [clipId]) }
/** 拖淡化手柄：`frames` 为淡化长度（0 = 去掉）。 */
export function previewVideoEditFadeDrag(drag: VideoEditTimelineHandleDrag, clipId: string, edge: 'in' | 'out', frames: number): void {
  previewSequence(drag, sequence => ({ ...sequence, clips: sequence.clips.map((clip: VideoEditClip) => clip.id === clipId ? setVideoEditClipFade(clip, edge, frames) : clip) }))
}
/** 松手提交（只有内容真的变了才记一步撤销）；`commit: false` 撤回到按下前。 */
export function finishVideoEditTimelineHandleDrag(drag: VideoEditTimelineHandleDrag, commit = true): void { finishVideoEditGesture(drag.gesture, commit) }
