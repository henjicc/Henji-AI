import { z } from 'zod'
import type { VideoEditClip, VideoEditSequence, VideoEditDocument } from './document'
import { videoEditFps, type VideoEditRatio } from './time'
import { videoEditClipContentShift } from './clipSpeed'
import { buildSubtitleText, parseSubtitleText } from '../media/subtitleFormat'
import { retimeVideoEditTransitions } from './transitions'
import { subtitleGraphic, videoEditSubtitleStyleSchema } from './subtitleStyle'
import type { VideoEditGraphic } from './graphics'

const id = z.string().min(1).max(100)
const frame = z.number().int().nonnegative().max(108000)
export const videoEditMarkerSchema = z.object({ id, clipId: id.optional(), frame, name: z.string().trim().min(1).max(200) }).strict()
export const videoEditCaptionSchema = z.object({ id, clipId: id.optional(), start: frame, duration: frame.min(1), text: z.string().trim().min(1).max(2000),
  translation: z.string().trim().max(2000).optional().describe('第二语言字幕，显示在原文下方；空字符串清除翻译。'),
  // Reflection's shared unset-value convention is the empty string; make it a valid schema value.
  style: z.union([videoEditSubtitleStyleSchema, z.literal('')]).optional().describe('字幕样式：fontFamily 为 sans-serif/serif/monospace；fontSize 为1080p参考字号（12–200）；outline 描边、background 底框、bottomMargin 底部安全区比例（0.05–0.4）。整体写入，可多行同事务修改；空字符串恢复默认样式。'),
}).strict().refine(value => !value.style || captionDisplayText(value).split('\n').length <= 3, '带样式字幕最多三行，请先拆分长句。')
export type VideoEditMarker = z.infer<typeof videoEditMarkerSchema>
export type VideoEditCaption = z.infer<typeof videoEditCaptionSchema>
const subtitleGraphics = new WeakMap<VideoEditCaption, { key: string; graphic: VideoEditGraphic }>()
export function captionDisplayText(caption: { text: string; translation?: string }): string { return [caption.text, caption.translation].filter(Boolean).join('\n') }
function graphicForCaption(caption: VideoEditCaption, sequence: VideoEditSequence): VideoEditGraphic {
  if (!caption.style) throw new Error('此字幕未设置样式。')
  const text = captionDisplayText(caption)
  const key = JSON.stringify([sequence.width, sequence.height, text, caption.style])
  const cached = subtitleGraphics.get(caption)
  if (cached?.key === key) return cached.graphic
  const graphic = subtitleGraphic(text, sequence.width, sequence.height, caption.style)
  subtitleGraphics.set(caption, { key, graphic }); return graphic
}
export interface VideoEditContentOrigin { originalId: string; shift: number }

/** Sequence anchors stay at their program clock. Clip anchors follow only their owner. */
export function retimeVideoEditContent(before: VideoEditSequence, after: VideoEditSequence, origins: ReadonlyMap<string, VideoEditContentOrigin> = new Map(), dropLostTransitionBoundary = false): VideoEditSequence {
  const prior = new Map(before.clips.map(clip => [clip.id, clip]))
  const descendants = new Map<string, Array<{ clip: VideoEditClip; shift: number }>>()
  for (const clip of after.clips) {
    const origin = origins.get(clip.id)
    const previous = prior.get(origin?.originalId ?? clip.id)
    if (!previous) continue
    const staticInTrim = (clip.kind === 'text' || clip.kind === 'image') && !clip.effects?.length && clip.start !== previous.start && clip.start + clip.duration === previous.start + previous.duration
    const shift = origin?.shift ?? (staticInTrim ? 0 : videoEditClipContentShift(previous, clip, videoEditFps(before.frameRate)))
    const values = descendants.get(previous.id) ?? []; values.push({ clip, shift }); descendants.set(previous.id, values)
  }
  const markers = before.markers?.flatMap(marker => {
    if (!marker.clipId) return [marker]
    return (descendants.get(marker.clipId) ?? []).flatMap(({ clip, shift }) => {
      const frame = marker.frame + shift
      return frame >= clip.start && frame < clip.start + clip.duration ? [{ ...marker, clipId: clip.id, frame }] : []
    })
  })
  const captions = before.captions?.flatMap(caption => {
    if (!caption.clipId) return [caption]
    let retained = false
    return (descendants.get(caption.clipId) ?? []).flatMap(({ clip, shift }) => {
      const start = Math.max(clip.start, caption.start + shift)
      const end = Math.min(clip.start + clip.duration, caption.start + caption.duration + shift)
      if (end <= start) return []
      const value = { ...caption, id: retained ? crypto.randomUUID() : caption.id, clipId: clip.id, start, duration: end - start }; retained = true; return [value]
    })
  })
  return retimeVideoEditTransitions(before, { ...after, ...(markers ? { markers } : {}), ...(captions ? { captions } : {}) }, origins, dropLostTransitionBoundary)
}

/** Raw property writes receive the same clip anchoring as manual timeline commands. */
export function reconcileVideoEditTimedContent(before: VideoEditDocument, requested: VideoEditDocument, preserveProgramAnchors: readonly string[] = []): VideoEditDocument {
  return { ...requested, sequences: requested.sequences.map(sequence => {
    const previous = before.sequences.find(value => value.id === sequence.id)
    if (!previous || previous.frameRate.numerator * sequence.frameRate.denominator !== sequence.frameRate.numerator * previous.frameRate.denominator || JSON.stringify(previous.clips) === JSON.stringify(sequence.clips)) return sequence
    // Replacing a clip's source preserves its program anchors; it is not an in-trim.
    const replacementOrigins = new Map(sequence.clips.filter(clip => preserveProgramAnchors.includes(clip.id) || previous.clips.some(prior => prior.id === clip.id && prior.itemId !== clip.itemId)).map(clip => [clip.id, { originalId: clip.id, shift: 0 }]))
    const mapped = retimeVideoEditContent(previous, sequence, replacementOrigins)
    return { ...sequence, ...(JSON.stringify(previous.markers) === JSON.stringify(sequence.markers) && mapped.markers ? { markers: mapped.markers } : {}), ...(JSON.stringify(previous.captions) === JSON.stringify(sequence.captions) && mapped.captions ? { captions: mapped.captions } : {}), ...(JSON.stringify(previous.transitions) === JSON.stringify(sequence.transitions) && mapped.transitions ? { transitions: mapped.transitions } : {}) }
  }) }
}

export function importVideoEditCaptions(source: string, rate: VideoEditRatio, options: { offset?: number; clip?: VideoEditClip } = {}): VideoEditCaption[] {
  const fps = videoEditFps(rate); const offset = options.offset ?? 0
  const boundary = (us: number): number => Math.round(us * rate.numerator / (1e6 * rate.denominator)) + offset
  return parseSubtitleText(source).map(cue => {
    const start = boundary(cue.startUs); const end = boundary(cue.endUs)
    if (start < 0 || end <= start || end > Math.floor(fps * 1800) || options.clip && (start < options.clip.start || end > options.clip.start + options.clip.duration)) throw new Error('字幕范围超出序列或所属片段；请调整导入位置或字幕时间。')
    return { id: crypto.randomUUID(), ...(options.clip ? { clipId: options.clip.id } : {}), start, duration: end - start, text: cue.text }
  })
}
/** Cues are clipped to the half-open export range; the clock may keep sequence time or start at the in point. */
export function exportVideoEditCaptions(sequence: VideoEditSequence, format: 'srt' | 'vtt' = 'srt', range?: { startFrame: number; endFrame: number; clock?: 'sequence' | 'range' }): string {
  const from = range?.startFrame ?? 0; const to = range?.endFrame ?? Infinity
  const us = (frame: number): number => Math.round((frame - (range?.clock === 'sequence' ? 0 : from)) * sequence.frameRate.denominator * 1e6 / sequence.frameRate.numerator)
  return buildSubtitleText([...(sequence.captions ?? [])].filter(caption => caption.start < to && caption.start + caption.duration > from).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map(caption => ({ startUs: us(Math.max(from, caption.start)), endUs: us(Math.min(to, caption.start + caption.duration)), text: captionDisplayText(caption) })), format)
}

/** Burned-in captions use the existing full-resolution text compositor, above video tracks. */
export function videoEditCaptionClips(sequence: VideoEditSequence, frame: number): VideoEditClip[] {
  return (sequence.captions ?? []).filter(caption => frame >= caption.start && frame < caption.start + caption.duration).map((caption, index) => ({
    id: `caption:${caption.id}`, itemId: '', name: '字幕', kind: 'text', track: 31,
    start: caption.start, duration: caption.duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 },
    x: 0, y: caption.style ? index === 0 ? 0 : -index * 0.1 : 0.35 - index * 0.1, scale: caption.style ? 1 : 0.65, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: captionDisplayText(caption),
    ...(caption.style ? { kind: 'graphic' as const, graphic: graphicForCaption(caption, sequence) } : {}),
  }))
}
