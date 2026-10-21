import { scaleVideoEditTextStyle } from '../text'
import { videoEditGraphicSchema } from '../graphics'
import { videoEditNativeTemplateClipSchema, videoEditNativeTemplateContentSchema, type VideoEditClip, type VideoEditNativeTemplateClip, type VideoEditNativeTemplateContent, type VideoEditSequence } from '../document'
import { videoEditFps } from '../time'

/**
 * 原生模板：一组文字与图形片段的快照。应用时按目标画幅缩放、按时长换算关键帧并重新生成对象标识；
 * “文字槽”按片段顺序数文字片段与图形里的文字对象，换内容与联动刷新都按槽位对应。
 */
const HORIZONTAL = ['x', 'width', 'anchorX']
const SPATIAL = [...HORIZONTAL, 'y', 'height', 'radius', 'anchorY']
export function captureNativeTemplateContent(sequence: VideoEditSequence, clips: readonly VideoEditClip[]): VideoEditNativeTemplateContent {
  if (!clips.length || clips.some(clip => !['text', 'graphic'].includes(clip.kind) || clip.speed || clip.timeRemap || clip.reverse || clip.effects?.length || clip.follow)) throw new Error('原生模板只能由原速的文字或图形片段组成；含效果、变速或跟随时请先移除。')
  const start = Math.min(...clips.map(clip => clip.start)); const track = Math.min(...clips.map(clip => clip.track))
  return videoEditNativeTemplateContentSchema.parse({ width: sequence.width, height: sequence.height, fps: videoEditFps(sequence.frameRate), clips: [...clips].sort((a, b) => a.track - b.track || a.start - b.start).map(clip => ({ ...structuredClone(clip), start: clip.start - start, track: clip.track - track })) })
}
export function nativeTemplateTexts(clips: ReadonlyArray<Pick<VideoEditNativeTemplateClip, 'kind' | 'text' | 'graphic'>>): string[] {
  return clips.flatMap(clip => clip.kind === 'text' ? [clip.text] : (clip.graphic?.objects ?? []).filter(object => object.kind === 'text').map(object => String(object.parameters.text ?? '')))
}
export function nativeTemplateDurationSeconds(content: VideoEditNativeTemplateContent): number { return Math.max(...content.clips.map(clip => clip.start + clip.duration)) / content.fps }
/** 展开成目标序列里的片段快照（start/track 仍相对组合起点）。texts 按文字槽替换，未给的槽保留模板原文。 */
export function instantiateNativeTemplate(content: VideoEditNativeTemplateContent, sequence: VideoEditSequence, options: { durationSeconds?: number; texts?: readonly string[] } = {}): VideoEditNativeTemplateClip[] {
  const checked = videoEditNativeTemplateContentSchema.parse(content); const fps = videoEditFps(sequence.frameRate)
  const total = Math.max(...checked.clips.map(clip => clip.start + clip.duration))
  const frames = Math.max(2, Math.round((options.durationSeconds ?? total / checked.fps) * fps)); const factor = frames / total
  const sy = sequence.height / checked.height; let slot = 0
  const nextText = (): string | undefined => options.texts?.[slot++]
  return checked.clips.map(original => {
    const clip = structuredClone(original); clip.start = Math.round(original.start * factor); clip.duration = Math.max(1, Math.round((original.start + original.duration) * factor) - clip.start)
    if (clip.kind === 'text') { const value = nextText(); if (value !== undefined) clip.text = value; if (clip.textStyle) clip.textStyle = scaleVideoEditTextStyle(clip.textStyle, sy) }
    if (clip.curves) for (const [key, points] of Object.entries(clip.curves)) clip.curves[key as keyof typeof clip.curves] = [...new Map(points.map(point => { const next = { ...point, time: Math.min(clip.duration - 1, Math.round(point.time * factor)) }; return [next.time, next] })).values()]
    if (clip.graphic) {
      const gx = sequence.width / clip.graphic.width; const gy = sequence.height / clip.graphic.height
      clip.graphic.width = sequence.width; clip.graphic.height = sequence.height
      for (const object of clip.graphic.objects) {
        object.id = crypto.randomUUID()
        for (const key of SPATIAL) if (typeof object.parameters[key] === 'number') object.parameters[key] = (object.parameters[key] as number) * (HORIZONTAL.includes(key) ? gx : gy)
        if (object.kind === 'text') { const value = nextText(); if (value !== undefined) { object.parameters.text = value; if (object.curves) delete object.curves.text } if (object.textStyle) object.textStyle = scaleVideoEditTextStyle(object.textStyle, gy) }
        for (const [key, points] of Object.entries(object.curves ?? {})) for (const value of points) {
          value.id = crypto.randomUUID(); const time = value.sourceInUs + value.sourceRemainder.numerator / value.sourceRemainder.denominator
          value.sourceInUs = Math.round(time * factor * checked.fps / fps); value.sourceRemainder = { numerator: 0, denominator: 1 }
          if (typeof value.value === 'number' && SPATIAL.includes(key)) value.value *= HORIZONTAL.includes(key) ? gx : gy
        }
      }
      clip.graphic = videoEditGraphicSchema.parse(clip.graphic)
    }
    clip.sourceInUs = Math.round((original.sourceInUs + original.sourceRemainder.numerator / original.sourceRemainder.denominator) * factor * checked.fps / fps); clip.sourceRemainder = { numerator: 0, denominator: 1 }
    return videoEditNativeTemplateClipSchema.parse(clip)
  })
}
