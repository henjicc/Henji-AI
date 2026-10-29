import { WHITE_HEX } from '../../theme/colorTokens'
import type { VectorPaint } from './contracts'
import type { TextDrawPlan, TextPlanMeasure } from './textDrawPlan'

type Context = OffscreenCanvasRenderingContext2D
export type TextPaintPart = 'all' | 'background' | 'underlay' | 'fill' | 'decoration'
/** 合成器由宿主传入 paintVectorAppearance；核心层不反向导入 services，也不维护另一份遮罩算法。 */
export type TextAppearanceCompositor = (context: Context, width: number, height: number, resolution: number, paint: VectorPaint, drawCoverage: (target: Context) => void, drawOutline: (target: Context, radius: number) => void) => void

export function canvasTextPlanMeasure(context: Context): TextPlanMeasure {
  return (text, font, state) => {
    context.save()
    try {
      context.font = font; context.fontKerning = state.fontKerning; context.direction = state.direction
      context.textAlign = state.textAlign; context.textBaseline = state.textBaseline
      return context.measureText(text)
    } finally { context.restore() }
  }
}

/** 绘制只读计划；定位、换行与量字不在覆盖或描边回调中重复执行。 */
export function paintTextDrawPlan(context: Context, plan: TextDrawPlan, surface: { width: number; height: number; resolution?: number; x?: number; y?: number; signal?: AbortSignal }, appearance: TextAppearanceCompositor, part: TextPaintPart = 'all'): void {
  const dx = surface.x ?? 0, dy = surface.y ?? 0
  for (const batch of plan.batches) {
    surface.signal?.throwIfAborted()
    const { layout } = batch, { style } = layout
    const draw = (target: Context, stroke = 0): void => {
      target.save(); target.direction = batch.direction; target.textBaseline = 'middle'; target.textAlign = 'left'; target.lineJoin = 'round'
      target.fontKerning = batch.fontKerning
      target.fillStyle = WHITE_HEX; target.strokeStyle = WHITE_HEX; target.lineWidth = stroke * 2
      for (const row of batch.rows) {
        for (const id of part === 'decoration' ? [] : row.groups) {
          const group = plan.groups[id]
          let at = group.x + dx
          const y = group.baseline + dy
          target.font = group.font; target.textBaseline = group.baselineKind; target.save()
          if (style.fauxItalic) { target.translate(at, y); target.transform(1, 0, -.2, 1, 0, 0); at = 0 }
          const baseline = style.fauxItalic ? 0 : y
          if (stroke) { target.lineWidth = stroke * 2 + (style.fauxBold ? Math.max(.5, group.size / 30) : 0); target.strokeText(group.text, at, baseline) }
          else {
            target.fillText(group.text, at, baseline)
            if (style.fauxBold) { target.lineWidth = Math.max(.5, group.size / 30); target.strokeText(group.text, at, baseline) }
          }
          target.restore()
        }
        const underline = row.underline
        if (underline && (part === 'all' || part === 'decoration')) target.fillRect(underline.x + dx, underline.y + dy, underline.width, underline.height)
      }
      target.restore()
    }
    context.save()
    if (style.background.enabled && (part === 'all' || part === 'background')) {
      const { padding, radius, color, opacity } = style.background
      context.globalAlpha = opacity; context.fillStyle = color; context.beginPath()
      context.roundRect(layout.left + dx - padding, layout.top + dy - padding, layout.width + 2 * padding, layout.height + 2 * padding, radius)
      context.fill(); context.globalAlpha = 1
    }
    if (part !== 'background') appearance(context, surface.width, surface.height, surface.resolution ?? 1, style, target => draw(target), (target, radius) => draw(target, radius))
    context.restore()
  }
}
