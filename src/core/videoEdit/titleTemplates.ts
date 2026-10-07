import { z } from 'zod'
import { VIDEO_EDIT_TEXT_STYLE_DESCRIPTION, videoEditTextStyleSchema, scaleVideoEditTextStyle } from './text'
import { APP_ACCENT_HEX } from '../theme/colorTokens'
import { videoEditClipSchema, type VideoEditClip, type VideoEditSequence } from './document'
import { createVideoEditGraphic, videoEditGraphicSchema, type VideoEditGraphicObject } from './graphics'
import type { CodeColor } from './codeMaterial/contract'
import type { CodeMaterialKeyframe } from './codeMaterialAnimation'

export const TITLE_TEMPLATE_KINDS = ['lower_third', 'title_card', 'chapter', 'credits', 'counter', 'callout'] as const
export const titleTemplateParametersSchema = z.object({
  text: z.string().min(1).max(2000).default('标题'), subtitle: z.string().max(2000).default(''),
  color: z.string().regex(/^#[\da-f]{6}$/i).default(APP_ACCENT_HEX),
  textStyle: videoEditTextStyleSchema.describe(VIDEO_EDIT_TEXT_STYLE_DESCRIPTION + '标题参数空间量以1080p为基准，应用时按目标画幅换算。').default(videoEditTextStyleSchema.parse({ fontSize: 60 })),
  durationSeconds: z.number().finite().min(.5).max(60).default(5), entrance: z.enum(['left', 'up', 'fade']).default('left'),
  countFrom: z.number().int().min(-999999).max(999999).default(0), countTo: z.number().int().min(-999999).max(999999).default(100),
}).strict()
export type TitleTemplateParameters = z.infer<typeof titleTemplateParametersSchema>
/** Zod 4 applies inner defaults even through partial(): overrides must preserve omitted template fields. */
export const titleTemplateOverridesSchema = z.object({
  text: titleTemplateParametersSchema.shape.text.removeDefault().optional(), subtitle: titleTemplateParametersSchema.shape.subtitle.removeDefault().optional(),
  color: titleTemplateParametersSchema.shape.color.removeDefault().optional(), textStyle: titleTemplateParametersSchema.shape.textStyle.removeDefault().optional(), durationSeconds: titleTemplateParametersSchema.shape.durationSeconds.removeDefault().optional(),
  entrance: titleTemplateParametersSchema.shape.entrance.removeDefault().optional(), countFrom: titleTemplateParametersSchema.shape.countFrom.removeDefault().optional(), countTo: titleTemplateParametersSchema.shape.countTo.removeDefault().optional(),
}).strict()
// Only self-contained title data crosses the local-library boundary. No media, code, tracker or effect references.
const contentClipSchema = videoEditClipSchema.pick({ name: true, kind: true, track: true, start: true, duration: true, sourceInUs: true, sourceRemainder: true, x: true, y: true, scale: true, rotation: true, anchorX: true, anchorY: true, opacity: true, volume: true, text: true, textStyle: true, graphic: true, curves: true }).strip().superRefine((clip, ctx) => {
  if (clip.kind !== 'graphic' && clip.kind !== 'text' || clip.kind === 'graphic' && !clip.graphic) ctx.addIssue({ code: 'custom', message: '标题模板只接受文字或图形片段。' })
})
export const titleTemplateContentSchema = z.object({ width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192), fps: z.number().finite().positive().max(120), clips: z.array(contentClipSchema).min(1) }).strict()
const definition = z.object({ kind: z.enum(TITLE_TEMPLATE_KINDS).optional(), content: titleTemplateContentSchema.optional(), parameters: titleTemplateParametersSchema }).strict()
export const titleTemplateDefinitionSchema = definition.refine(value => Boolean(value.kind) !== Boolean(value.content), '请选择内置类型或提供文字图形组合。')
export const titleTemplateSchema = definition.extend({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200) }).refine(value => Boolean(value.kind) !== Boolean(value.content), '请选择内置类型或提供文字图形组合。')
export type TitleTemplate = z.infer<typeof titleTemplateSchema>
export const BUILTIN_TITLE_TEMPLATES: readonly TitleTemplate[] = TITLE_TEMPLATE_KINDS.map((kind, index) => titleTemplateSchema.parse({ id: `title:${kind}`, kind, name: ['下三分之一人名条', '标题卡', '章节标题', '片尾字幕滚动', '数字计数', '强调标注框'][index], parameters: { text: ['姓名', '影片标题', '第一章', '导演\n摄影\n剪辑', '累计', '重点'][index], subtitle: kind === 'lower_third' ? '身份 / 职务' : '', durationSeconds: kind === 'credits' ? 12 : 5 } }))
export function titleColor(hex: string): CodeColor { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).concat(1) as CodeColor }
function point(seconds: number, value: CodeMaterialKeyframe['value'], interpolation: CodeMaterialKeyframe['interpolation'] = 'ease'): CodeMaterialKeyframe { return { id: crypto.randomUUID(), sourceInUs: Math.round(seconds * 1e6), sourceRemainder: { numerator: 0, denominator: 1 }, value, interpolation } }
function builtinGraphic(template: TitleTemplate, p: TitleTemplateParameters, width: number, height: number, duration: number): ReturnType<typeof videoEditGraphicSchema.parse> {
  const objects: VideoEditGraphicObject[] = []
  const object = (kind: 'text' | 'rect', parameters: VideoEditGraphicObject['parameters']): VideoEditGraphicObject => { const value = createVideoEditGraphic(kind, width, height).objects[0]; Object.assign(value.parameters, parameters); objects.push(value); return value }
  const credits = template.kind === 'credits'; const lower = template.kind === 'lower_third'; const callout = template.kind === 'callout'
  const left = lower ? width * .08 : width * .2; const top = lower ? height * .75 : height * .38
  const boxWidth = lower ? width * .5 : width * .6; const boxHeight = lower ? height * .15 : height * .22
  if (!credits && template.kind !== 'counter') {
    if (callout) {
      const line = height * .008
      for (const geometry of [{ x: left, y: top, width: boxWidth, height: line }, { x: left, y: top + boxHeight, width: boxWidth, height: line }, { x: left, y: top, width: line, height: boxHeight }, { x: left + boxWidth, y: top, width: line, height: boxHeight }]) object('rect', { ...geometry, fill: titleColor(p.color) })
    } else object('rect', { x: left, y: top, width: boxWidth, height: boxHeight, radius: height * .01, fill: titleColor(p.color) })
  }
  const lines = credits ? p.text.split('\n') : [p.text, ...(p.subtitle ? [p.subtitle] : [])]
  lines.forEach((text, index) => {
    const value = object('text', { text, x: lower ? left + width * .02 : width / 2, y: credits ? height + index * height * .1 : top + boxHeight * (index ? .72 : p.subtitle ? .3 : .5) })
    value.textStyle = { ...scaleVideoEditTextStyle(p.textStyle, height / 1080 * (index && !credits ? .64 : 1)), align: lower ? 'left' : p.textStyle.align }
    if (credits) value.curves = { y: [point(0, value.parameters.y as number, 'linear'), point(duration, -height * .15 - (lines.length - index) * height * .1, 'linear')] }
    if (template.kind === 'counter' && index === 0) value.curves = { text: Array.from({ length: 101 }, (_, i) => point(duration * i / 100, `${p.text} ${Math.round(p.countFrom + (p.countTo - p.countFrom) * i / 100)}`, 'hold')) }
  })
  const edge = Math.min(.6, duration / 4)
  for (const value of objects) {
    value.curves = { ...value.curves, opacity: [point(0, 0), point(edge, 1), point(duration - edge, 1), point(duration, 0)] }
    if (!credits && p.entrance !== 'fade') {
      const key = p.entrance === 'left' ? 'x' : 'y'; const home = value.parameters[key] as number; const distance = p.entrance === 'left' ? width * .2 : height * .15
      value.curves[key] = [point(0, home - distance), point(edge, home), point(duration - edge, home), point(duration, home + distance)]
    }
  }
  return videoEditGraphicSchema.parse({ width, height, objects })
}
export function captureTitleTemplate(name: string, sequence: VideoEditSequence, clips: readonly VideoEditClip[]): TitleTemplate {
  if (!clips.length || clips.some(clip => !['text', 'graphic'].includes(clip.kind) || clip.speed || clip.reverse || clip.effects?.length || clip.follow)) throw new Error('请选择原速文字或图形片段；含效果或跟随时请先移除这些绑定。')
  const start = Math.min(...clips.map(clip => clip.start)); const track = Math.min(...clips.map(clip => clip.track)); const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
  const durationSeconds = (Math.max(...clips.map(clip => clip.start + clip.duration)) - start) / fps
  const style = clips.find(clip => clip.kind === 'text')?.textStyle ?? clips.flatMap(clip => clip.graphic?.objects ?? []).find(object => object.kind === 'text')?.textStyle
  return titleTemplateSchema.parse({ id: crypto.randomUUID(), name, content: { width: sequence.width, height: sequence.height, fps, clips: clips.map(clip => ({ ...structuredClone(clip), start: clip.start - start, track: clip.track - track })) }, parameters: { durationSeconds, textStyle: style ? scaleVideoEditTextStyle(style, 1080 / sequence.height) : undefined, text: clips.find(clip => clip.kind === 'text')?.text ?? (clips.flatMap(clip => clip.graphic?.objects ?? []).find(object => object.kind === 'text')?.parameters.text || '标题') } })
}
/** Regenerate object IDs and retime rational source curves; the library never owns live instances. */
export function instantiateTitleTemplate(template: TitleTemplate, parameters: Partial<TitleTemplateParameters>, sequence: VideoEditSequence): Array<z.infer<typeof contentClipSchema>> {
  const checked = titleTemplateSchema.parse(template); const p = titleTemplateParametersSchema.parse({ ...checked.parameters, ...parameters }); const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
  const frames = Math.max(2, Math.round(p.durationSeconds * fps)); const seconds = (frames - 1) / fps
  if (checked.kind) return [{ name: checked.name, kind: 'graphic', graphic: builtinGraphic(checked, p, sequence.width, sequence.height, seconds), track: 0, start: 0, duration: frames, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }]
  const content = checked.content!; const total = Math.max(...content.clips.map(clip => clip.start + clip.duration)); const factor = frames / total
  const sy = sequence.height / content.height; let textIndex = 0
  const textValue = (): string | undefined => { const index = textIndex++; return index === 0 ? parameters.text : index === 1 ? parameters.subtitle : undefined }
  return content.clips.map(original => {
    const clip = structuredClone(original); clip.start = Math.round(original.start * factor); clip.duration = Math.max(1, Math.round((original.start + original.duration) * factor) - clip.start)
    if (clip.kind === 'text') { const value = textValue(); if (value !== undefined) clip.text = value }
    if (clip.kind === 'text') clip.textStyle = scaleVideoEditTextStyle(parameters.textStyle ?? clip.textStyle ?? p.textStyle, parameters.textStyle ? sequence.height / 1080 : sy)
    if (clip.curves) for (const [key, points] of Object.entries(clip.curves)) clip.curves[key as keyof typeof clip.curves] = [...new Map(points.map(point => { const next = { ...point, time: Math.min(clip.duration - 1, Math.round(point.time * factor)) }; return [next.time, next] })).values()]
    if (clip.graphic) {
      const gx = sequence.width / clip.graphic.width; const gy = sequence.height / clip.graphic.height
      clip.graphic.width = sequence.width; clip.graphic.height = sequence.height
      for (const object of clip.graphic.objects) {
        object.id = crypto.randomUUID()
        for (const key of ['x', 'width', 'anchorX', 'y', 'height', 'radius', 'anchorY']) if (typeof object.parameters[key] === 'number') object.parameters[key] = (object.parameters[key] as number) * (['x', 'width', 'anchorX'].includes(key) ? gx : gy)
        if (object.kind === 'text') { const value = textValue(); if (value !== undefined) { object.parameters.text = value; if (object.curves) delete object.curves.text } }
        if (object.kind === 'text') object.textStyle = scaleVideoEditTextStyle(parameters.textStyle ?? object.textStyle ?? p.textStyle, parameters.textStyle ? sequence.height / 1080 : gy)
        if (parameters.color && object.kind !== 'text') { object.parameters.fill = titleColor(p.color); if (object.curves) delete object.curves.fill }
        for (const [key, points] of Object.entries(object.curves ?? {})) for (const value of points) {
          value.id = crypto.randomUUID(); const time = value.sourceInUs + value.sourceRemainder.numerator / value.sourceRemainder.denominator
          value.sourceInUs = Math.round(time * factor * content.fps / fps); value.sourceRemainder = { numerator: 0, denominator: 1 }
          if (typeof value.value === 'number' && ['x', 'width', 'anchorX', 'y', 'height', 'radius', 'anchorY'].includes(key)) value.value *= ['x', 'width', 'anchorX'].includes(key) ? gx : gy
        }
      }
      clip.graphic = videoEditGraphicSchema.parse(clip.graphic)
    }
    clip.sourceInUs = Math.round((original.sourceInUs + original.sourceRemainder.numerator / original.sourceRemainder.denominator) * factor * content.fps / fps); clip.sourceRemainder = { numerator: 0, denominator: 1 }
    return contentClipSchema.parse(clip)
  })
}
