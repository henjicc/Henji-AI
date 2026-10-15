import { v5 as uuidv5 } from 'uuid'
import { videoEditClipMedia, videoEditNestedComposition, videoEditSequenceSchema, type VideoEditClip, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence } from './document'
import { videoEditReachableSequences } from './sequenceGraph'
import { videoEditFps } from './time'
import { videoEditSequenceFrameAtSeconds } from './nestedSequences'
import { codeMaterialImageIds } from './codeMaterialResources'
import { videoEditEffectCodes } from './compositing'
import type { TrackingSequenceSource } from '../../platform/contracts/tracking'

export type TrackingDocument = Pick<VideoEditDocument, 'media' | 'items'> & Partial<Pick<VideoEditDocument, 'sequences' | 'codeMaterials' | 'colorLuts' | 'revision'>>
const sequenceKeys = Object.keys(videoEditSequenceSchema.shape) as Array<keyof VideoEditSequence>

/** Worker 与渲染协调器共用键；机位不同不能共用同一源的跟踪结果。 */
export function videoEditTrackingSourceId(document: TrackingDocument, clip: VideoEditClip): string | undefined {
  return clip.kind === 'sequence' ? `${clip.itemId}:${clip.multicamCameraId ?? ''}` : videoEditClipMedia(document, clip)?.id
}

/** 子合成的内容身份不受父片段修剪、变速、跟踪或工程 revision 影响。 */
export function videoEditSequenceTrackingSource(document: TrackingDocument, clip: VideoEditClip): { source: TrackingSequenceSource; composition: VideoEditComposition } | undefined {
  if (clip.kind !== 'sequence') return undefined
  const sequence = document.sequences?.find(sequence => sequence.id === document.items.find(item => item.id === clip.itemId)?.sequenceId)
  if (!sequence) throw new Error('嵌套序列不存在。')
  const composition = videoEditNestedComposition({ ...document, ...sequence, revision: document.revision ?? 0, fps: videoEditFps(sequence.frameRate) }, clip)!
  const sequences = videoEditReachableSequences(document, composition)
  const ids = new Set(sequences.flatMap(sequence => sequence.clips.map(clip => clip.itemId)))
  const items = document.items.filter(item => ids.has(item.id))
  const mediaIds = new Set(items.map(item => item.mediaId))
  for (const sequence of sequences) for (const clip of sequence.clips) {
    for (const instance of [clip.code, ...videoEditEffectCodes(clip.effects)]) for (const id of codeMaterialImageIds(instance)) mediaIds.add(id)
  }
  // 根是合成快照，可能继承工程外壳与任务元数据；按权威序列字段投影，不维护排除名单。
  const projection = { version: 2, sequences: sequences.map(sequence => Object.fromEntries(sequenceKeys.map(key => [key, sequence[key]]))),
    items, media: document.media.filter(media => mediaIds.has(media.id)), codeMaterials: document.codeMaterials, colorLuts: document.colorLuts }
  const canonical = JSON.stringify(projection, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
  return { composition, source: { kind: 'sequence', signature: uuidv5(canonical, uuidv5.URL), fps: composition.fps, width: composition.width, height: composition.height } }
}

export function videoEditTrackingSequenceFrame(source: TrackingSequenceSource, trackingFrame: number, trackingFps: number): number {
  return videoEditSequenceFrameAtSeconds(trackingFrame / trackingFps, source.fps)
}
