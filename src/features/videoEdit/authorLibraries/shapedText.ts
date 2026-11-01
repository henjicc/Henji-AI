import { z } from 'zod'
import * as hb from '../../../../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import type { RichTextContent } from '../../../core/imaging/vectorContent/contracts'
import { textStyleSchema } from '../../../core/imaging/vectorContent/text'
import { createShapedTextPlan, type ShapedTextPlan, type ShapedTextOptions, type ShapedTextCluster } from '../../../core/imaging/vectorContent/shaping/textPlan'
import { TextShaper } from '../../../core/imaging/vectorContent/shaping/harfbuzz'
import { currentTextFontSession } from '../../../core/imaging/vectorContent/shaping/fontContext'
import { textFontRequest } from '../../../core/imaging/vectorContent/shaping/runs'
import { paintVectorAppearance } from '../../../services/vectorContent/appearance'
import { appearanceBounds, union, type TextPlanRect } from '../../../core/imaging/vectorContent/textDrawPlan'
import { drawTextOutline, drawTextAppearance } from '../engine/videoEditTextOutlines'
import { parseTextInput, textOptionsSchema } from './validation'
import { codePoint } from '../../../core/videoEdit/codeMaterial/geometry'
import { TEXT_DRAW_OBSERVER, TEXT_LAYOUT_OBSERVER, TEXT_RASTER_CONTEXT, TEXT_BITMAP_RESTORE, type TextDrawObserverContext, type TextLayoutObserverGlobal, type TextRasterProvider, type RestorableTextBitmap } from '../../../core/videoEdit/textDrawObservation'

type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> }
export type TextStyleInput = DeepReadonly<z.input<typeof textStyleSchema>>
export type TextOptions = Pick<ShapedTextOptions, 'maxWidth' | 'maxHeight' | 'maxLines' | 'fit' | 'wrap' | 'wrapWidth' | 'anchor' | 'box' | 'frame' | 'direction' | 'truncate' | 'forceGraphemes' | 'ligatures' | 'autospace'>
export type TextLayout = DeepReadonly<Omit<ShapedTextPlan, 'clusters' | 'fontIdentity' | 'intrinsicWidths'>>
export interface GraphemePose { x?: number; y?: number; scale?: number; rotate?: number; opacity?: number }
export interface TextDrawOptions {
  graphemes?: number | readonly number[] | ((grapheme: TextLayout['graphemes'][number], index: number) => GraphemePose | null)
  backgroundAndDecorationOpacity?: number
}
export type { RichTextContent }
const schema = textOptionsSchema.extend({ wrap: z.enum(['normal', 'word', 'grapheme', 'none']).optional(), ligatures: z.boolean().optional(), autospace: z.boolean().optional() })
interface State { fontDiagnostics: readonly string[]; plan: ShapedTextPlan; id: string; rasters: Map<string, Raster>; owner: object; rich: boolean; options: TextOptions }
interface Raster { image: ImageBitmap; pixels: number; restore(): Raster }
const states = new WeakMap<TextLayout, State>(), shapers = new WeakMap<object, TextShaper>()
const layouts = new Map<string, TextLayout>(), rasterCache = new Map<Raster, () => void>()
const closedOwners = new WeakSet<object>(), ownerStates = new WeakMap<object, Set<WeakRef<State>>>()
let pixels = 0
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const observe = (id: string): void => (globalThis as TextLayoutObserverGlobal)[TEXT_LAYOUT_OBSERVER]?.(id)

/** 宿主屏障先准备字体，公开调用全程同步且不读取 Canvas 度量。 */
export function layoutText(input: string | RichTextContent, style: TextStyleInput = {}, options: TextOptions = {}): TextLayout {
  schema.parse(options)
  return prepareTextLayout(input, style, options)
}
export function textIntrinsicWidths(layout: TextLayout): { min: number; max: number } { return states.get(layout)!.plan.intrinsicWidths }
/** 表格只在准备阶段添加数值特性；不扩展公共文字样式。 */
export function prepareTextLayout(input: string | RichTextContent, style: TextStyleInput, options: ShapedTextOptions): TextLayout {
  const parsed = parseTextInput(input, style), fonts = currentTextFontSession(), owner = fonts.owner ?? fonts
  const styles = typeof parsed.content === 'string' ? [parsed.style] : [parsed.style, ...parsed.content.paragraphs.flatMap(p => p.runs.map(run => run.style))]
  const identity = JSON.stringify(styles.map(style => fonts.chain(textFontRequest(style)).identity))
  const key = JSON.stringify([parsed.content, parsed.style, options, identity])
  const cached = layouts.get(key)
  if (cached && states.get(cached)?.owner === owner) { layouts.delete(key); layouts.set(key, cached); observe(states.get(cached)!.id); return cached }
  let shaper = shapers.get(owner)
  if (!shaper) {
    shaper = new TextShaper(hb); shapers.set(owner, shaper)
    fonts.onClose?.(() => {
      closedOwners.add(owner); shaper!.dispose(); shapers.delete(owner)
      for (const ref of ownerStates.get(owner) ?? []) for (const entry of ref.deref()?.rasters.values() ?? []) { rasterCache.delete(entry); entry.image.close(); pixels -= entry.pixels }
      ownerStates.delete(owner)
      for (const [key, layout] of layouts) if (states.get(layout)?.owner === owner) layouts.delete(key)
    })
  }
  const plan = createShapedTextPlan(shaper, fonts, parsed.content, parsed.style, options)
  const { clusters: _clusters, fontIdentity: _fontIdentity, intrinsicWidths: _intrinsicWidths, ...publicPlan } = plan
  const layout: TextLayout = freeze(publicPlan), id = `text:${key}`
  const state = { fontDiagnostics: [...fonts.diagnostics?.() ?? []], plan, id, rasters: new Map<string, Raster>(), owner, rich: typeof parsed.content !== 'string', options: structuredClone(options) }
  states.set(layout, state); layouts.set(key, layout)
  const members = ownerStates.get(owner) ?? new Set<WeakRef<State>>()
  for (const ref of members) if (!ref.deref()) members.delete(ref)
  members.add(new WeakRef(state)); ownerStates.set(owner, members)
  if (layouts.size > 128) layouts.delete(layouts.keys().next().value!)
  observe(id)
  return layout
}

function paintCluster(ctx: OffscreenCanvasRenderingContext2D, cluster: ShapedTextCluster, outline = 0): void {
  ctx.save()
  if (cluster.style.fauxItalic) ctx.transform(1, 0, -.2, 1, 0, 0)
  if (cluster.emoji) {
    ctx.font = `${cluster.style.fontSize}px system-ui`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
    if (outline) { ctx.lineWidth = outline * 2; ctx.strokeText(cluster.emoji, 0, 0) } else ctx.fillText(cluster.emoji, 0, 0)
  } else for (const glyph of cluster.glyphs) {
    if (!glyph.outline.svg) continue
    ctx.save(); ctx.translate(glyph.x, glyph.y); ctx.scale(glyph.scale, -glyph.scale)
    if (outline) { ctx.lineWidth = outline * 2 / glyph.scale; drawTextOutline(ctx, glyph.outline, true) }
    else {
      drawTextOutline(ctx, glyph.outline)
      if (cluster.style.fauxBold) { ctx.lineWidth = Math.max(.5, cluster.style.fontSize / 30) / glyph.scale; drawTextOutline(ctx, glyph.outline, true) }
    }
    ctx.restore()
  }
  ctx.restore()
}

function raster(state: State, cluster: ShapedTextCluster, bounds: TextPlanRect, density: number, colorSpace: 'srgb' | 'display-p3', part: 'underlay' | 'fill', tile: TextPlanRect): Raster {
  const key = JSON.stringify([cluster.owner, cluster.glyphs.map(g => [g.outline.identity, g.x, g.y, g.scale]), cluster.style, bounds, density, colorSpace, part, tile])
  const held = state.rasters.get(key)
  if (held) { rasterCache.delete(held); rasterCache.set(held, () => state.rasters.delete(key)); return held }
  const stroke = Math.max(0, ...cluster.style.strokes.filter(s => s.enabled).map(s => s.width))
  const halo = Math.ceil(density * Math.max(stroke, ...cluster.style.shadows.filter(s => s.enabled).map(s => s.blur * 3 + s.distance + s.size + stroke))) + 2
  const surface = { x: tile.x - halo, y: tile.y - halo, width: tile.width + halo * 2, height: tile.height + halo * 2 }
  const canvas = new OffscreenCanvas(surface.width, surface.height), ctx = canvas.getContext('2d', { colorSpace })!
  ctx.scale(density, density)
  paintVectorAppearance(ctx, surface.width / density, surface.height / density, density, cluster.style,
    target => { target.save(); target.translate(-bounds.x - surface.x / density, -bounds.y - surface.y / density); paintCluster(target, cluster); target.restore() },
    (target, radius) => { target.save(); target.translate(-bounds.x - surface.x / density, -bounds.y - surface.y / density); paintCluster(target, cluster, radius); target.restore() }, part)
  const cropped = new OffscreenCanvas(tile.width, tile.height)
  cropped.getContext('2d', { colorSpace })!.drawImage(canvas, halo, halo, tile.width, tile.height, 0, 0, tile.width, tile.height)
  const image: RestorableTextBitmap<ImageBitmap> = cropped.transferToImageBitmap()
  const entry: Raster = { image, pixels: tile.width * tile.height, restore: () => raster(state, cluster, bounds, density, colorSpace, part, tile) }
  image[TEXT_BITMAP_RESTORE] = () => entry.restore().image
  while (rasterCache.size && pixels + entry.pixels > 32 * 1024 * 1024) {
    const [old, remove] = rasterCache.entries().next().value!; remove(); rasterCache.delete(old); old.image.close(); pixels -= old.pixels
  }
  state.rasters.set(key, entry); rasterCache.set(entry, () => state.rasters.delete(key)); pixels += entry.pixels
  return entry
}

/** 所有位姿使用同一不可变簇几何；必需连字的可见性和位姿由首字素决定。 */
export function drawText(context: OffscreenCanvasRenderingContext2D, layout: TextLayout, options: TextDrawOptions = {}): void {
  const state = states.get(layout)
  if (!state) throw new Error('drawText 需要同一库 layoutText 返回的布局')
  if (closedOwners.has(state.owner)) throw new Error('文字字体会话已经释放')
  const { plan } = state, selection = options.graphemes
  if (typeof selection === 'number' && (!Number.isFinite(selection) || selection < 0)) throw new Error('graphemes 必须为非负有限数')
  if (Array.isArray(selection) && selection.some(index => !Number.isInteger(index) || index < 0 || index >= layout.graphemes.length)) throw new Error('graphemes 索引超出布局')
  const poses = layout.graphemes.map((g, index): GraphemePose | null => {
    const pose = typeof selection === 'function' ? selection(g, index) : selection === undefined || (typeof selection === 'number' ? index < Math.floor(selection) : selection.includes(index)) ? {} : null
    if (pose && Object.values(pose).some(value => !Number.isFinite(value))) throw new Error('字素位姿必须为有限数值')
    return pose && (pose.opacity ?? 1) > 0 ? pose : null
  })
  const opacity = options.backgroundAndDecorationOpacity ?? (poses.some(Boolean) ? 1 : 0)
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('底板和装饰透明度必须在 0–1 之间')
  const { background } = plan.style
  let actualAppearance: TextPlanRect | null = null
  const backgrounds: Array<{ paint: ShapedTextCluster['style']['background']; box: TextPlanRect; line?: number }> = []
  if (state.rich) for (const [index, line] of plan.lines.entries()) for (const group of line.groups.map(i => plan.groups[i]).sort((a, b) => a.x - b.x)) {
    const box = { x: group.x, y: line.y, width: plan.graphemes[group.graphemes[0]].advance, height: line.height }, previous = backgrounds.at(-1)
    if (previous?.line === index && JSON.stringify(previous.paint) === JSON.stringify(group.style.background)) previous.box.width = box.x + box.width - previous.box.x
    else backgrounds.push({ paint: group.style.background, box, line: index })
  }
  else backgrounds.push({ paint: background, box: plan.box })
  for (const { paint: background, box } of backgrounds) if (opacity && background.enabled) {
    context.save(); context.globalAlpha *= opacity * background.opacity; context.fillStyle = background.color
    context.beginPath(); context.roundRect(box.x - background.padding, box.y - background.padding, box.width + background.padding * 2, box.height + background.padding * 2, background.radius); context.fill(); context.restore()
    actualAppearance = union(actualAppearance, { x: box.x - background.padding, y: box.y - background.padding, width: box.width + background.padding * 2, height: box.height + background.padding * 2 })
  }
  let actualInk: TextPlanRect | null = null
  for (const part of ['underlay', 'fill'] as const) for (const cluster of plan.clusters) {
    const pose = poses[cluster.owner]
    if (!pose) continue
    const appearance = cluster.style.strokes.some(stroke => stroke.enabled && stroke.width) || cluster.style.shadows.some(shadow => shadow.enabled && shadow.opacity)
    if (!appearance && (part === 'underlay' || !cluster.style.fill.enabled)) continue
    context.save(); context.globalAlpha *= Math.min(1, pose.opacity ?? 1); context.translate(cluster.x + (pose.x ?? 0), cluster.baseline + (pose.y ?? 0)); context.rotate(pose.rotate ?? 0); context.scale(pose.scale ?? 1, pose.scale ?? 1)
    if (!appearance) { context.fillStyle = cluster.style.fill.color; context.strokeStyle = cluster.style.fill.color; paintCluster(context, cluster) }
    else if (cluster.inkBounds) {
      const rect = appearanceBounds(cluster.inkBounds, { lines: [], left: 0, top: 0, width: 0, height: 0, contentTop: 0, lineHeight: 0, style: { ...cluster.style, background: { ...background, enabled: false } } })
      if (rect) {
        // 密度至少为 1：左上留边最多 1，右下取整加留边小于 2 个作品像素。
        drawTextAppearance(context, { identity: JSON.stringify([state.id, cluster.owner, part]), bounds: { x: rect.x - cluster.x - 1, y: rect.y - cluster.baseline - 1, width: rect.width + 3, height: rect.height + 3 }, draw: target => {
        const bounds = { ...rect, x: rect.x - cluster.x, y: rect.y - cluster.baseline }
        const provider = target as TextRasterProvider, physical = provider[TEXT_RASTER_CONTEXT]?.(), matrix = physical?.matrix ?? (() => { const m = target.getTransform(); return [m.a, m.b, m.c, m.d] })()
        const scale = (Math.hypot(matrix[0] + matrix[3], matrix[1] - matrix[2]) + Math.hypot(matrix[0] - matrix[3], matrix[1] + matrix[2])) / 2
        const density = 2 ** Math.ceil(Math.log2(Math.max(1, scale))), colorSpace = physical?.colorSpace ?? provider.getContextAttributes?.().colorSpace ?? 'srgb'
        const w = Math.ceil(bounds.width * density) + 2, h = Math.ceil(bounds.height * density) + 2
        bounds.x -= 1 / density; bounds.y -= 1 / density
        for (let y = 0; y < h; y += 2048) for (let x = 0; x < w; x += 2048) {
          const tile = { x, y, width: Math.min(2048, w - x), height: Math.min(2048, h - y) }, entry = raster(state, cluster, bounds, density, colorSpace, part, tile)
          target.drawImage(entry.image, bounds.x + x / density, bounds.y + y / density, tile.width / density, tile.height / density)
        }
        } })
      }
    }
    context.restore()
    if (part === 'fill' && cluster.inkBounds) {
      const transformBounds = (r: TextPlanRect): TextPlanRect => {
        const scale = pose.scale ?? 1, cos = Math.cos(pose.rotate ?? 0) * scale, sin = Math.sin(pose.rotate ?? 0) * scale
        const points = [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]].map(([x, y]) => codePoint([cos, sin, -sin, cos, cluster.x + (pose.x ?? 0), cluster.baseline + (pose.y ?? 0)], x - cluster.x, y - cluster.baseline))
        const xs = points.map(p => p[0]), ys = points.map(p => p[1])
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      }
      if (cluster.style.fill.enabled || cluster.style.strokes.some(stroke => stroke.enabled && stroke.width)) actualInk = union(actualInk, transformBounds(cluster.inkBounds))
      const rect = appearanceBounds(cluster.inkBounds, { lines: [], left: 0, top: 0, width: 0, height: 0, contentTop: 0, lineHeight: 0, style: { ...cluster.style, background: { ...background, enabled: false } } })
      if (rect) actualAppearance = union(actualAppearance, transformBounds(rect))
    }
  }
  if (opacity) for (const line of plan.lines) for (const index of line.groups) {
    const group = plan.groups[index]
    if (!group.style.underline) continue
    const advance = Math.max(0, ...group.graphemes.map(index => plan.graphemes[index].advance))
    context.save(); context.globalAlpha *= opacity; context.fillStyle = group.style.fill.color; context.fillRect(group.x, group.baseline + group.style.fontSize / 12, advance, Math.max(1, group.style.fontSize / 24)); context.restore()
  }
  const { sourceText, box, contentSize, visibleContentSize, overflow, truncated, omittedRanges, totalLines, fit } = plan
  const painted = plan.clusters.map(cluster => cluster.style.fill.enabled || cluster.style.strokes.some(stroke => stroke.enabled && stroke.width))
  ;(context as TextDrawObserverContext)[TEXT_DRAW_OBSERVER]?.({ fontDiagnostics: state.fontDiagnostics, layoutId: state.id, sourceText, box, contentSize, visibleContentSize, inkBounds: actualInk, appearanceBounds: actualAppearance, boundsKind: 'measured', overflow, truncated, omittedRanges, totalLines, fit, actualLines: plan.lines.length, revealComplete: plan.clusters.every(cluster => poses[cluster.owner]), paintKey: JSON.stringify(plan.clusters.map(cluster => cluster.style)), bodyCoverage: !poses.some(Boolean) ? 'none' : painted.every(Boolean) ? 'complete' : painted.some(Boolean) ? 'partial' : 'none', constraint: { x: box.x, y: plan.contentTop, width: state.options.box?.width || state.options.maxWidth, height: state.options.box?.height ?? state.options.maxHeight, maxWidth: state.options.maxWidth, maxHeight: state.options.maxHeight, maxLines: state.options.maxLines } })
}
