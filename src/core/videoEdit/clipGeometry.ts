import { videoEditTransitionMedium, videoEditTransitionWindow, videoEditTransitionsAt, type VideoEditTransitionWindow } from './transitions'
import type { VideoEditClip, VideoEditComposition, VideoEditSequence } from './document'

/*
 * 片段画面坐标 ↔ 序列画面坐标（任务 4.10）。与合成器顶点着色器（`VIDEO_EDIT_LAYER_VERTEX`）同一套几何：
 * 画面按“适合”放进序列再乘缩放，绕运动锚点按像素旋转（正角度顺时针，y 向下），锚点位置为 x、y（序列宽、高的比例）。
 * 遮罩、跟踪框都存成片段画面的归一化坐标；节目监视器上画、拖、显示时用这里换算，渲染时由合成器按同一几何画上去。
 * 被主进程引用的可能：只用相对路径导入。
 */

export interface VideoEditSize { width: number; height: number }
export type VideoEditClipPlacement = Pick<VideoEditClip, 'x' | 'y' | 'scale' | 'rotation' | 'anchorX' | 'anchorY'> & Partial<Pick<VideoEditClip, 'scaleAspect'>>

/** 垂直缩放与水平缩放之比（非等比缩放），缺省 1。 */
export function videoEditClipScaleAspect(placement: Partial<Pick<VideoEditClip, 'scaleAspect'>>): number { return placement.scaleAspect ?? 1 }

/**
 * 片段画面的尺寸（遮罩、跟踪结果的宽高比以它为准）：视频与图片按素材显示尺寸，图形片段按图形画布，
 * 文字、代码与调整图层的画面就是整个序列。
 */
export function videoEditClipPictureSize(document: Pick<VideoEditComposition, 'media' | 'items' | 'width' | 'height' | 'sequences'>, clip: Pick<VideoEditClip, 'itemId' | 'kind' | 'graphic'>): VideoEditSize {
  if (clip.kind === 'sequence') {
    const item = document.items.find(entry => entry.id === clip.itemId)
    const sequence = document.sequences?.find(entry => entry.id === item?.sequenceId)
    if (sequence) return { width: Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator), height: sequence.height }
  }
  if (clip.kind === 'video' || clip.kind === 'image') {
    const item = document.items.find(entry => entry.id === clip.itemId)
    const media = document.media.find(entry => entry.id === item?.mediaId)
    if (media && media.width > 0 && media.height > 0) return { width: media.width, height: media.height }
  }
  if (clip.kind === 'graphic' && clip.graphic) return { width: clip.graphic.width, height: clip.graphic.height }
  return { width: document.width, height: document.height }
}

interface Mapping { halfWidth: number; halfHeight: number; cos: number; sin: number; offsetX: number; offsetY: number; frame: VideoEditSize }
function mapping(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): Mapping {
  const fit = Math.min(frame.width / Math.max(1, picture.width), frame.height / Math.max(1, picture.height)) * placement.scale
  const angle = placement.rotation * Math.PI / 180
  const center = videoEditClipCenterPosition(placement, picture, frame)
  return { halfWidth: picture.width * fit / 2, halfHeight: picture.height * fit * videoEditClipScaleAspect(placement) / 2, cos: Math.cos(angle), sin: Math.sin(angle), offsetX: center.x * frame.width, offsetY: center.y * frame.height, frame }
}
/** Anchor is normalized in the source picture; x/y locate that anchor in the sequence. */
export function videoEditClipCenterPosition(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): { x: number; y: number } {
  const fit = Math.min(frame.width / Math.max(1, picture.width), frame.height / Math.max(1, picture.height)) * placement.scale
  const angle = placement.rotation * Math.PI / 180
  const dx = (0.5 - (placement.anchorX ?? 0.5)) * picture.width * fit; const dy = (0.5 - (placement.anchorY ?? 0.5)) * picture.height * fit * videoEditClipScaleAspect(placement)
  return { x: placement.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) / frame.width, y: placement.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) / frame.height }
}

/** 片段画面归一化坐标 → 序列画面归一化坐标。 */
export function videoEditClipToFrame(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize, u: number, v: number): { x: number; y: number } {
  const map = mapping(placement, picture, frame)
  const px = (u * 2 - 1) * map.halfWidth; const py = (v * 2 - 1) * map.halfHeight
  const rx = px * map.cos - py * map.sin; const ry = px * map.sin + py * map.cos
  return { x: 0.5 + (rx + map.offsetX) / frame.width, y: 0.5 + (ry + map.offsetY) / frame.height }
}

/** 序列画面归一化坐标 → 片段画面归一化坐标（可以落在 0–1 之外，表示画面外）。 */
export function videoEditFrameToClip(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize, x: number, y: number): { u: number; v: number } {
  const map = mapping(placement, picture, frame)
  const rx = (x - 0.5) * frame.width - map.offsetX; const ry = (y - 0.5) * frame.height - map.offsetY
  const px = rx * map.cos + ry * map.sin; const py = -rx * map.sin + ry * map.cos
  return { u: (px / Math.max(1e-9, map.halfWidth) + 1) / 2, v: (py / Math.max(1e-9, map.halfHeight) + 1) / 2 }
}

/** 片段画面上一段归一化长度（横向）对应序列画面的像素比例：拖动控制柄时把序列上的位移换回片段坐标。 */
export function videoEditClipPixelScale(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): number {
  return Math.min(frame.width / Math.max(1, picture.width), frame.height / Math.max(1, picture.height)) * placement.scale
}
/** 纵向的同一比例：非等比缩放时与横向不同（跟踪框、光标这类按画面高度定大小的量用它）。 */
export function videoEditClipPixelScaleY(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): number {
  return videoEditClipPixelScale(placement, picture, frame) * videoEditClipScaleAspect(placement)
}

export function videoEditClipEnabled(clip: Pick<VideoEditClip, 'enabled'>): boolean { return clip.enabled !== false }
/**
 * 轨道级显示：输出启用、且没被画面独奏排除的轨道序号；声音轨道总在其中（声音的独奏与静音由 audibleVideoEditClips 处理）。
 * 只回答轨道本身的问题，判断某个片段画不画一律用 videoEditPictureFilter。
 */
export function videoEditVisibleTrackIndexes(document: Pick<VideoEditSequence, 'tracks'>): Set<number> {
  const solo = document.tracks.some(track => track.kind === 'video' && track.enabled && track.solo)
  return new Set(document.tracks.filter(track => track.enabled && (track.kind === 'audio' || !solo || track.solo)).map(track => track.index))
}
export interface VideoEditPictureFilter { has(clip: Pick<VideoEditClip, 'track' | 'enabled'>): boolean }
/** 片段画面是否参与合成：所在轨道显示并且片段启用。 */
export function videoEditPictureFilter(document: Pick<VideoEditSequence, 'tracks'>): VideoEditPictureFilter {
  const tracks = videoEditVisibleTrackIndexes(document)
  return { has: clip => videoEditClipEnabled(clip) && tracks.has(clip.track) }
}

function pictureTransition(window: VideoEditTransitionWindow, tracks: ReadonlySet<number>): VideoEditTransitionWindow[] {
  if (!tracks.has(window.left.track)) return []
  // 单侧过渡两边是同一个片段，只会整段保留或整段去掉。
  const left = videoEditClipEnabled(window.left); const right = videoEditClipEnabled(window.right)
  if (!left && !right) return []
  return [left && right ? window : { ...window, empty: left ? 'right' : 'left' }]
}
/**
 * 参与合成的画面过渡（对齐 PR）：轨道隐藏或两侧都停用的过渡不出现；只停用一侧时过渡照常进行，`empty` 标出那一侧，按透明画。
 * 音频过渡不经过这里，停用片段不进混音即可。
 */
export function videoEditPictureTransitionWindows(document: Pick<VideoEditSequence, 'tracks' | 'clips' | 'transitions'>): VideoEditTransitionWindow[] {
  const tracks = videoEditVisibleTrackIndexes(document)
  return (document.transitions ?? []).filter(transition => videoEditTransitionMedium(transition.kind) === 'video').flatMap(transition => pictureTransition(videoEditTransitionWindow(document, transition), tracks))
}
/** 指定帧上参与合成的画面过渡，规则同 videoEditPictureTransitionWindows。 */
export function videoEditPictureTransitionsAt(document: Pick<VideoEditSequence, 'tracks' | 'clips' | 'transitions'>, frame: number): VideoEditTransitionWindow[] {
  const tracks = videoEditVisibleTrackIndexes(document)
  return videoEditTransitionsAt(document, frame).flatMap(window => pictureTransition(window, tracks))
}
