import { z } from 'zod'
import { createVideoEditGraphic, type VideoEditGraphic } from './graphics'
import { defaultVideoEditTextStyle, scaleVideoEditTextStyle, videoEditTextStyleSchema } from './text'
import { BLACK_HEX } from '../theme/colorTokens'
import { styleColorHex, styleKitTextDefaults, type StyleKit } from './styleKit'

/** Typography uses the same schema; subtitles add only their 1080p reference-frame placement. */
export const videoEditSubtitleStyleSchema = videoEditTextStyleSchema.extend({
  verticalAlign: videoEditTextStyleSchema.shape.verticalAlign.default('bottom'),
  strokes: videoEditTextStyleSchema.shape.strokes.default([{ enabled: true, color: BLACK_HEX, width: 2, position: 'outside' }]),
  fontSize: videoEditTextStyleSchema.shape.fontSize.default(48),
  bottomMargin: z.number().finite().min(0).max(1).default(.1).describe('底部安全区占画幅高度比例，0–1；字号和空间样式按1080p参考画幅缩放。'),
}).strict()
export type VideoEditSubtitleStyle = z.infer<typeof videoEditSubtitleStyleSchema>
const plain = videoEditSubtitleStyleSchema.parse({ strokes: [{ color: BLACK_HEX, width: 2, position: 'outside' }] })
export const VIDEO_EDIT_SUBTITLE_PRESETS: ReadonlyArray<{ id: string; name: string; style: VideoEditSubtitleStyle }> = [
  { id: 'builtin:plain', name: '简洁白字黑边', style: plain },
  { id: 'builtin:box', name: '底框', style: videoEditSubtitleStyleSchema.parse({ background: { enabled: true } }) },
  { id: 'builtin:variety', name: '综艺大字', style: { ...plain, fontSize: 80, bottomMargin: .15 } },
  { id: 'builtin:bilingual', name: '双语上下行', style: { ...plain, fontSize: 40, bottomMargin: .12 } },
]
export function subtitleGraphic(text: string, width: number, height: number, input: VideoEditSubtitleStyle): VideoEditGraphic {
  const checked = videoEditSubtitleStyleSchema.parse(input)
  const { bottomMargin, ...typography } = checked
  const style = scaleVideoEditTextStyle(typography, height / 1080)
  const graphic = createVideoEditGraphic('text', width, height)
  const object = graphic.objects[0]
  object.id = 'subtitle'; object.name = '字幕文字'
  object.parameters = { ...object.parameters, text, x: width / 2, y: height * (1 - bottomMargin) }
  object.textStyle = { ...defaultVideoEditTextStyle(height), ...style }
  return graphic
}
/**
 * Subtitle style following a style kit, in the 1080p reference frame. The kit's caption treatment decides the packaging
 * (outlined ink, a surface plate, or a thick pop sticker); fonts and colours always come from its tokens.
 */
export function styleKitSubtitleStyle(kit: StyleKit): VideoEditSubtitleStyle {
  const tokens = kit.tokens; const body = styleKitTextDefaults(kit, 1080, 'body'); const fontSize = Math.round(body.fontSize * tokens.typeScale.ratio)
  const margin = Math.max(.05, tokens.layout.safeMargin)
  switch (kit.caption.treatment) {
    case 'plate': return videoEditSubtitleStyleSchema.parse({ fontFamily: body.fontFamily, fontWeight: Math.max(500, body.fontWeight), fontSize, leading: fontSize * 1.3, fill: body.fill, strokes: [],
      background: { enabled: true, color: styleColorHex(tokens.palette.surface), opacity: .82, padding: Math.round(fontSize * .4), radius: Math.round(tokens.shape.radius * 1080) }, bottomMargin: margin })
    case 'pop': {
      const display = styleKitTextDefaults(kit, 1080, 'display'); const size = Math.round(fontSize * 1.3)
      return videoEditSubtitleStyleSchema.parse({ fontFamily: display.fontFamily, fontWeight: display.fontWeight, fontSize: size, leading: size * 1.2, fill: { enabled: true, color: styleColorHex(tokens.palette.fg) },
        strokes: [{ enabled: true, color: styleColorHex(tokens.palette.bg), width: Math.max(4, Math.round(size * .12)), position: 'outside' }],
        shadows: [{ enabled: true, color: styleColorHex(tokens.palette.accent), opacity: 1, angle: 45, distance: Math.round(size * .1), size: Math.round(size * .1), blur: 0 }], bottomMargin: margin + .03 })
    }
    default: return videoEditSubtitleStyleSchema.parse({ fontFamily: body.fontFamily, fontWeight: body.fontWeight, fontSize, leading: fontSize * 1.3, fill: body.fill, strokes: [{ enabled: true, color: styleColorHex(tokens.palette.bg), width: 2, position: 'outside' }],
      shadows: [{ enabled: true, color: styleColorHex(tokens.palette.bg), opacity: .5, angle: 90, distance: 2, size: 0, blur: 8 }], bottomMargin: margin })
  }
}
