import { createTextDrawPlan, type TextDrawPlan, type TextPlanMeasure } from '../../../core/imaging/vectorContent/textDrawPlan'
import { paintTextDrawPlan, type TextPaintPart } from '../../../core/imaging/vectorContent/textDrawPlanCanvas'
import { paintVectorAppearance } from '../../../services/vectorContent/appearance'

export interface AtlasCell { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number; plan: TextDrawPlan; part: Exclude<TextPaintPart, 'all'> }
export interface GraphemeAtlas { width: number; height: number; glyphs: Array<{ underlay: AtlasCell; fill: AtlasCell }>; background?: AtlasCell; decoration?: AtlasCell }

export function createGraphemeAtlas(plan: TextDrawPlan, measure: TextPlanMeasure): GraphemeAtlas {
  const cells: AtlasCell[] = []
  const glyphs = plan.graphemes.map(g => {
    if (g.x === null) throw new Error('双向混排没有独立字素坐标，请整体绘制或在 layoutText 中明确拆字方向。')
    const group = plan.groups[g.group]
    // 展示文本和字号已由整段布局确定；底板和装饰线属于整段，不能随字素重复合成。
    const glyph = createTextDrawPlan(g.displayText, { ...group.style, background: { ...group.style.background, enabled: false }, underline: false, fontSize: group.size, smallCaps: false, superscript: false, subscript: false, baselineShift: 0, boxWidth: 0, boxHeight: 0 }, { baseline: g.baselineKind, trim: false, minimumWidth: 'zero', wrap: 'none' }, measure)
    const bounds = glyph.rasterBounds, origin = glyph.groups[0]
    const cell = (part: AtlasCell['part']): AtlasCell => ({ x: 0, y: 0, width: bounds.width, height: bounds.height, offsetX: bounds.x - (origin?.x ?? 0), offsetY: bounds.y - (origin?.baseline ?? 0), plan: glyph, part })
    const underlay = cell('underlay'), fill = cell('fill')
    cells.push(underlay, fill)
    return { underlay, fill }
  })
  // 独立格子隔离斜体伸出和负字距的墨迹；上下层共用一张位图，重放无需重新合成外观。
  const cellWidth = Math.max(1, ...cells.map(cell => cell.width)), cellHeight = Math.max(1, ...cells.map(cell => cell.height))
  const columns = Math.max(1, Math.ceil(Math.sqrt(cells.length * cellHeight / cellWidth)))
  cells.forEach((cell, i) => { cell.x = i % columns * cellWidth; cell.y = Math.floor(i / columns) * cellHeight })
  const atlas: GraphemeAtlas = { glyphs, width: columns * cellWidth, height: Math.ceil(cells.length / columns) * cellHeight }
  // 整段层另占完整布局格子；与字素格子共用缓存预算，不增加逐帧上传的位图身份。
  const block = (part: 'background' | 'decoration'): AtlasCell => {
    const bounds = plan.rasterBounds
    const cell: AtlasCell = { x: 0, y: atlas.height, width: bounds.width, height: bounds.height, offsetX: bounds.x, offsetY: bounds.y, plan, part }
    atlas.width = Math.max(atlas.width, cell.width); atlas.height += cell.height
    return cell
  }
  if (plan.batches.some(batch => batch.layout.style.background.enabled)) atlas.background = block('background')
  if (plan.batches.some(batch => batch.rows.some(row => row.underline))) atlas.decoration = block('decoration')
  return atlas
}

export function paintGraphemeAtlas(target: OffscreenCanvasRenderingContext2D, atlas: GraphemeAtlas, resolution: number, colorSpace: 'srgb' | 'display-p3'): void {
  for (const cell of [...atlas.glyphs.flatMap(glyph => [glyph.underlay, glyph.fill]), atlas.background, atlas.decoration]) {
    if (!cell) continue
    const style = cell.plan.style
    if (cell.part === 'underlay' && !style.strokes.some(stroke => stroke.enabled && stroke.width && stroke.position === 'outside') && !style.shadows.some(shadow => shadow.enabled && shadow.opacity)) continue
    if (cell.part === 'fill' && !style.fill.enabled && !style.strokes.some(stroke => stroke.enabled && stroke.width && stroke.position !== 'outside')) continue
    const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(cell.width * resolution)), Math.max(1, Math.ceil(cell.height * resolution)))
    const context = canvas.getContext('2d', { colorSpace })!
    context.scale(resolution, resolution)
    paintTextDrawPlan(context, cell.plan, { width: canvas.width / resolution, height: canvas.height / resolution, resolution, x: -cell.plan.rasterBounds.x, y: -cell.plan.rasterBounds.y },
      (...args) => paintVectorAppearance(...args, cell.part === 'underlay' || cell.part === 'fill' ? cell.part : 'all'), cell.part)
    target.drawImage(canvas, 0, 0, cell.width * resolution, cell.height * resolution, cell.x * resolution, cell.y * resolution, cell.width * resolution, cell.height * resolution)
  }
}
