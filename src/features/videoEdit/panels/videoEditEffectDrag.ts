import { notificationText } from '@/i18n/notifications'
import { resolveVideoEditLibraryEffects, videoEditEffectNeedsSource, type VideoEditStylePieceEntry } from '../application/videoEditEffectPresets'
import { videoEditEffectAccepts } from '@/core/videoEdit/compositing'
import { applyVideoEditBuiltinEffect, applyVideoEditStylePiece } from '../application/videoEditCompositing'
import { requireVideoEditInstance } from '../application/videoEditService'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import type { CodeElementAddedEffect } from '@/core/videoEdit/codeElementOverrides'
import { videoEditCodeElementWriter, type VideoEditCodeElementTarget } from '../application/videoEditCodeElementEditing'
import { videoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'

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
/** 风格件单独一种拖动数据：松手走异步应用入口（代码成员要先试渲染），内置效果的同步入口不变。 */
const VIDEO_EDIT_STYLE_PIECE_DRAG_TYPE = 'application/x-henji-video-edit-style-piece'
let activePiece: { projectId: string; piece: VideoEditStylePieceEntry } | null = null
export function startVideoEditStylePieceDrag(dataTransfer: DataTransfer, projectId: string, piece: VideoEditStylePieceEntry): void {
  dataTransfer.setData(VIDEO_EDIT_STYLE_PIECE_DRAG_TYPE, piece.ref)
  dataTransfer.effectAllowed = 'copy'
  activePiece = { projectId, piece }
}
function readVideoEditStylePieceDrag(dataTransfer: DataTransfer | null, projectId: string): VideoEditStylePieceEntry | undefined {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(VIDEO_EDIT_STYLE_PIECE_DRAG_TYPE) || activePiece?.projectId !== projectId) return undefined
  // dragover 读不到数据；松手时数据须与拖起的风格件一致。
  const ref = dataTransfer.getData(VIDEO_EDIT_STYLE_PIECE_DRAG_TYPE)
  return !ref || ref === activePiece.piece.ref ? activePiece.piece : undefined
}
export function endVideoEditEffectDrag(): void { active = null; activePiece = null; clearVideoEditEffectDropTarget() }

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
/**
 * 放下时真正会加上效果的片段：落点在所选片段里时是全部所选，否则只有落点片段；画面效果跳过声音片段、音频效果只加声音片段，
 * 锁定轨道上的片段跳过（与松手时同一规则）。`source` 是内置效果模板引用或风格件，缺省按画面效果。
 */
export function videoEditEffectDropClips(sequence: Pick<VideoEditSequence, 'clips' | 'tracks'>, hitClipId: string, selectedClipIds: readonly string[], source?: string | VideoEditStylePieceEntry): string[] {
  const candidates = selectedClipIds.includes(hitClipId) ? selectedClipIds : [hitClipId]
  const locked = new Set(sequence.tracks.filter(track => track.locked).map(track => track.index))
  const template = typeof source === 'string' ? resolveVideoEditLibraryEffects(source) : source && { media: source.preset.media, needsSource: source.preset.effects.some(videoEditEffectNeedsSource) }
  if (source && !template) return []
  const media = template?.media ?? 'video'
  // 智能效果（带作用区域）只加到视频、图片片段（与松手时同一规则）。
  return sequence.clips.filter(clip => candidates.includes(clip.id) && videoEditEffectAccepts(media, clip) && !locked.has(clip.track) && (!template?.needsSource || clip.kind === 'video' || clip.kind === 'image')).map(clip => clip.id)
}
function readVideoEditEffectDrag(dataTransfer: DataTransfer | null, projectId: string): string | undefined {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(VIDEO_EDIT_EFFECT_DRAG_TYPE)) return undefined
  const data = dataTransfer.getData(VIDEO_EDIT_EFFECT_DRAG_TYPE)
  if (data) return resolveVideoEditLibraryEffects(data) ? data : undefined
  return active?.projectId === projectId ? active.builtinId : undefined
}
interface DropEvent { dataTransfer: DataTransfer | null; target: EventTarget | null; clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }
function clipUnder(event: DropEvent): string | undefined {
  const hit = elementOfEventTarget(event.target)?.closest('[data-video-edit-clip]') ?? globalThis.document?.elementFromPoint?.(event.clientX, event.clientY)?.closest('[data-video-edit-clip]')
  return hit?.getAttribute('data-video-edit-clip') ?? undefined
}
/**
 * 拖的是生成器、落点下又没有片段（轨道空白处或新建轨道的空白）时返回生成器 ID：松手新建一段图形片段（`dropVideoEditGenerator`），
 * 由时间线按素材的落点规则预演与放下；落在片段上仍按普通效果加到片段上，在它的范围里生成。
 */
export function videoEditGeneratorEmptyDrop(event: DropEvent, projectId: string): string | undefined {
  const builtinId = readVideoEditEffectDrag(event.dataTransfer, projectId)
  return builtinId && videoEditBuiltinEffect(builtinId)?.stage === 'generator' && !clipUnder(event) ? builtinId : undefined
}
/**
 * 时间线 dragover：拖的是内置效果或风格件就接管，返回 true；否则返回 false 交给原有拖放。给了 `target` 时按松手规则算出会加上效果的
 * 片段并高亮（落在媒介不符的片段或锁定轨道上显示不可放下）；没给时只看落点下有没有片段。
 */
export function handleVideoEditEffectDragOver(event: DropEvent, projectId: string, target?: { sequence: Pick<VideoEditSequence, 'clips' | 'tracks'>; selectedClipIds: readonly string[] }): boolean {
  const source = readVideoEditStylePieceDrag(event.dataTransfer, projectId) ?? readVideoEditEffectDrag(event.dataTransfer, projectId)
  if (!source) return false
  event.preventDefault()
  const hit = clipUnder(event)
  const clipIds = hit ? target ? videoEditEffectDropClips(target.sequence, hit, target.selectedClipIds, source) : [hit] : []
  if (event.dataTransfer) event.dataTransfer.dropEffect = clipIds.length ? 'copy' : 'none'
  setDropTarget(clipIds.length ? { projectId, clipIds } : null)
  return true
}
/** 时间线 drop：拖的是内置效果或风格件就加到落点片段（所选多个片段包含落点时加到全部所选），一步撤销；返回 true 表示已处理。 */
export function handleVideoEditEffectDrop(event: DropEvent, projectId: string, sequenceId: string, selectedClipIds: readonly string[], onError: (reason: unknown) => void): boolean {
  const piece = readVideoEditStylePieceDrag(event.dataTransfer, projectId)
  const builtinId = piece ? undefined : readVideoEditEffectDrag(event.dataTransfer, projectId)
  if (!piece && !builtinId) return false
  event.preventDefault(); event.stopPropagation(); endVideoEditEffectDrag()
  const clipId = clipUnder(event)
  if (!clipId) { onError(new Error(notificationText('effectUnavailable'))); return true }
  if (piece) {
    try {
      const sequence = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)
      if (!sequence) throw new Error('原序列已移除。')
      const targets = videoEditEffectDropClips(sequence, clipId, selectedClipIds, piece)
      if (!targets.length) { onError(new Error(notificationText('effectUnavailable'))); return true }
      void applyVideoEditStylePiece(projectId, sequenceId, targets, piece.ref).catch(onError)
    } catch (error) { onError(error) }
  } else if (clipId && builtinId) {
    try {
      const sequence = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)
      if (!sequence) throw new Error('原序列已移除。')
      const targets = videoEditEffectDropClips(sequence, clipId, selectedClipIds, builtinId)
      if (!targets.length) { onError(new Error(notificationText('effectUnavailable'))); return true }
      applyVideoEditBuiltinEffect(projectId, sequenceId, targets, builtinId)
    } catch (error) { onError(error) }
  }
  return true
}
/**
 * 拖到代码元素（画面选框或效果控件的元素视图）上的效果：元素效果链只放内置画面效果的参数，
 * 带作用区域、要分析素材的智能效果与风格件不能追加到元素上。
 */
function readVideoEditElementEffectDrag(dataTransfer: DataTransfer | null, projectId: string): { id: string; params: CodeElementAddedEffect['params'] } | undefined {
  const ref = readVideoEditEffectDrag(dataTransfer, projectId)
  const resolved = ref ? resolveVideoEditLibraryEffects(ref) : undefined
  const effect = resolved?.effects.length === 1 ? resolved.effects[0] : undefined
  if (!resolved || resolved.media !== 'video' || resolved.needsSource || !effect?.builtin || effect.mask || effect.builtin.regions) return undefined
  return { id: effect.builtin.id, params: effect.builtin.params as CodeElementAddedEffect['params'] }
}
/** 元素 dragover：拖的是效果就接管（能追加时显示复制，否则不可放下），返回 true；否则交给原有拖放。 */
export function handleVideoEditElementEffectDragOver(event: DropEvent, projectId: string): boolean {
  if (!readVideoEditStylePieceDrag(event.dataTransfer, projectId) && !readVideoEditEffectDrag(event.dataTransfer, projectId)) return false
  event.preventDefault(); event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = readVideoEditElementEffectDrag(event.dataTransfer, projectId) ? 'copy' : 'none'
  return true
}
/** 元素 drop：把效果追加到元素效果链末尾，一步撤销；返回 true 表示已处理。 */
export function handleVideoEditElementEffectDrop(event: DropEvent, target: VideoEditCodeElementTarget, onError: (reason: unknown) => void): boolean {
  const piece = readVideoEditStylePieceDrag(event.dataTransfer, target.projectId)
  const effect = readVideoEditElementEffectDrag(event.dataTransfer, target.projectId)
  if (!piece && !readVideoEditEffectDrag(event.dataTransfer, target.projectId)) return false
  event.preventDefault(); event.stopPropagation(); endVideoEditEffectDrag()
  try {
    if (!effect) throw new Error(piece ? '风格件不能追加到画面元素上；请拖到片段上，或在代码里用 look() 引用它。' : '这个效果需要分析素材或带作用区域，只能加到视频、图片片段上。')
    elementWriter.addVideoEditCodeElementEffect(target, effect)
  } catch (error) { onError(error) }
  return true
}
const elementWriter = videoEditCodeElementWriter('user')
