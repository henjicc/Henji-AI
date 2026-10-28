import type { z } from 'zod'
import { textStyleSchema } from '../../../core/imaging/vectorContent/text'
import type { RichTextContent } from '../../../core/imaging/vectorContent/contracts'
import { createTextDrawPlan, type TextDrawConstraints, type TextDrawPlan } from '../../../core/imaging/vectorContent/textDrawPlan'
import { canvasTextPlanMeasure, paintTextDrawPlan } from '../../../core/imaging/vectorContent/textDrawPlanCanvas'
import { paintVectorAppearance } from '../../../services/vectorContent/appearance'
import { parseTextInput, validateTextOptions } from './validation'

export type TextStyleInput = z.input<typeof textStyleSchema>
/** maxWidth、wrapWidth 为 0 时不设对应宽度限制；box.width 为 0 与省略相同；maxHeight 为 0 默认截断所有行。 */
export type TextOptions = Pick<TextDrawConstraints, 'maxWidth' | 'maxHeight' | 'maxLines' | 'fit' | 'wrap' | 'wrapWidth' | 'anchor' | 'box' | 'frame' | 'direction' | 'truncate'>
export type TextLayout = Omit<TextDrawPlan, 'batches' | 'rasterBounds'>
export type { RichTextContent }

const plans = new WeakMap<TextLayout, TextDrawPlan>()
let measurement: OffscreenCanvasRenderingContext2D | undefined

/** 每次量字都读取当前 Worker 字体集，不缓存跨字体加载代次的测量结果。 */
export function layoutText(text: string | RichTextContent, style: TextStyleInput = {}, options: TextOptions = {}): TextLayout {
  validateTextOptions(options)
  const parsed = parseTextInput(text, style)
  measurement ??= new OffscreenCanvas(1, 1).getContext('2d') ?? undefined
  if (!measurement) throw new Error('文字排版需要 Worker 的 OffscreenCanvas 2D 上下文。')
  const plan = createTextDrawPlan(parsed.content, parsed.style, {
    ...options,
    maxWidth: options.maxWidth === 0 ? undefined : options.maxWidth,
    wrapWidth: options.wrapWidth ?? options.maxWidth,
    box: options.box && { ...options.box, width: options.box.width === 0 ? undefined : options.box.width },
  }, canvasTextPlanMeasure(measurement))
  const { batches: _batches, rasterBounds: _rasterBounds, ...layout } = plan
  plans.set(layout, plan)
  return layout
}

/** 局部纹理包含描边阴影的完整留白；调用方的矩阵、透明度和裁切在合成到目标时生效。 */
export function drawText(context: OffscreenCanvasRenderingContext2D, layout: TextLayout): void {
  const plan = plans.get(layout)
  if (!plan) throw new Error('drawText 需要同一库版本 layoutText 返回的原始布局对象。')
  const bounds = plan.rasterBounds
  if (!bounds.width || !bounds.height) return
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(bounds.width)), Math.max(1, Math.ceil(bounds.height)))
  const target = canvas.getContext('2d')!
  paintTextDrawPlan(target, plan, { width: canvas.width, height: canvas.height, x: -bounds.x, y: -bounds.y }, paintVectorAppearance)
  context.drawImage(canvas, bounds.x, bounds.y)
}
