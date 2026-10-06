import { parseVideoEditBuiltinRefId } from '@/core/videoEdit/builtinEffects'
import { applyVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { elementOfEventTarget } from '@/utils/crossRealmDom'

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
export function endVideoEditEffectDrag(): void { active = null }
export function readVideoEditEffectDrag(dataTransfer: DataTransfer | null, projectId: string): string | undefined {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(VIDEO_EDIT_EFFECT_DRAG_TYPE)) return undefined
  return parseVideoEditBuiltinRefId(dataTransfer.getData(VIDEO_EDIT_EFFECT_DRAG_TYPE)) ?? (active?.projectId === projectId ? active.builtinId : undefined)
}
interface DropEvent { dataTransfer: DataTransfer | null; target: EventTarget | null; clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }
function clipUnder(event: DropEvent): string | undefined {
  const hit = elementOfEventTarget(event.target)?.closest('[data-video-edit-clip]') ?? globalThis.document?.elementFromPoint?.(event.clientX, event.clientY)?.closest('[data-video-edit-clip]')
  return hit?.getAttribute('data-video-edit-clip') ?? undefined
}
/** 时间线 dragover：拖的是内置效果就接管（落在片段上显示可放下），返回 true；否则返回 false 交给原有拖放。 */
export function handleVideoEditEffectDragOver(event: DropEvent, projectId: string): boolean {
  if (!readVideoEditEffectDrag(event.dataTransfer, projectId)) return false
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = clipUnder(event) ? 'copy' : 'none'
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
