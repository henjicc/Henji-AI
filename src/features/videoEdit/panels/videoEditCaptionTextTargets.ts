import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditCaptionClips, videoEditCaptionTextClip, type VideoEditCaption } from '@/core/videoEdit/timedContent'
import { layoutVideoEditText, videoEditTextWidth, type VideoEditTextLayout } from '@/core/videoEdit/text'

export interface CaptionTextTarget { captionId: string; field: 'text' | 'translation'; clip: VideoEditClip; layout: VideoEditTextLayout }

/** Keep caption editability in one place for both hit targets and active sessions. */
export function captionTextLocked(caption: VideoEditCaption): boolean { return 'locked' in caption && caption.locked === true }

/** Adapt the actual compositor clips, including graphic text origins, to the existing title overlay. */
export function videoEditCaptionTextTargets(sequence: VideoEditSequence, frame: number, measure: (text: string, font: string) => number): CaptionTextTarget[] {
  const captions = new Map((sequence.captions ?? []).map(caption => [`caption:${caption.id}`, caption]))
  return videoEditCaptionClips(sequence, frame).flatMap(rendered => {
    const caption = captions.get(rendered.id)!
    if (captionTextLocked(caption)) return []
    const clip = videoEditCaptionTextClip(rendered, sequence)
    const full = layoutVideoEditText(clip, sequence, measure)
    const primary = layoutVideoEditText({ ...clip, text: caption.text }, sequence, measure)
    return (['text', 'translation'] as const).flatMap(field => {
      if (field === 'translation' && !caption.translation) return []
      const first = field === 'text' ? 0 : primary.lines.length
      const lines = field === 'text' ? full.lines.slice(0, first + primary.lines.length) : full.lines.slice(first)
      const width = full.style.align.startsWith('justify') ? full.width : Math.max(1, ...lines.map(line => videoEditTextWidth(line, full.style, measure)))
      const offset = full.style.align.includes('center') ? (full.width - width) / 2 : full.style.align.includes('right') ? full.width - width : 0
      const top = full.contentTop + first * full.lineHeight
      return [{ captionId: caption.id, field, clip: { ...clip, id: `${rendered.id}:${field}`, text: caption[field] ?? '' }, layout: { ...full, lines, left: full.left + offset, top, contentTop: top, width, height: lines.length * full.lineHeight } }]
    })
  })
}
