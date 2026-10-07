import { layoutVideoEditText, videoEditTextAdvances, videoEditTextCharacters, videoEditTextWidth, videoEditTextFont, type VideoEditTextContent } from '@/core/videoEdit/text'
import { WHITE_HEX } from '@/core/theme/colorTokens'

type Context = OffscreenCanvasRenderingContext2D
/** Native shaping for whole runs, with individual advances only when typography changes glyphs. */
export function paintVideoEditText(context: Context, clip: VideoEditTextContent, width: number, height: number, origin = { x: width / 2, y: height / 2 }): void {
  const measure = (text: string, font: string): number => { context.font = font; context.fontKerning = (clip.textStyle?.kerning ?? 'auto') === 'auto' ? 'normal' : 'none'; return context.measureText(text).width }
  const layout = layoutVideoEditText(clip, { width, height }, measure)
  layout.left += origin.x - width / 2; layout.top += origin.y - height / 2; layout.contentTop += origin.y - height / 2
  const { style, lines, lineHeight } = layout
  const glyphs = new OffscreenCanvas(width, height); const mask = glyphs.getContext('2d')!
  const layer = new OffscreenCanvas(width, height); const ink = layer.getContext('2d')!
  const draw = (target: Context, stroke = 0): void => {
    target.save(); target.textBaseline = 'middle'; target.textAlign = 'left'; target.lineJoin = 'round'; target.fontKerning = style.kerning === 'auto' ? 'normal' : 'none'
    target.fillStyle = WHITE_HEX; target.strokeStyle = WHITE_HEX; target.lineWidth = stroke * 2
    lines.forEach((line, row) => {
      const characters = videoEditTextCharacters(line, style); const advances = videoEditTextAdvances(line, style, measure)
      const naturalWidth = videoEditTextWidth(line, style, measure)
      const justify = style.align.startsWith('justify') && (style.align === 'justify-all' || row < lines.length - 1)
      const spaces = characters.filter(character => /\s/u.test(character.text)).length
      const slots = spaces || Math.max(0, characters.length - 1)
      const extra = justify && slots ? Math.max(0, layout.width - naturalWidth) / slots : 0
      const offset = justify ? 0 : style.align === 'center' || style.align === 'justify-center' ? (layout.width - naturalWidth) / 2 : style.align === 'right' || style.align === 'justify-right' ? layout.width - naturalWidth : 0
      let x = layout.left + offset
      const y = layout.contentTop + (row + .5) * lineHeight - style.baselineShift + (style.superscript ? -style.fontSize * .35 : style.subscript ? style.fontSize * .2 : 0)
      const custom = style.smallCaps || style.superscript || style.subscript || style.tracking !== 0 || style.kerning !== 'auto' || style.tsume !== 0 || extra > 0
      const paint = (text: string, size: number, at: number): void => {
        target.font = videoEditTextFont(style, size); target.save()
        if (style.fauxItalic) { target.translate(at, y); target.transform(1, 0, -.2, 1, 0, 0); at = 0 }
        const baseline = style.fauxItalic ? 0 : y
        if (stroke) { target.lineWidth = stroke * 2 + (style.fauxBold ? Math.max(.5, size / 30) : 0); target.strokeText(text, at, baseline) }
        else { target.fillText(text, at, baseline); if (style.fauxBold) { target.lineWidth = Math.max(.5, size / 30); target.strokeText(text, at, baseline) } }
        target.restore()
      }
      if (!custom) paint(style.allCaps ? line.toLocaleUpperCase() : line, style.fontSize, x)
      else characters.forEach((character, index) => { paint(character.text, character.size, x); x += advances[index] + (spaces ? /\s/u.test(character.text) ? extra : 0 : index < characters.length - 1 ? extra : 0) })
      if (style.underline) target.fillRect(layout.left + offset, y + style.fontSize * .45, justify ? layout.width : naturalWidth, Math.max(1, style.fontSize / 20))
    }); target.restore()
  }
  draw(mask)
  const reset = (): void => { ink.clearRect(0, 0, width, height); ink.globalCompositeOperation = 'source-over'; ink.globalAlpha = 1; ink.filter = 'none' }
  const tint = (color: string): void => { ink.globalCompositeOperation = 'source-in'; ink.fillStyle = color; ink.fillRect(0, 0, width, height); ink.globalCompositeOperation = 'source-over' }
  context.save()
  if (style.background.enabled) {
    const { padding, radius, color, opacity } = style.background
    context.globalAlpha = opacity; context.fillStyle = color; context.beginPath()
    context.roundRect(layout.left - padding, layout.top - padding, layout.width + 2 * padding, layout.height + 2 * padding, radius); context.fill(); context.globalAlpha = 1
  }
  for (const shadow of style.shadows) if (shadow.enabled && shadow.opacity) {
    reset(); draw(ink); if (shadow.size) draw(ink, shadow.size); tint(shadow.color)
    const radians = shadow.angle * Math.PI / 180
    context.globalAlpha = shadow.opacity; context.filter = `blur(${shadow.blur}px)`
    context.drawImage(layer, Math.cos(radians) * shadow.distance, Math.sin(radians) * shadow.distance)
    context.filter = 'none'; context.globalAlpha = 1
  }
  if (style.fill.enabled) { reset(); ink.drawImage(glyphs, 0, 0); tint(style.fill.color); context.drawImage(layer, 0, 0) }
  // Widest outline first; masks preserve true interior/exterior boundaries, including holes.
  const extent = (stroke: typeof style.strokes[number]): number => stroke.position === 'inside' ? 0 : stroke.width * (stroke.position === 'center' ? .5 : 1)
  for (const stroke of style.strokes.filter(stroke => stroke.enabled && stroke.width).sort((a, b) => extent(b) - extent(a) || b.width - a.width)) {
    reset(); draw(ink, stroke.position === 'center' ? stroke.width / 2 : stroke.width)
    if (stroke.position !== 'center') { ink.globalCompositeOperation = stroke.position === 'inside' ? 'destination-in' : 'destination-out'; ink.drawImage(glyphs, 0, 0) }
    tint(stroke.color); context.drawImage(layer, 0, 0)
  }
  context.restore()
}
