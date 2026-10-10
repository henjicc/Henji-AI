import {BLACK_HEX} from '../theme/colorTokens'
import {textStyleSchema} from '../imaging/vectorContent/text'
import { videoEditClipToFrame, videoEditFrameToClip, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'
import type { TextLayout as VideoEditTextLayout } from '../imaging/vectorContent/text'
export { defaultTextStyle as defaultVideoEditTextStyle, textFont as videoEditTextFont, textCharacters as videoEditTextCharacters, textAdvances as videoEditTextAdvances, textWidth as videoEditTextWidth, layoutText as layoutVideoEditText, scaleTextStyle as scaleVideoEditTextStyle } from '../imaging/vectorContent/text'
export type { TextStyle as VideoEditTextStyle, TextLayout as VideoEditTextLayout, TextContent as VideoEditTextContent } from '../imaging/vectorContent/text'

export function videoEditTextPoint(client: { x: number; y: number }, rect: { left: number; top: number; width: number; height: number }, clamp = true): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) throw new Error('节目画面尚未就绪。')
  const x = (client.x - rect.left) / rect.width; const y = (client.y - rect.top) / rect.height
  return clamp ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : { x, y }
}

/** Uniform motion scale, with the opposite corner fixed in sequence space even on rotated titles. */
export function resizeVideoEditText(clip: VideoEditClipPlacement, frame: VideoEditSize, layout: VideoEditTextLayout, corner: number, point: { x: number; y: number }): Pick<VideoEditClipPlacement, 'x' | 'y' | 'scale'> {
  const corners = [[layout.left, layout.top], [layout.left + layout.width, layout.top], [layout.left + layout.width, layout.top + layout.height], [layout.left, layout.top + layout.height]]
  const opposite = corners[(corner + 2) % 4]; const moving = corners[corner]
  const local = videoEditFrameToClip(clip, frame, frame, point.x, point.y)
  const dx = moving[0] - opposite[0]; const dy = moving[1] - opposite[1]
  const ratio = ((local.u * frame.width - opposite[0]) * dx + (local.v * frame.height - opposite[1]) * dy) / (dx * dx + dy * dy)
  const scale = Math.max(.01, Math.min(4, clip.scale * ratio))
  const oldAnchor = videoEditClipToFrame(clip, frame, frame, opposite[0] / frame.width, opposite[1] / frame.height)
  const nextAnchor = videoEditClipToFrame({ ...clip, scale }, frame, frame, opposite[0] / frame.width, opposite[1] / frame.height)
  return { scale, x: Math.max(-2, Math.min(2, clip.x + oldAnchor.x - nextAnchor.x)), y: Math.max(-2, Math.min(2, clip.y + oldAnchor.y - nextAnchor.y)) }
}

// Existing video texture contract stays host-local; tiled image content has no 8K logical-size cap.
const spatial=(schema:import('zod').z.ZodNumber)=>schema.max(8192)
export const videoEditTextStyleSchema=textStyleSchema.extend({
  fontSize:spatial(textStyleSchema.shape.fontSize.unwrap()).default(72).describe('序列像素；1–8192，与最大画幅边长一致。'),
  leading:spatial(textStyleSchema.shape.leading.unwrap()).default(0).describe('行距，序列像素；0 自动（字号的1.25倍），最大8192。'),baselineShift:textStyleSchema.shape.baselineShift.unwrap().min(-8192).max(8192).default(0).describe(textStyleSchema.shape.baselineShift.description ?? ''),
  strokes:textStyleSchema.shape.strokes.unwrap().element.extend({width:spatial(textStyleSchema.shape.strokes.unwrap().element.shape.width)}).array().default([]).describe(textStyleSchema.shape.strokes.description??''),
  background:textStyleSchema.shape.background.unwrap().extend({padding:spatial(textStyleSchema.shape.background.unwrap().shape.padding.unwrap()).default(12),radius:spatial(textStyleSchema.shape.background.unwrap().shape.radius.unwrap()).default(0)}).default({enabled:false,color:BLACK_HEX,opacity:.7,padding:12,radius:0}),
  shadows:textStyleSchema.shape.shadows.unwrap().element.extend({distance:spatial(textStyleSchema.shape.shadows.unwrap().element.shape.distance),size:spatial(textStyleSchema.shape.shadows.unwrap().element.shape.size),blur:spatial(textStyleSchema.shape.shadows.unwrap().element.shape.blur)}).array().default([]).describe(textStyleSchema.shape.shadows.description??''),
})

/** Video-host description retains its existing single-texture limits. */
export const VIDEO_EDIT_TEXT_STYLE_DESCRIPTION = '共享样式整体替换，先读后改。fontFamily家族/完整字形名（查询font）；fontWeight 1–1000；fontStyle normal/italic/oblique；fontSize像素1–8192。布尔：fauxBold仿粗体、fauxItalic仿斜体、allCaps全部大写、smallCaps小型大写、superscript上标、subscript下标、underline下划线（上下标同时开则上标优先）。align左/中/右及justify系列两端对齐（末行左/中/右/全部，枚举见schema）；verticalAlign top/middle/bottom。tracking字距、kerning字偶距：千分之一em -1000–10000，kerning还可auto。leading行距像素0–8192（0自动1.25倍字号）；baselineShift基线像素±8192（正数上移）；tsume压缩百分比0–100。fill {enabled,color}；strokes [{enabled,color,width,position:outside|inside|center}]，width像素0–8192；background {enabled,color,opacity,padding,radius}，opacity 0–1、padding/radius像素0–8192；shadows [{enabled,color,opacity,angle,distance,size,blur}]，opacity 0–1、angle顺时针±360度（0向右）、distance/size/blur像素0–8192。描边/阴影层数不限，颜色六位十六进制，enabled布尔。boxWidth/boxHeight文字框占画幅比例0–1（0自动）。完整字形名使用文件内字形，选择时400/normal避免重复合成。'
