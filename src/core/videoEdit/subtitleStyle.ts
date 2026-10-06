import { z } from 'zod'
import type { VideoEditGraphic, VideoEditGraphicObject } from './graphics'

export const videoEditSubtitleStyleSchema = z.object({
  fontFamily: z.enum(['sans-serif', 'serif', 'monospace']).default('sans-serif'),
  fontSize: z.number().min(12).max(200).default(48),
  outline: z.boolean().default(true),
  background: z.boolean().default(false),
  bottomMargin: z.number().min(.05).max(.4).default(.1),
}).strict()
export type VideoEditSubtitleStyle = z.infer<typeof videoEditSubtitleStyleSchema>

/** Reuse the existing graphic text/rect commands, including content colors and full-size export. */
export function subtitleGraphic(text: string, width: number, height: number, input: VideoEditSubtitleStyle): VideoEditGraphic {
  const style = videoEditSubtitleStyleSchema.parse(input)
  const fontSize = Math.min(512, Math.max(1, style.fontSize * height / 1080))
  const lines = text.split('\n'); const step = fontSize * 1.3
  const bottom = height * (1 - style.bottomMargin) - fontSize / 2
  const objects: VideoEditGraphicObject[] = []
  if (lines.length > 3) throw new Error('带样式字幕最多三行，请先拆分此长句或增大每行字数。')
  if (style.background) objects.push({ id: 'background', name: '字幕底框', kind: 'rect', parameters: { x: width * .05, y: bottom - (lines.length - 1) * step - fontSize * .75, width: width * .9, height: lines.length * step, fill: [0, 0, 0, .7], radius: fontSize * .2 } })
  lines.forEach((line, index) => {
    const y = bottom - (lines.length - 1 - index) * step
    const common = { x: width / 2, y, text: line, fontSize, fontFamily: style.fontFamily, align: 'center' }
    if (style.outline) for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) objects.push({ id: `outline-${index}-${dx}-${dy}`, name: '字幕描边', kind: 'text', parameters: { ...common, x: width / 2 + dx * fontSize * .04, y: y + dy * fontSize * .04, color: [0, 0, 0, 1] } })
    objects.push({ id: `text-${index}`, name: '字幕文字', kind: 'text', parameters: { ...common, color: [1, 1, 1, 1] } })
  })
  return { width, height, objects }
}
