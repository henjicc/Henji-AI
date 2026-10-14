import type { VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditCaptionSchema, type VideoEditCaption } from '@/core/videoEdit/timedContent'
import { styleKitSubtitleStyle, videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { resolveVideoEditStyleKit, type StyleKit } from '@/core/videoEdit/styleKit'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'
import { listVideoEditSubtitlePresets } from './videoEditSubtitlePresets'

/** Every creation path shares parsing, nearest styled peer inheritance and defaults. */
export function prepareVideoEditCaption(sequence: Pick<VideoEditSequence, 'captions' | 'styleKitId'>, values: unknown, document?: { styleKits?: StyleKit[] }): VideoEditCaption {
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
  // Then the user's default text preset (“跟随风格” included), then the bound style, then the plain default.
  const kit = document ? resolveVideoEditStyleKit(document, sequence) : undefined
  const preferred = videoEditPresetPreferences.defaultId('text')
  const preset = preferred ? listVideoEditSubtitlePresets(kit).find(value => value.id === preferred) : undefined
  return { ...caption, style: preset ? structuredClone(preset.style) : kit ? styleKitSubtitleStyle(kit) : videoEditSubtitleStyleSchema.parse({}) }
}

export function prepareVideoEditCaptions(sequence: Pick<VideoEditSequence, 'captions' | 'styleKitId'>, values: readonly VideoEditCaption[], document?: { styleKits?: StyleKit[] }): VideoEditCaption[] {
  return values.map(value => prepareVideoEditCaption(sequence, value, document))
}
