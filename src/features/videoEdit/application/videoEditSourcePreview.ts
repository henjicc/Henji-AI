import { createVideoEditSequence, videoEditComposition, type VideoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditFps } from '@/core/videoEdit/time'
import { readVideoEditCodeMetadata, withVideoEditCodeMetadata } from './videoEditCodeState'
import { requireVideoEditInstance } from './videoEditService'

/**
 * 源监视器预览没有源文件的素材项（代码画面、图形、文字）：用剪辑渲染器画一条只放这一项的临时序列，
 * 画幅与帧率跟当前序列。临时序列不写进作品，也不进撤销。
 */
export interface VideoEditSourcePreview { composition: VideoEditComposition; frames: number; fps: number; durationUs: number; width: number; height: number }

const PREVIEWABLE_KINDS = new Set(['code', 'graphic', 'text'])
const previews = new WeakMap<VideoEditDocument, Map<string, Promise<VideoEditSourcePreview>>>()
/** 最近一次算好的预览，供同步读时长与帧率（源监视器命令）；源状态 ready 时一定已经算好。 */
const settled = new Map<string, VideoEditSourcePreview>()

/** 这一项是否走预览渲染（而不是源文件播放）。 */
export function isVideoEditSourcePreviewItem(document: Pick<VideoEditDocument, 'items'>, itemId: string): boolean {
  const item = document.items.find(value => value.id === itemId)
  return Boolean(item && !item.mediaId && PREVIEWABLE_KINDS.has(item.kind))
}

export function videoEditSourcePreview(projectId: string, itemId: string): Promise<VideoEditSourcePreview> {
  const owner = requireVideoEditInstance(projectId); const document = owner.document
  const host = document.sequences.find(sequence => sequence.id === owner.activeSequenceId)
  const key = `${itemId}|${host ? `${host.width}x${host.height}@${host.frameRate.numerator}/${host.frameRate.denominator}` : ''}`
  let byItem = previews.get(document)
  if (!byItem) { byItem = new Map(); previews.set(document, byItem) }
  let preview = byItem.get(key)
  if (!preview) {
    preview = withVideoEditCodeMetadata(() => {
      const item = document.items.find(value => value.id === itemId)
      if (!item) throw new Error('素材项不存在。')
      if (!isVideoEditSourcePreviewItem(document, itemId)) throw new Error('这个素材项不能在源监视器里预览。')
      const read = readVideoEditCodeMetadata(owner, document)
      const sequence = { ...createVideoEditSequence('素材预览'), id: `source-preview-${item.id}`, ...(host ? { width: host.width, height: host.height, frameRate: host.frameRate, pixelAspectRatio: host.pixelAspectRatio } : {}) }
      const clip = makeVideoEditItemClip({ ...document, sequences: [...document.sequences, sequence] }, item.id, sequence.id, { frame: 0, track: 1 }, read)
      const composition = videoEditComposition({ ...document, sequences: [...document.sequences, { ...sequence, clips: [clip] }] }, sequence.id)
      const fps = videoEditFps(sequence.frameRate)
      return { composition, frames: clip.duration, fps, durationUs: Math.round(clip.duration / fps * 1e6), width: sequence.width, height: sequence.height }
    })
    const pending = preview
    pending.then(value => { settled.set(`${projectId}|${itemId}`, value) }, () => { if (byItem!.get(key) === pending) byItem!.delete(key) })
    byItem.set(key, pending)
  }
  return preview
}

/** 已经算好的预览（同步读）；还没算过时为空。 */
export function settledVideoEditSourcePreview(projectId: string, itemId: string): VideoEditSourcePreview | undefined {
  return settled.get(`${projectId}|${itemId}`)
}

/** 源监视器里这一项的播放时序：有源文件按文件，预览项按算好的预览（当作画面）；都没有时为空。 */
export function videoEditSourceTiming(projectId: string, itemId: string, fallbackFps: number): { kind: 'video' | 'audio' | 'image'; fps: number; durationSeconds: number } | undefined {
  const document = requireVideoEditInstance(projectId).document
  const item = document.items.find(value => value.id === itemId)
  const media = document.media.find(value => value.id === item?.mediaId)
  if (media) return { kind: media.kind, fps: media.frameRate ? media.frameRate.numerator / media.frameRate.denominator : fallbackFps, durationSeconds: media.durationSeconds }
  const preview = item && isVideoEditSourcePreviewItem(document, itemId) ? settled.get(`${projectId}|${itemId}`) : undefined
  return preview ? { kind: 'video', fps: preview.fps, durationSeconds: preview.durationUs / 1e6 } : undefined
}
