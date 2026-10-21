import { z } from 'zod'
import { VIDEO_EDIT_TEXT_STYLE_DESCRIPTION, videoEditTextStyleSchema, scaleVideoEditTextStyle } from './text'
import { APP_ACCENT_HEX } from '../theme/colorTokens'
import { createVideoEditGraphic, videoEditGraphicSchema, type VideoEditGraphic, type VideoEditGraphicObject } from './graphics'
import type { CodeColor } from './codeMaterial/contract'
import type { CodeMaterialKeyframe } from './codeMaterialAnimation'

/**
 * 六种程序化标题图形（人名条、标题卡、章节、片尾滚动、计数、强调框）。不再是可选模板：录屏成片的步骤标题用人名条，
 * 旧版本机标题模板与预设文件里的“内置类型”条目导入时用它展开成原生模板内容。
 */
export const TITLE_GRAPHIC_KINDS = ['lower_third', 'title_card', 'chapter', 'credits', 'counter', 'callout'] as const
export type TitleGraphicKind = typeof TITLE_GRAPHIC_KINDS[number]
export const titleGraphicParametersSchema = z.object({
  text: z.string().min(1).max(2000).default('标题'), subtitle: z.string().max(2000).default(''),
  color: z.string().regex(/^#[\da-f]{6}$/i).default(APP_ACCENT_HEX),
  textStyle: videoEditTextStyleSchema.describe(VIDEO_EDIT_TEXT_STYLE_DESCRIPTION + '标题参数空间量以1080p为基准，应用时按目标画幅换算。').default(videoEditTextStyleSchema.parse({ fontSize: 60 })),
  durationSeconds: z.number().finite().min(.5).max(60).default(5), entrance: z.enum(['left', 'up', 'fade']).default('left'),
  countFrom: z.number().int().min(-999999).max(999999).default(0), countTo: z.number().int().min(-999999).max(999999).default(100),
}).strict()
export type TitleGraphicParameters = z.infer<typeof titleGraphicParametersSchema>
export function titleColor(hex: string): CodeColor { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).concat(1) as CodeColor }
function point(seconds: number, value: CodeMaterialKeyframe['value'], interpolation: CodeMaterialKeyframe['interpolation'] = 'ease'): CodeMaterialKeyframe { return { id: crypto.randomUUID(), sourceInUs: Math.round(seconds * 1e6), sourceRemainder: { numerator: 0, denominator: 1 }, value, interpolation } }
/** 按画幅与秒数展开一个标题图形；入场、离场与计数都是图形对象的关键帧。 */
export function titleGraphic(kind: TitleGraphicKind, parameters: Partial<TitleGraphicParameters>, width: number, height: number, duration: number): VideoEditGraphic {
  const p = titleGraphicParametersSchema.parse(parameters)
  const objects: VideoEditGraphicObject[] = []
  const object = (type: 'text' | 'rect', values: VideoEditGraphicObject['parameters']): VideoEditGraphicObject => { const value = createVideoEditGraphic(type, width, height).objects[0]; Object.assign(value.parameters, values); objects.push(value); return value }
  const credits = kind === 'credits'; const lower = kind === 'lower_third'; const callout = kind === 'callout'
  const left = lower ? width * .08 : width * .2; const top = lower ? height * .75 : height * .38
  const boxWidth = lower ? width * .5 : width * .6; const boxHeight = lower ? height * .15 : height * .22
  if (!credits && kind !== 'counter') {
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
    if (kind === 'counter' && index === 0) value.curves = { text: Array.from({ length: 101 }, (_, i) => point(duration * i / 100, `${p.text} ${Math.round(p.countFrom + (p.countTo - p.countFrom) * i / 100)}`, 'hold')) }
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
