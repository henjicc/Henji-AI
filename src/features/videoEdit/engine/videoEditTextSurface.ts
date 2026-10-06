import { layoutVideoEditText, type VideoEditTextContent } from '@/core/videoEdit/text'

/** Canvas 2D supplies native glyph shaping; the existing compositor applies motion/effects for preview and export. */
export function paintVideoEditText(context: OffscreenCanvasRenderingContext2D, clip: VideoEditTextContent, width: number, height: number): void {
  const layout = layoutVideoEditText(clip, { width, height }, (text, font) => { context.font = font; return context.measureText(text).width })
  const { style, left, top, lines, lineHeight } = layout
  context.font = `${style.fontSize}px ${style.fontFamily}`
  context.textAlign = style.align; context.textBaseline = 'middle'
  if (style.background) { context.fillStyle = style.backgroundColor; context.fillRect(left, top, layout.width, layout.height) }
  context.fillStyle = style.color; context.strokeStyle = style.strokeColor; context.lineWidth = style.strokeWidth * 2; context.lineJoin = 'round'
  if (style.shadow) { context.shadowColor = style.shadowColor; context.shadowBlur = style.shadowBlur; context.shadowOffsetX = style.fontSize * .04; context.shadowOffsetY = style.fontSize * .04 }
  const x = left + (style.align === 'center' ? layout.width / 2 : style.align === 'right' ? layout.width : 0)
  lines.forEach((line, row) => {
    const y = clip.textStyle ? top + (row + .5) * lineHeight : height / 2 + row * lineHeight
    if (style.strokeWidth) context.strokeText(line, x, y)
    context.fillText(line, x, y)
  })
}
