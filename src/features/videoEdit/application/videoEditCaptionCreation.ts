import type { VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditCaptionSchema, type VideoEditCaption } from '@/core/videoEdit/timedContent'
import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'

/** Every creation path shares parsing, nearest styled peer inheritance and defaults. */
export function prepareVideoEditCaption(sequence: Pick<VideoEditSequence, 'captions'>, values: unknown): VideoEditCaption {
  const caption = videoEditCaptionSchema.parse(values)
  // An explicitly empty style opts out; only an omitted/undefined style inherits.
  if (caption.style !== undefined) return caption
  let nearest: VideoEditCaption | undefined
  for (const peer of sequence.captions ?? []) {
    if (!peer.style) continue
    if (!nearest || Number(peer.clipId === caption.clipId) > Number(nearest.clipId === caption.clipId)
      || (peer.clipId === caption.clipId) === (nearest.clipId === caption.clipId) && Math.abs(peer.start - caption.start) < Math.abs(nearest.start - caption.start)) nearest = peer
  }
  return { ...caption, style: nearest?.style ? structuredClone(nearest.style) : videoEditSubtitleStyleSchema.parse({}) }
}

export function prepareVideoEditCaptions(sequence: Pick<VideoEditSequence, 'captions'>, values: readonly VideoEditCaption[]): VideoEditCaption[] {
  return values.map(value => prepareVideoEditCaption(sequence, value))
}
