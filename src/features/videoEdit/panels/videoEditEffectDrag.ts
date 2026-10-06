import { parseVideoEditBuiltinRefId } from '@/core/videoEdit/builtinEffects'
import { applyVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import type { VideoEditSequence } from '@/core/videoEdit/document'

/**
 * 从效果面板把内置效果拖到时间线片段上（PR：效果拖到片段上即应用）。拖动数据带上内置效果 ID；
 * dragover 读不到数据，由这里记住正在拖的效果。时间线只需在 dragover / drop 里先调这两个函数。
 */
export const VIDEO_EDIT_EFFECT_DRAG_TYPE = 'application/x-henji-video-edit-effect'
let active: { projectId: string; builtinId: string } | null = null
export function startVideoEditEffectDrag(dataTransfer: DataTransfer, projectId: string, builtinId: string): void {
  dataTransfer.setData(VIDEO_EDIT_EFFECT_DRAG_TYPE, builtinId)
  dataTransfer.effectAllowed = 'copy'
  active = { projectId, builtinId }
}
export function endVideoEditEffectDrag(): void { active = null; clearVideoEditEffectDropTarget() }

// —— 落点高亮（PR：拖效果经过片段时目标片段高亮）：dragover 时记下会加上效果的片段，时间线据此画高亮框。 ——
let dropTarget: { projectId: string; clipIds: readonly string[] } | null = null
const targetListeners = new Set<() => void>()
function setDropTarget(next: typeof dropTarget): void {
  const same = next === dropTarget || next && dropTarget && next.projectId === dropTarget.projectId && next.clipIds.length === dropTarget.clipIds.length && next.clipIds.every((id, index) => id === dropTarget!.clipIds[index])
  if (same) return
  dropTarget = next; for (const listener of targetListeners) listener()
}
export function subscribeVideoEditEffectDropTarget(listener: () => void): () => void { targetListeners.add(listener); return () => { targetListeners.delete(listener) } }
/** 拖动中、松手会加上效果的片段（没有时为 null；同一引用直到目标变化，可直接给 useSyncExternalStore）。 */
export function videoEditEffectDropTarget(): { projectId: string; clipIds: readonly string[] } | null { return dropTarget }
/** 拖出时间线、松手或取消拖动时清掉高亮。 */
export function clearVideoEditEffectDropTarget(): void { setDropTarget(null) }
/** 放下时真正会加上效果的片段：落点在所选片段里时是全部所选，否则只有落点片段；声音片段与锁定轨道上的片段跳过（与松手时同一规则）。 */
export function videoEditEffectDropClips(sequence: Pick<VideoEditSequence, 'clips' | 'tracks'>, hitClipId: string, selectedClipIds: readonly string[]): string[] {
  const candidates = selectedClipIds.includes(hitClipId) ? selectedClipIds : [hitClipId]
  const locked = new Set(sequence.tracks.filter(track => track.locked).map(track => track.index))
  return sequence.clips.filter(clip => candidates.includes(clip.id) && clip.kind !== 'audio' && !locked.has(clip.track)).map(clip => clip.id)
}
export function readVideoEditEffectDrag(dataTransfer: DataTransfer | null, projectId: string): string | undefined {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(VIDEO_EDIT_EFFECT_DRAG_TYPE)) return undefined
  return parseVideoEditBuiltinRefId(dataTransfer.getData(VIDEO_EDIT_EFFECT_DRAG_TYPE)) ?? (active?.projectId === projectId ? active.builtinId : undefined)
}
interface DropEvent { dataTransfer: DataTransfer | null; target: EventTarget | null; clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }
function clipUnder(event: DropEvent): string | undefined {
  const hit = elementOfEventTarget(event.target)?.closest('[data-video-edit-clip]') ?? globalThis.document?.elementFromPoint?.(event.clientX, event.clientY)?.closest('[data-video-edit-clip]')
  return hit?.getAttribute('data-video-edit-clip') ?? undefined
}
/**
 * 时间线 dragover：拖的是内置效果就接管，返回 true；否则返回 false 交给原有拖放。给了 `target` 时按松手规则算出会加上效果的
 * 片段并高亮（落在声音片段或锁定轨道上显示不可放下）；没给时只看落点下有没有片段。
 */
export function handleVideoEditEffectDragOver(event: DropEvent, projectId: string, target?: { sequence: Pick<VideoEditSequence, 'clips' | 'tracks'>; selectedClipIds: readonly string[] }): boolean {
  if (!readVideoEditEffectDrag(event.dataTransfer, projectId)) return false
  event.preventDefault()
  const hit = clipUnder(event)
  const clipIds = hit ? target ? videoEditEffectDropClips(target.sequence, hit, target.selectedClipIds) : [hit] : []
  if (event.dataTransfer) event.dataTransfer.dropEffect = clipIds.length ? 'copy' : 'none'
  setDropTarget(clipIds.length ? { projectId, clipIds } : null)
  return true
}
/** 时间线 drop：拖的是内置效果就加到落点片段（所选多个片段包含落点时加到全部所选），一步撤销；返回 true 表示已处理。 */
export function handleVideoEditEffectDrop(event: DropEvent, projectId: string, sequenceId: string, selectedClipIds: readonly string[], onError: (reason: unknown) => void): boolean {
  const builtinId = readVideoEditEffectDrag(event.dataTransfer, projectId)
  if (!builtinId) return false
  event.preventDefault(); event.stopPropagation(); endVideoEditEffectDrag()
  const clipId = clipUnder(event)
  if (clipId) {
    try { applyVideoEditBuiltinEffect(projectId, sequenceId, selectedClipIds.includes(clipId) ? selectedClipIds : [clipId], builtinId) } catch (error) { onError(error) }
  }
  return true
}
