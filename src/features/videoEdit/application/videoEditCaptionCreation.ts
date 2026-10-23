import { rememberedFont } from '@/services/assistantMemory/memoryDefaults'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditCaptionSchema, type VideoEditCaption } from '@/core/videoEdit/timedContent'
import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'
import { listVideoEditSubtitlePresets } from './videoEditSubtitlePresetList'

/** Every creation path shares parsing, nearest styled peer inheritance and defaults. */
export function prepareVideoEditCaption(sequence: Pick<VideoEditSequence, 'captions'>, values: unknown, documentId?: string): VideoEditCaption {
  const caption = videoEditCaptionSchema.parse(values)
  // An explicitly empty style opts out; only an omitted/undefined style inherits.
  if (caption.style !== undefined) return caption
  let nearest: VideoEditCaption | undefined
  for (const peer of sequence.captions ?? []) {
    if (!peer.style) continue
    if (!nearest || Number(peer.clipId === caption.clipId) > Number(nearest.clipId === caption.clipId)
      || (peer.clipId === caption.clipId) === (nearest.clipId === caption.clipId) && Math.abs(peer.start - caption.start) < Math.abs(nearest.start - caption.start)) nearest = peer
  }
  if (nearest?.style) return { ...caption, style: structuredClone(nearest.style) }
  // Then the user's default text preset, then the plain default. Styles never set values; the AI applies them.
  const preferred = videoEditPresetPreferences.defaultId('text')
  const preset = preferred ? listVideoEditSubtitlePresets().find(value => value.id === preferred) : undefined
  const style = preset ? structuredClone(preset.style) : videoEditSubtitleStyleSchema.parse({})
  const font = rememberedFont(caption.text, documentId, style.fontFamily === 'sans-serif' ? undefined : style.fontFamily)
  return { ...caption, style: font ? { ...style, fontFamily: font } : style }
}

export function prepareVideoEditCaptions(sequence: Pick<VideoEditSequence, 'captions'>, values: readonly VideoEditCaption[], documentId?: string): VideoEditCaption[] {
  return values.map(value => prepareVideoEditCaption(sequence, value, documentId))
}
