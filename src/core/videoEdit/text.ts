import { z } from 'zod'
import { BLACK_HEX, WHITE_HEX } from '../theme/colorTokens'
import { videoEditClipToFrame, videoEditFrameToClip, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'

const color = z.string().regex(/^#[\da-f]{6}$/i, '请选择有效的颜色。')
/** Persist content colors, never theme colors: changing the application theme must not change the exported title. */
export const videoEditTextStyleSchema = z.object({
  fontFamily: z.string().trim().min(1).max(100), fontSize: z.number().finite().min(1).max(512),
  color, align: z.enum(['left', 'center', 'right']), anchor: z.enum(['top', 'middle']),
  strokeColor: color, strokeWidth: z.number().finite().min(0).max(20),
  shadow: z.boolean(), shadowColor: color, shadowBlur: z.number().finite().min(0).max(50),
  background: z.boolean(), backgroundColor: color,
  /** Zero is point text; otherwise a fixed width relative to the sequence width, before motion scaling. */
  boxWidth: z.number().finite().min(0).max(1),
}).strict()
export type VideoEditTextStyle = z.infer<typeof videoEditTextStyleSchema>
export function defaultVideoEditTextStyle(height: number): VideoEditTextStyle {
  return { fontFamily: 'sans-serif', fontSize: Math.round(height / 15), color: WHITE_HEX, align: 'center', anchor: 'middle', strokeColor: BLACK_HEX, strokeWidth: 0, shadow: false, shadowColor: BLACK_HEX, shadowBlur: 4, background: false, backgroundColor: BLACK_HEX, boxWidth: 0 }
}
export interface VideoEditTextLayout { lines: string[]; left: number; top: number; width: number; height: number; lineHeight: number; style: VideoEditTextStyle }
export type VideoEditTextContent = { text: string; textStyle?: VideoEditTextStyle }
/** The same measured layout drives the title texture, hit area, handles and paragraph wrapping. */
export function layoutVideoEditText(clip: VideoEditTextContent, frame: VideoEditSize, measure: (text: string, font: string) => number): VideoEditTextLayout {
  const style = clip.textStyle ?? defaultVideoEditTextStyle(frame.height)
  const font = `${style.fontSize}px ${style.fontFamily}`
  const fixedWidth = style.boxWidth * frame.width
  const lines = clip.text.split('\n').flatMap(line => {
    if (!fixedWidth || !line) return [line]
    const wrapped: string[] = []; let current = ''
    // Iterate Unicode code points, preserving spaces and explicit newlines; never split a surrogate pair.
    for (const character of line) {
      if (current && measure(current + character, font) > fixedWidth) { wrapped.push(current); current = '' }
      current += character
    }
    wrapped.push(current); return wrapped
  })
  const width = fixedWidth || Math.max(style.fontSize, ...lines.map(line => measure(line, font)))
  const lineHeight = clip.textStyle ? style.fontSize * 1.25 : frame.height / 12
  const top = frame.height / 2 - (style.anchor === 'middle' ? lineHeight / 2 : 0)
  const left = frame.width / 2 - (style.align === 'center' ? width / 2 : style.align === 'right' ? width : 0)
  return { lines, left, top, width, height: Math.max(lineHeight, lines.length * lineHeight), lineHeight, style }
}

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
