import { jsonEqual } from '../jsonEqual'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { z } from 'zod'
import type { VideoEditClip, VideoEditSequence, VideoEditDocument } from './document'
import { videoEditFps, type VideoEditRatio } from './time'
import { videoEditClipContentShift } from './clipSpeed'
import { retimeVideoEditAnnotation } from './annotations'
import { buildSubtitleText, parseSubtitleText } from '../media/subtitleFormat'
import { retimeVideoEditTransitions } from './transitions'
import { subtitleGraphic, videoEditSubtitleStyleSchema } from './subtitleStyle'
import type { VideoEditGraphic } from './graphics'
import { videoEditCaptionSpeechSchema, videoEditCaptionReviewSchema, createVideoEditSpeechCaptionRetimer } from './captionSpeech'
import { retimeVideoEditContentClips } from './contentAnchors'

const id = z.string().min(1).max(100)
const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
export const videoEditMarkerSchema = z.object({ id, clipId: id.optional(), frame, name: z.string().trim().min(1).max(200), type: z.enum(['marker', 'beat']).optional().describe('beat 为节拍，marker 或省略表示普通标记。'), strength: z.number().finite().min(0).max(1).optional().describe('节拍的相对重音强度，0–1。') }).strict()
export const videoEditCaptionSchema = z.object({ id, clipId: id.optional(), start: frame, duration: frame.min(1), text: z.string().min(1).max(2000).refine(text => Boolean(text.trim()), '字幕须包含文字。'),
  sourceText: z.string().optional().describe('排版前原句，供重新整理恢复行尾被移除的标点；人工改字后不覆盖现文。'),
  speech: videoEditCaptionSpeechSchema.optional().describe('自动字幕的来源文字及声音源区间，由字幕与剪辑服务维护。'),
  linkedCaptionId: id.optional().describe('来自所属片段链接的音频编辑文档里的这段字幕（音频编辑字幕段 ID）：文字、断句与时间由音频编辑维护，音频编辑改动后自动更新；在剪辑里改文字会写回音频编辑。'),
  reviewReasons: videoEditCaptionReviewSchema.optional().describe('剪辑后待复核的正文、译文或估算时间；确认对应内容后可清空。'),
  translation: z.string().trim().max(2000).optional().describe('第二语言字幕，显示在原文下方；空字符串清除翻译。'),
  // Reflection's shared unset-value convention is the empty string; make it a valid schema value.
  style: z.union([videoEditSubtitleStyleSchema, z.literal('')]).optional().describe('共享文字样式，空间量以1080p为参考，bottomMargin为底部安全区比例0–1；空字符串恢复默认。'),
}).strict()
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
  const requestedClips = new Map(after.clips.map(clip => [clip.id, clip]))
  const mappedClips = retimeVideoEditContentClips(before, after, origins)
  const derived = new Map(mappedClips.map(clip => [clip.id, clip]))
  const annotations = after.annotations.flatMap(mark => {
    if (!mark.clipId) return [mark]
    const requested = requestedClips.get(mark.clipId); const mapped = derived.get(mark.clipId)
    if (!requested?.contentAnchor) return [mark]
    if (!mapped) return []
    if (requested.start === mapped.start && requested.duration === mapped.duration) return [mark]
    const result = retimeVideoEditAnnotation(mark, requested, mapped, videoEditFps(after.frameRate))
    return result ? [result] : []
  })
  after = { ...after, clips: mappedClips, annotations }
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
  const retimeSpeech = before.captions?.some(caption => caption.speech) ? createVideoEditSpeechCaptionRetimer(before, after, origins) : undefined
  const captions = before.captions?.flatMap(caption => {
    if (caption.speech) return retimeSpeech!(caption)
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
  const sequences = requested.sequences.map(sequence => {
    const previous = before.sequences.find(value => value.id === sequence.id)
    if (!previous || previous === sequence || previous.frameRate.numerator * sequence.frameRate.denominator !== sequence.frameRate.numerator * previous.frameRate.denominator) return sequence
    const mappedAnnotations = sequence.annotations.flatMap(mark => {
      const prior = previous.annotations.find(value => value.id === mark.id)
      if (!prior) return [mark]
      let mapped = mark
      if (mark.clipId && prior.clipId === mark.clipId && prior.frame === mark.frame && prior.endFrame === mark.endFrame && jsonEqual(prior.target, mark.target)) {
        const beforeClip = previous.clips.find(clip => clip.id === mark.clipId); const afterClip = sequence.clips.find(clip => clip.id === mark.clipId)
        if (beforeClip && !afterClip) return []
        if (beforeClip && afterClip && !preserveProgramAnchors.includes(mark.clipId) && beforeClip.itemId === afterClip.itemId) {
          const result = retimeVideoEditAnnotation(mark, beforeClip, afterClip, videoEditFps(sequence.frameRate)); if (!result) return []; mapped = result
        }
      }
      if (mapped.target.kind === 'range' && prior.target.kind === 'range' && jsonEqual(prior.target.clipIds, mapped.target.clipIds) && jsonEqual(prior.target.trackIds, mapped.target.trackIds)) {
        const clipIds = mapped.target.clipIds?.filter(id => sequence.clips.some(clip => clip.id === id)); const trackIds = mapped.target.trackIds?.filter(id => sequence.tracks.some(track => track.id === id))
        if (mapped.target.clipIds?.length && !clipIds?.length || mapped.target.trackIds?.length && !trackIds?.length) return []
        mapped = { ...mapped, target: { ...mapped.target, ...(clipIds ? { clipIds } : {}), ...(trackIds ? { trackIds } : {}) } }
      }
      return [jsonEqual(mark, mapped) ? mark : mapped]
    })
    const annotations = mappedAnnotations.length === sequence.annotations.length && mappedAnnotations.every((mark, index) => mark === sequence.annotations[index]) ? sequence.annotations : mappedAnnotations
    if (jsonEqual(previous.clips, sequence.clips)) return annotations === sequence.annotations ? sequence : { ...sequence, annotations }
    // Replacing a clip's source preserves its program anchors; it is not an in-trim.
    const replacementOrigins = new Map(sequence.clips.filter(clip => preserveProgramAnchors.includes(clip.id) || previous.clips.some(prior => prior.id === clip.id && prior.itemId !== clip.itemId)).map(clip => [clip.id, { originalId: clip.id, shift: 0 }]))
    const mapped = retimeVideoEditContent(previous, { ...sequence, annotations }, replacementOrigins)
    return { ...sequence,
      clips: jsonEqual(sequence.clips, mapped.clips) ? sequence.clips : mapped.clips,
      annotations: jsonEqual(sequence.annotations, mapped.annotations) ? sequence.annotations : mapped.annotations,
      ...(jsonEqual(previous.markers, sequence.markers) && mapped.markers ? { markers: jsonEqual(sequence.markers, mapped.markers) ? sequence.markers : mapped.markers } : {}),
      ...(jsonEqual(previous.captions, sequence.captions) && mapped.captions ? { captions: jsonEqual(sequence.captions, mapped.captions) ? sequence.captions : mapped.captions } : {}),
      ...(jsonEqual(previous.transitions, sequence.transitions) && mapped.transitions ? { transitions: jsonEqual(sequence.transitions, mapped.transitions) ? sequence.transitions : mapped.transitions } : {}),
    }
  })
  return sequences.every((sequence, index) => sequence === requested.sequences[index]) ? requested : { ...requested, sequences }
}

export function importVideoEditCaptions(source: string, rate: VideoEditRatio, options: { offset?: number; clip?: VideoEditClip } = {}): VideoEditCaption[] {
  const fps = videoEditFps(rate); const offset = options.offset ?? 0
  const boundary = (us: number): number => Math.round(us * rate.numerator / (1e6 * rate.denominator)) + offset
  return parseSubtitleText(source).map(cue => {
    const start = boundary(cue.startUs); const end = boundary(cue.endUs)
    if (start < 0 || end <= start || end > Math.floor(fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS) || options.clip && (start < options.clip.start || end > options.clip.start + options.clip.duration)) throw new Error('字幕范围超出序列或所属片段；请调整导入位置或字幕时间。')
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
  if (sequence.captionTrackEnabled === false) return []
  return (sequence.captions ?? []).filter(caption => frame >= caption.start && frame < caption.start + caption.duration).map((caption, index) => ({
    id: `caption:${caption.id}`, itemId: '', name: '字幕', kind: 'text', track: 31,
    start: caption.start, duration: caption.duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 },
    x: 0, y: caption.style ? index === 0 ? 0 : -index * 0.1 : 0.35 - index * 0.1, scale: caption.style ? 1 : 0.65, rotation: 0, opacity: 1, volume: 0, text: captionDisplayText(caption),
    ...(caption.style ? { kind: 'graphic' as const, graphic: graphicForCaption(caption, sequence) } : {}),
  }))
}
/** A rendered caption as the equivalent text clip (graphic text origin folded into x/y), for layout and hit areas. */
export function videoEditCaptionTextClip(rendered: VideoEditClip, sequence: Pick<VideoEditSequence, 'width' | 'height'>): VideoEditClip {
  const object = rendered.graphic?.objects[0]
  return object ? { ...rendered, kind: 'text', graphic: undefined, textStyle: object.textStyle, x: rendered.x + Number(object.parameters.x) / sequence.width - .5, y: rendered.y + Number(object.parameters.y) / sequence.height - .5 } : rendered
}
