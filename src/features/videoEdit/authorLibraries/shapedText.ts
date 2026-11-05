import { z } from 'zod'
import * as hb from '../../../../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import type { TextParagraph } from '../../../core/imaging/vectorContent/contracts'
import type { TextParagraphLayout } from '../../../core/imaging/vectorContent/shaping/textPlan'
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
export type TextOptions = Pick<ShapedTextOptions, 'maxWidth' | 'maxHeight' | 'maxLines' | 'fit' | 'wrap' | 'wrapWidth' | 'anchor' | 'box' | 'frame' | 'direction' | 'truncate' | 'forceGraphemes' | 'ligatures' | 'autospace' | 'writingMode' | 'columns' | 'exclusions'>
export type TextLayout = DeepReadonly<Omit<ShapedTextPlan, 'clusters' | 'fontIdentity' | 'intrinsicWidths'>>
export interface GraphemePose { x?: number; y?: number; scale?: number; rotate?: number; opacity?: number }
export interface TextDrawOptions {
  graphemes?: number | readonly number[] | ((grapheme: TextLayout['graphemes'][number], index: number) => GraphemePose | null)
  backgroundAndDecorationOpacity?: number
}
/** 作者写富文本时只有 runs 必填：对齐沿用基础样式，方向自动判断，段距为 0，盒子由 options 决定。 */
export interface RichTextContent {
  box?: { x: number; y: number; width: number; height: number }
  paragraphs: readonly (Partial<Omit<TextParagraph, 'runs'>> & TextParagraphLayout & { runs: readonly { text: string; style: TextStyleInput }[] })[]
}
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
/** 宿主图层的字段；这里只声明本函数会填的部分，宿主另有校验。 */
export interface GlyphLayer { id: string; bounds: [number, number, number, number]; cacheKey: string; clip?: readonly [number, number, number, number]; pose(t: number): unknown; effects?: (t: number) => unknown; draw(ctx: OffscreenCanvasRenderingContext2D): void }
export interface GlyphLayerOptions {
  /** 图层 id 前缀，同一模块里要唯一。 */
  id?: string
  /** 每个字的位姿；cx、cy 是字面中心，转和缩放要绕它就用这两个值。返回 null 表示这一刻不显示。 */
  pose(t: number, index: number, center: { cx: number; cy: number }, grapheme: TextLayout['graphemes'][number]): unknown
  effects?: (t: number, index: number) => unknown
  /** 整段的偏移，字的位置按它平移。 */
  offset?: { x: number; y: number }
  clip?: readonly [number, number, number, number]
}
/** 整段拆成每字一层：位姿走宿主的运动模糊和效果链，不用自己算字的范围。空白和连字的后续字素不单独成层。 */
export function glyphLayers(layout: TextLayout, options: GlyphLayerOptions): GlyphLayer[] {
  const { id = 'glyph', offset = { x: 0, y: 0 } } = options, state = states.get(layout)
  if (!state) throw new Error('glyphLayers 需要同一库 layoutText 返回的布局')
  const clusters = new Map(state.plan.clusters.map(cluster => [cluster.owner, cluster]))
  return layout.graphemes.flatMap((g, index) => {
    const cluster = clusters.get(index)
    if (g.owner !== index || !g.displayText.trim() || !cluster?.inkBounds) return []
    // 范围按这个字实际的墨迹和描边、阴影算：混排里大字号、描边和阴影都不会被裁。
    const size = cluster.style.fontSize, along = Math.max(g.advance, size * .1), ink = cluster.inkBounds
    const rect = appearanceBounds(ink, { lines: [], left: 0, top: 0, width: 0, height: 0, contentTop: 0, lineHeight: 0, style: { ...cluster.style, background: { ...cluster.style.background, enabled: false } } }) ?? ink
    const cx = (layout.vertical ? ink.x + ink.width / 2 : (g.x ?? 0) + along / 2) + offset.x, cy = (layout.vertical ? ink.y + ink.height / 2 : g.y - size * .36) + offset.y
    return [{ id: `${id}-${index}`, bounds: [rect.x - 2 + offset.x, rect.y - 2 + offset.y, rect.x + rect.width + 2 + offset.x, rect.y + rect.height + 2 + offset.y] as [number, number, number, number], cacheKey: `${state.id}:${index}`, ...(options.clip ? { clip: options.clip } : {}),
      pose: (t: number) => options.pose(t, index, { cx, cy }, g), ...(options.effects ? { effects: (t: number) => options.effects!(t, index) } : {}),
      draw(ctx: OffscreenCanvasRenderingContext2D) { ctx.save(); ctx.translate(offset.x, offset.y); drawText(ctx, layout, { graphemes: (_, k) => k === index ? {} : null, backgroundAndDecorationOpacity: 0 }); ctx.restore() } }]
  })
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

const WHOLE_CANVAS_COMPOSITES = new Set(['source-in', 'source-out', 'destination-in', 'destination-atop', 'copy'])

function paintCluster(ctx: OffscreenCanvasRenderingContext2D, cluster: ShapedTextCluster, outline = 0): void {
  ctx.save()
  if (cluster.style.fauxItalic) ctx.transform(1, 0, -.2, 1, 0, 0)
  if (cluster.emoji) {
    ctx.font = `${cluster.style.fontSize}px system-ui`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
    const emojiX = cluster.upright ? cluster.glyphs[0]?.x ?? 0 : 0, emojiY = cluster.upright ? cluster.glyphs[0]?.y ?? 0 : 0
    if (outline) { ctx.lineWidth = outline * 2; ctx.strokeText(cluster.emoji, emojiX, emojiY) } else ctx.fillText(cluster.emoji, emojiX, emojiY)
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
  // 文字逐簇逐笔绘制；这些混合方式每画一笔都会清掉笔画以外的内容，最后只剩一笔或全空。
  if (WHOLE_CANVAS_COMPOSITES.has(context.globalCompositeOperation) && poses.some(Boolean)) throw new Error(`drawText 不能在 ${context.globalCompositeOperation} 下绘制：要让内容从字里透出来，先用默认混合画字，再切到 source-in 画内容`)
  const opacity = options.backgroundAndDecorationOpacity ?? (poses.some(Boolean) ? 1 : 0)
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('底板和装饰透明度必须在 0–1 之间')
  const { background } = plan.style
  let actualAppearance: TextPlanRect | null = null
  const backgrounds: Array<{ paint: ShapedTextCluster['style']['background']; box: TextPlanRect; line?: number }> = []
  if (state.rich) for (const [index, line] of plan.lines.entries()) for (const group of line.groups.map(i => plan.groups[i]).sort((a, b) => plan.vertical ? a.baseline - b.baseline : a.x - b.x)) {
    const advance = plan.graphemes[group.graphemes[0]].advance, previous = backgrounds.at(-1)
    const box = plan.vertical ? { x: line.x, y: group.baseline, width: line.width, height: advance } : { x: group.x, y: line.y, width: advance, height: line.height }
    if (previous?.line === index && JSON.stringify(previous.paint) === JSON.stringify(group.style.background)) { if (plan.vertical) previous.box.height = box.y + box.height - previous.box.y; else previous.box.width = box.x + box.width - previous.box.x }
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
    context.save(); context.globalAlpha *= Math.min(1, pose.opacity ?? 1); context.translate(cluster.x + (pose.x ?? 0), cluster.baseline + (pose.y ?? 0)); context.rotate((pose.rotate ?? 0) + (cluster.rotate ?? 0)); context.scale(pose.scale ?? 1, pose.scale ?? 1)
    if (!appearance) { context.fillStyle = cluster.style.fill.color; context.strokeStyle = cluster.style.fill.color; paintCluster(context, cluster) }
    else if (cluster.inkBounds) {
      // 旋转的簇已经在旋转后的坐标系里，栅格范围要用它自身坐标的墨迹。
      const ink = cluster.localInk ?? cluster.inkBounds, originX = cluster.localInk ? 0 : cluster.x, originY = cluster.localInk ? 0 : cluster.baseline
      const rect = appearanceBounds(ink, { lines: [], left: 0, top: 0, width: 0, height: 0, contentTop: 0, lineHeight: 0, style: { ...cluster.style, background: { ...background, enabled: false } } })
      if (rect) {
        // 密度至少为 1：左上留边最多 1，右下取整加留边小于 2 个作品像素。
        drawTextAppearance(context, { identity: JSON.stringify([state.id, cluster.owner, part]), bounds: { x: rect.x - originX - 1, y: rect.y - originY - 1, width: rect.width + 3, height: rect.height + 3 }, draw: target => {
        const bounds = { ...rect, x: rect.x - originX, y: rect.y - originY }
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
    context.save(); context.globalAlpha *= opacity; context.fillStyle = group.style.fill.color; if (plan.vertical) context.fillRect(plan.lines[plan.graphemes[group.graphemes[0]].line].x + plan.lines[plan.graphemes[group.graphemes[0]].line].width * .92, group.baseline, Math.max(1, group.style.fontSize / 24), advance); else context.fillRect(group.x, group.baseline + group.style.fontSize / 12, advance, Math.max(1, group.style.fontSize / 24)); context.restore()
  }
  const { sourceText, box, contentSize, visibleContentSize, overflow, truncated, omittedRanges, totalLines, fit } = plan
  const painted = plan.clusters.map(cluster => cluster.style.fill.enabled || cluster.style.strokes.some(stroke => stroke.enabled && stroke.width))
  ;(context as TextDrawObserverContext)[TEXT_DRAW_OBSERVER]?.({ fontDiagnostics: state.fontDiagnostics, layoutId: state.id, sourceText, box, contentSize, visibleContentSize, inkBounds: actualInk, appearanceBounds: actualAppearance, boundsKind: 'measured', overflow, truncated, omittedRanges, totalLines, fit, actualLines: plan.lines.length, revealComplete: plan.clusters.every(cluster => poses[cluster.owner]), paintKey: JSON.stringify(plan.clusters.map(cluster => cluster.style)), bodyCoverage: !poses.some(Boolean) ? 'none' : painted.every(Boolean) ? 'complete' : painted.some(Boolean) ? 'partial' : 'none', constraint: { x: box.x, y: plan.contentTop, width: state.options.box?.width || state.options.maxWidth, height: state.options.box?.height ?? state.options.maxHeight, maxWidth: state.options.maxWidth, maxHeight: state.options.maxHeight, maxLines: state.options.maxLines } })
}
