import { v5 as uuidv5 } from 'uuid'
import { videoEditClipMedia, videoEditNestedComposition, type VideoEditClip, type VideoEditComposition, type VideoEditDocument } from './document'
import { videoEditReachableSequences } from './sequenceGraph'
import { videoEditFps } from './time'
import { videoEditSequenceFrameAtSeconds } from './nestedSequences'
import { codeMaterialImageIds } from './codeMaterialResources'
import { videoEditEffectCodes } from './compositing'
import type { TrackingSequenceSource } from '../../platform/contracts/tracking'

export type TrackingDocument = Pick<VideoEditDocument, 'media' | 'items'> & Partial<Pick<VideoEditDocument, 'sequences' | 'codeMaterials' | 'colorLuts' | 'revision'>>

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
  const projection = { version: 1, sequences: sequences.map(sequence => {
    // The root is a composition snapshot: keep only sequence fields, never the surrounding document.
    const { media: _media, items: _items, revision: _revision, sequences: _sequences, codeMaterials: _code, colorLuts: _luts, fps: _fps, ...content } = sequence as VideoEditComposition
    return content
  }), items, media: document.media.filter(media => mediaIds.has(media.id)), codeMaterials: document.codeMaterials, colorLuts: document.colorLuts }
  const canonical = JSON.stringify(projection, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
  return { composition, source: { kind: 'sequence', signature: uuidv5(canonical, uuidv5.URL), fps: composition.fps, width: composition.width, height: composition.height } }
}

export function videoEditTrackingSequenceFrame(source: TrackingSequenceSource, trackingFrame: number, trackingFps: number): number {
  return videoEditSequenceFrameAtSeconds(trackingFrame / trackingFps, source.fps)
}
