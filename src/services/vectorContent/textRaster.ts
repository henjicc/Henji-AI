import { layoutText, textAdvances, textCharacters, textWidth, textFont, type TextContent, type TextLayout } from '@/core/imaging/vectorContent/text'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { paintVectorAppearance } from './appearance'

type Context = OffscreenCanvasRenderingContext2D
/** The native glyph operation is shared by rich text and both code-material generations. */
export function paintNativeText(context: Context, text: string, x: number, y: number, mode: 'fill' | 'stroke' = 'fill'): void {
  if (mode === 'stroke') context.strokeText(text, x, y)
  else context.fillText(text, x, y)
}
/** Native shaping for whole runs, with individual advances only when typography changes glyphs. */
export function paintText(context: Context, clip: TextContent, width: number, height: number, origin = { x: width / 2, y: height / 2 }, prepared?: TextLayout, resolution = 1): void {
  const measure = (text: string, font: string): number => { context.font = font; context.fontKerning = (clip.textStyle?.kerning ?? 'auto') === 'auto' ? 'normal' : 'none'; return context.measureText(text).width }
  const layout = prepared ? { ...prepared } : layoutText(clip, { width, height }, measure)
  layout.left += origin.x - width / 2; layout.top += origin.y - height / 2; layout.contentTop += origin.y - height / 2
  const { style, lines, lineHeight } = layout
  const draw = (target: Context, stroke = 0): void => {
    target.save(); target.direction = context.direction; target.textBaseline = 'middle'; target.textAlign = 'left'; target.lineJoin = 'round'; target.fontKerning = style.kerning === 'auto' ? 'normal' : 'none'
    target.fillStyle = WHITE_HEX; target.strokeStyle = WHITE_HEX; target.lineWidth = stroke * 2
    lines.forEach((line, row) => {
      const characters = textCharacters(line, style); const advances = textAdvances(line, style, measure)
      const naturalWidth = textWidth(line, style, measure)
      const justify = style.align.startsWith('justify') && (style.align === 'justify-all' || row < lines.length - 1)
      const spaces = characters.filter(character => /\s/u.test(character.text)).length
      const slots = spaces || Math.max(0, characters.length - 1)
      const extra = justify && slots ? Math.max(0, layout.width - naturalWidth) / slots : 0
      const offset = justify ? 0 : style.align === 'center' || style.align === 'justify-center' ? (layout.width - naturalWidth) / 2 : style.align === 'right' || style.align === 'justify-right' ? layout.width - naturalWidth : 0
      let x = layout.left + offset
      const y = layout.contentTop + (row + .5) * lineHeight - style.baselineShift + (style.superscript ? -style.fontSize * .35 : style.subscript ? style.fontSize * .2 : 0)
      const custom = style.smallCaps || style.superscript || style.subscript || style.tracking !== 0 || style.kerning !== 'auto' || style.tsume !== 0 || extra > 0
      const paint = (text: string, size: number, at: number): void => {
        target.font = textFont(style, size); target.save()
        if (style.fauxItalic) { target.translate(at, y); target.transform(1, 0, -.2, 1, 0, 0); at = 0 }
        const baseline = style.fauxItalic ? 0 : y
        if (stroke) { target.lineWidth = stroke * 2 + (style.fauxBold ? Math.max(.5, size / 30) : 0); paintNativeText(target, text, at, baseline, 'stroke') }
        else { paintNativeText(target, text, at, baseline); if (style.fauxBold) { target.lineWidth = Math.max(.5, size / 30); paintNativeText(target, text, at, baseline, 'stroke') } }
        target.restore()
      }
      if (!custom) paint(style.allCaps ? line.toLocaleUpperCase() : line, style.fontSize, x)
      else characters.forEach((character, index) => { paint(character.text, character.size, x); x += advances[index] + (spaces ? /\s/u.test(character.text) ? extra : 0 : index < characters.length - 1 ? extra : 0) })
      if (style.underline) target.fillRect(layout.left + offset, y + style.fontSize * .45, justify ? layout.width : naturalWidth, Math.max(1, style.fontSize / 20))
    }); target.restore()
  }
  context.save()
  if (style.background.enabled) {
    const { padding, radius, color, opacity } = style.background
    context.globalAlpha = opacity; context.fillStyle = color; context.beginPath()
    context.roundRect(layout.left - padding, layout.top - padding, layout.width + 2 * padding, layout.height + 2 * padding, radius); context.fill(); context.globalAlpha = 1
  }
  paintVectorAppearance(context, width, height, resolution, style, target => draw(target), (target, radius) => draw(target, radius))
  context.restore()
}

/** Integer power-of-two tiers keep continuous motion out of raster identity, without undersampling magnified text. */
export function textResolution(scale: number): number { return 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(1, scale)) - 1e-10)) }
export interface TextRaster { canvas: OffscreenCanvas; x: number; y: number; width: number; height: number }
/** Bounds are relative to the text origin, including glyph overhangs, shifted baselines and all appearance layers. */
export function rasterizeText(clip: TextContent, frame: { width: number; height: number }, resolution = 1): TextRaster {
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!
  let overhang = 0; let ascent = 0; let descent = 0
  const measure = (text: string, font: string): number => {
    probe.font = font; probe.textBaseline = 'middle'; probe.fontKerning = (clip.textStyle?.kerning ?? 'auto') === 'auto' ? 'normal' : 'none'
    const metrics = probe.measureText(text)
    overhang = Math.max(overhang, metrics.actualBoundingBoxLeft || 0, (metrics.actualBoundingBoxRight || metrics.width) - metrics.width)
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent || 0); descent = Math.max(descent, metrics.actualBoundingBoxDescent || 0)
    return metrics.width
  }
  const layout = layoutText(clip, frame, measure)
  const { style } = layout
  // Negative tracking and a paragraph narrower than a single glyph can paint outside the layout box.
  let left = layout.left; let right = layout.left + layout.width
  layout.lines.forEach((line, row) => {
    const characters = textCharacters(line, style); const advances = textAdvances(line, style, measure)
    const natural = textWidth(line, style, measure)
    const justify = style.align.startsWith('justify') && (style.align === 'justify-all' || row < layout.lines.length - 1)
    const spaces = characters.filter(character => /\s/u.test(character.text)).length; const slots = spaces || Math.max(0, characters.length - 1)
    const extra = justify && slots ? Math.max(0, layout.width - natural) / slots : 0
    let x = layout.left + (justify ? 0 : style.align === 'center' || style.align === 'justify-center' ? (layout.width - natural) / 2 : style.align === 'right' || style.align === 'justify-right' ? layout.width - natural : 0)
    for (const [index, character] of characters.entries()) {
      left = Math.min(left, x); right = Math.max(right, x + measure(character.text, textFont(style, character.size)))
      x += advances[index] + (spaces ? /\s/u.test(character.text) ? extra : 0 : index < characters.length - 1 ? extra : 0)
    }
  })
  const glyphPad = Math.max(style.fontSize, overhang, ascent, descent) + (style.fauxItalic ? style.fontSize * .4 : 0)
  const strokePad = Math.max(0, ...style.strokes.filter(stroke => stroke.enabled).map(stroke => stroke.position === 'inside' ? 0 : stroke.width))
  const shadowPad = Math.max(0, ...style.shadows.filter(shadow => shadow.enabled && shadow.opacity).map(shadow => shadow.distance + shadow.size + shadow.blur * 4))
  const pad = Math.ceil(Math.max(strokePad + shadowPad, style.background.enabled ? style.background.padding : 0) + glyphPad + 2)
  const shift = -style.baselineShift + (style.superscript ? -style.fontSize * .35 : style.subscript ? style.fontSize * .2 : 0)
  const x = Math.floor(left - frame.width / 2 - pad)
  const y = Math.floor(Math.min(layout.top, layout.contentTop + shift) - frame.height / 2 - pad)
  const width = Math.max(1, Math.ceil(right - frame.width / 2 - x + pad))
  const height = Math.max(1, Math.ceil(Math.max(layout.top + layout.height, layout.contentTop + layout.lines.length * layout.lineHeight + shift) - frame.height / 2 - y + pad))
  // Match the existing GPU upload limit before allocating the three temporary raster surfaces.
  if (width * resolution > 8192 || height * resolution > 8192) throw new Error('文字栅格超过 GPU 单张纹理 8192 像素技术范围。')
  const canvas = new OffscreenCanvas(Math.ceil(width * resolution), Math.ceil(height * resolution)); const context = canvas.getContext('2d')!
  if (resolution !== 1) context.scale(resolution, resolution)
  const local = { ...layout, left: layout.left - frame.width / 2 - x, top: layout.top - frame.height / 2 - y, contentTop: layout.contentTop - frame.height / 2 - y }
  paintText(context, clip, width, height, { x: width / 2, y: height / 2 }, local, resolution)
  return { canvas, x, y, width, height }
}

export function paintMeasuredText(context:OffscreenCanvasRenderingContext2D,layout:import('@/core/imaging/vectorContent/codeTextLayout').CodeTextLayout,box:{x:number;y:number;width:number},lineHeight:number,align:'left'|'center'|'right',customSpacing:boolean,strokeWidth=0):void {
  context.font=layout.font;context.textBaseline='alphabetic';context.textAlign='left';
  const offset=(row:number)=>align==='center'?(box.width-(layout.lineWidths?.[row]??layout.width))/2:align==='right'?box.width-(layout.lineWidths?.[row]??layout.width):0;
  const paint=(text:string,x:number,y:number)=>{if(strokeWidth)paintNativeText(context,text,x,y,'stroke');paintNativeText(context,text,x,y)};
  if(customSpacing)for(const glyph of layout.glyphs)paint(glyph.text,box.x+glyph.x+offset(Math.round(glyph.y/lineHeight)),box.y+glyph.y+(layout.baselineOffset??lineHeight/2));
  else layout.lines.forEach((line,row)=>paint(line,box.x+offset(row),box.y+row*lineHeight+(layout.baselineOffset??lineHeight/2)));
}
