import { getDocumentHoverFrames } from '@/commands/documents'
import type { DocumentCoverSource } from '@/core/documents/types'
import { sha256HexString } from '@/utils/save/hash'
import { clipSourceSeconds, videoEditClipMedia, videoEditComposition, type VideoEditClip, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'

/** 封面取片子正中间：开头常是黑场、淡入或片头。也是合成预览最先生成的一格。 */
export const VIDEO_EDIT_COVER_POSITION = 0.5

export const VIDEO_EDIT_HOVER_LEVELS = [1, 4, 8, 16, 32, 48] as const

/** 取样落在同一张 48 格网格上，升档只补新位置；短片按实际整数帧去重。 */
export function videoEditHoverPositions(duration: number): Array<{ position: number; frame: number }> {
  const positions = new Set<number>([VIDEO_EDIT_COVER_POSITION * 48])
  for (const count of VIDEO_EDIT_HOVER_LEVELS.slice(1)) for (let index = 0; index < count; index++) positions.add(Math.floor(index * 48 / count))
  const frames = new Set<number>()
  return [...positions].flatMap(index => {
    const position = index / 48, frame = Math.min(Math.max(0, duration - 1), Math.floor(position * duration))
    if (frames.has(frame)) return []
    frames.add(frame)
    return [{ position, frame }]
  })
}

/** 片段在某一帧的原始画面：图片用原图，视频按片段源时间取一帧。 */
export function videoEditClipFrameSource(document: VideoEditDocument, clip: VideoEditClip, frame: number, fps: number): DocumentCoverSource | null {
  const media = videoEditClipMedia(document, clip)
  if (!media) return null
  if (media.kind === 'image') return { source: media.path, sourceKind: 'image' }
  if (media.kind !== 'video') return null
  const at = clipSourceSeconds(clip, Math.max(clip.start, Math.min(frame, clip.start + clip.duration - 1)), fps)
  return { source: media.path, sourceKind: 'video', atSeconds: Math.round(Math.max(0, at) * 1000) / 1000 }
}

/** 没有合成预览时从已导入素材稳定取样；时间线空隙或纯代码片段也能退回素材箱。 */
export function videoEditFrameSourceAt(document: VideoEditDocument, fraction: number): DocumentCoverSource | null {
  const position = Math.max(0, Math.min(0.999, fraction))
  const pictures = document.sequences.flatMap(sequence => sequence.clips
    .filter(clip => clip.kind === 'video' || clip.kind === 'image')
    .map(clip => ({ clip, fps: videoEditFps(sequence.frameRate) })))
    .filter(({ clip }) => !!videoEditClipMedia(document, clip))
  if (pictures.length) {
    const offset = position * pictures.length, { clip, fps } = pictures[Math.floor(offset)]
    return videoEditClipFrameSource(document, clip, clip.start + Math.floor((offset % 1) * clip.duration), fps)
  }
  const media = document.media.filter(item => item.kind === 'video' || item.kind === 'image')
  const offset = position * media.length, item = media[Math.floor(offset)]
  return item ? { source: item.path, sourceKind: item.kind as 'image' | 'video', ...(item.kind === 'video' ? { atSeconds: (offset % 1) * Math.max(0, item.durationSeconds - 0.1) } : {}) } : null
}

const keys = new WeakMap<VideoEditDocument, Promise<string>>()
export function videoEditHoverContentKey(document: VideoEditDocument): Promise<string> {
  let key = keys.get(document)
  if (!key) {
    // 取实际渲染快照：改名、保存和导出记录不会改变画面，嵌套序列与固定代码版本则会。
    const composition = document.sequences[0] ? videoEditComposition(document, document.sequences[0].id) : null
    const content = composition ? { ...composition, revision: 0 } : null
    key = sha256HexString(JSON.stringify(content, (_name: string, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : value))
    keys.set(document, key)
  }
  return key
}

/** 序列帧优先；没有有效缓存时才抽原素材，不在悬停路径渲染项目。 */
export async function loadVideoEditHoverPreview(document: VideoEditDocument): Promise<((fraction: number) => DocumentCoverSource | null) | null> {
  const stored = await getDocumentHoverFrames(document.id)
  if (stored?.frames.length && stored.contentKey === await videoEditHoverContentKey(document)) {
    return fraction => {
      const closest = stored.frames.reduce((best, item) => Math.abs(item.position - fraction) < Math.abs(best.position - fraction) ? item : best)
      return { source: closest.path, sourceKind: 'image' }
    }
  }
  const sources = Array.from({ length: 16 }, (_, index) => videoEditFrameSourceAt(document, (index + 0.5) / 16))
  if (!sources.some(Boolean)) return null
  return fraction => sources[Math.min(15, Math.floor(Math.max(0, fraction) * 16))]
}
