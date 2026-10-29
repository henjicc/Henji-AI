import type { z } from 'zod'
import { textStyleSchema } from '../../../core/imaging/vectorContent/text'
import type { RichTextContent } from '../../../core/imaging/vectorContent/contracts'
import { createTextDrawPlan, type TextDrawConstraints, type TextDrawPlan } from '../../../core/imaging/vectorContent/textDrawPlan'
import { canvasTextPlanMeasure, paintTextDrawPlan } from '../../../core/imaging/vectorContent/textDrawPlanCanvas'
import { paintVectorAppearance } from '../../../services/vectorContent/appearance'
import { parseTextInput, validateTextOptions } from './validation'
import { createGraphemeAtlas, paintGraphemeAtlas, type GraphemeAtlas, type AtlasCell } from './textGraphemeAtlas'
import { TEXT_DRAW_OBSERVER, TEXT_RASTER_CONTEXT, TEXT_LAYOUT_OBSERVER, TEXT_BITMAP_RESTORE, type TextLayoutObserverGlobal, type RestorableTextBitmap, type TextDrawFact, type TextDrawObserverContext, type TextRasterProvider } from '../../../core/videoEdit/textDrawObservation'

type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> }
export type TextStyleInput = DeepReadonly<z.input<typeof textStyleSchema>>
/** maxWidth、wrapWidth 为 0 时不设对应宽度限制；box.width 为 0 与省略相同；maxHeight 为 0 默认截断所有行。 */
export type TextOptions = Pick<TextDrawConstraints, 'maxWidth' | 'maxHeight' | 'maxLines' | 'fit' | 'wrap' | 'wrapWidth' | 'anchor' | 'box' | 'frame' | 'direction' | 'truncate' | 'forceGraphemes'>
export type TextLayout = DeepReadonly<Omit<TextDrawPlan, 'batches' | 'rasterBounds'>>
/** x/y 是相对排版位置的像素偏移；scale 围绕字素基线起点缩放，rotate 为弧度；opacity 为 0..1。 */
export interface GraphemePose { x?: number; y?: number; scale?: number; rotate?: number; opacity?: number }
/**
 * graphemes 为前 N 个字素、索引集合或逐字动画回调（null 表示隐藏）。
 * 字素模式独立栅格化字素簇，会失去字素之间的连写与字距塑形；整段静态绘制保留原生塑形。
 * 先画整段底板，再画所有字素的阴影/外描边、填色及其内/居中描边，最后画整段装饰线；上下层共用姿态。
 * 图集最低 2×（纹理尺寸超限仍会降档）；有 graphemes 的调用全程使用图集，落定时不切换抗锯齿路径。
 * 回调针对实际排出的字素；截断遗漏仍属于整段布局事实，不需要为遗漏字符构造动画。
 */
export interface TextDrawOptions {
  graphemes?: number | readonly number[] | ((grapheme: TextLayout['graphemes'][number], index: number) => GraphemePose | null)
  /** 字素模式的整段底板与装饰线透明度（0..1）；默认首个字素可见就整段出现，不随字移动或逐字切分。 */
  backgroundAndDecorationOpacity?: number
}
export type { RichTextContent }

interface LayoutState {
  plan: TextDrawPlan
  constraint: TextDrawFact['constraint']
  id: string
  bitmaps: Map<string, RasterEntry>
  atlas?: GraphemeAtlas
  fact?: TextDrawFact
}
interface RasterEntry { key: string; image: ImageBitmap; pixels: number }
// 布局按内容限量持有，位图另按总像素预算淘汰；用户仍持有的布局可在下次绘制时恢复。
const layouts = new WeakMap<TextLayout, LayoutState>()
const recentLayouts = new Map<string, TextLayout>()
const rasterStates = new Map<RasterEntry, LayoutState>()
const MAX_LAYOUTS = 128, MAX_RASTER_PIXELS = 32 * 1024 * 1024, MAX_RASTER_EDGE = 8192
let rasterPixels = 0, nextLayout = 0
// 同一源码可冻结为多个版本，模块实例序号保证全局观察通道不会把它们的布局混在一起。
const instanceKey = Symbol.for('henji-layout.text.module-instance')
const instances = globalThis as typeof globalThis & { [instanceKey]?: number }
const instanceId = instances[instanceKey] = (instances[instanceKey] ?? 0) + 1
let measurement: OffscreenCanvasRenderingContext2D | undefined
let canvasType: typeof OffscreenCanvas | undefined
// Worker 类型库未列出 FontFaceSet 的增删方法，运行时仍需按存在性选择观察或快照。
type MutableFontSet = FontFaceSet & { add(face: FontFace): MutableFontSet; delete(face: FontFace): boolean; clear(): void; has(face: FontFace): boolean; readonly size: number }
let fontSet: MutableFontSet | undefined, fontGeneration = 0, nextFont = 0
let unwatchFonts: (() => void) | undefined, fontEvents = false
const fontIds = new WeakMap<FontFace, number>()
const fontsChanged = (): void => { fontGeneration++ }
function fontKey(): string {
  const current = (globalThis as typeof globalThis & { fonts?: MutableFontSet }).fonts
  if (current !== fontSet) {
    unwatchFonts?.(); unwatchFonts = undefined
    fontSet = current; fontGeneration++
    fontEvents = false
    current?.addEventListener?.('loadingdone', fontsChanged); current?.addEventListener?.('loadingerror', fontsChanged)
    unwatchFonts = () => { current?.removeEventListener?.('loadingdone', fontsChanged); current?.removeEventListener?.('loadingerror', fontsChanged) }
    if (typeof current?.addEventListener === 'function' && typeof current.add === 'function' && typeof current.delete === 'function' && typeof current.clear === 'function') {
      const { add, delete: remove, clear } = current
      const addFace: MutableFontSet['add'] = function(this: MutableFontSet, face) { const had = this.has(face); const result = add.call(this, face); if (!had) fontsChanged(); return result }
      const deleteFace: MutableFontSet['delete'] = function(this: MutableFontSet, face) { const result = remove.call(this, face); if (result) fontsChanged(); return result }
      const clearFaces: MutableFontSet['clear'] = function(this: MutableFontSet) { const had = this.size > 0; clear.call(this); if (had) fontsChanged() }
      try {
        current.add = addFace; current.delete = deleteFace; current.clear = clearFaces
        fontEvents = true
      } catch { /* 无法观察增删的宿主使用完整字体快照。 */ }
      unwatchFonts = () => {
        if (current.add === addFace) current.add = add
        if (current.delete === deleteFace) current.delete = remove
        if (current.clear === clearFaces) current.clear = clear
        current.removeEventListener('loadingdone', fontsChanged); current.removeEventListener('loadingerror', fontsChanged)
      }
    }
  }
  if (fontEvents) return String(fontGeneration)
  const entries: string[] = []
  // 已加载 FontFace 的 add/delete 不一定触发 loadingdone，身份和状态也必须进入代次键。
  fontSet?.forEach(face => {
    let id = fontIds.get(face); if (id === undefined) fontIds.set(face, id = ++nextFont)
    const descriptors = face as unknown as Record<string, unknown>
    entries.push(JSON.stringify([id, ...['status', 'family', 'style', 'weight', 'stretch', 'unicodeRange', 'featureSettings', 'variationSettings', 'ascentOverride', 'descentOverride', 'lineGapOverride'].map(key => descriptors[key])]))
  })
  return `${fontGeneration}:${entries.join('|')}`
}
function closeRaster(state: LayoutState, entry?: RasterEntry): void {
  for (const bitmap of entry ? [entry] : state.bitmaps.values()) {
    rasterPixels -= bitmap.pixels
    bitmap.image.close(); state.bitmaps.delete(bitmap.key); rasterStates.delete(bitmap)
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value)
  }
  return value
}
const stableKey = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const observeLayout = (state: LayoutState): void => (globalThis as TextLayoutObserverGlobal)[TEXT_LAYOUT_OBSERVER]?.(state.id)

/** 同内容、样式、选项和字体代次复用深度冻结的布局；最多保留最近 128 个。 */
export function layoutText(text: string | RichTextContent, style: TextStyleInput = {}, options: TextOptions = {}): TextLayout {
  validateTextOptions(options)
  const parsed = parseTextInput(text, style)
  if (canvasType !== OffscreenCanvas) {
    for (const [entry, state] of rasterStates) closeRaster(state, entry)
    recentLayouts.clear(); measurement = undefined; canvasType = OffscreenCanvas
  }
  const styles = new Map<object, number>()
  const sharing = typeof parsed.content === 'string' ? undefined : parsed.content.paragraphs.map(paragraph => paragraph.runs.map(run => {
    if (!styles.has(run.style)) styles.set(run.style, styles.size)
    return styles.get(run.style)
  }))
  const key = stableKey([parsed.content, parsed.style, options, fontKey(), sharing])
  const held = recentLayouts.get(key)
  if (held) { recentLayouts.delete(key); recentLayouts.set(key, held); observeLayout(layouts.get(held)!); return held }
  measurement ??= new OffscreenCanvas(1, 1).getContext('2d') ?? undefined
  if (!measurement) throw new Error('文字排版需要 Worker 的 OffscreenCanvas 2D 上下文。')
  const plan = createTextDrawPlan(parsed.content, parsed.style, {
    ...options,
    maxWidth: options.maxWidth === 0 ? undefined : options.maxWidth,
    wrapWidth: options.wrapWidth ?? options.maxWidth,
    box: options.box && { ...options.box, width: options.box.width === 0 ? undefined : options.box.width },
  }, canvasTextPlanMeasure(measurement))
  const { batches: _batches, rasterBounds: _rasterBounds, ...layout } = plan
  const richBox = typeof parsed.content === 'string' ? undefined : parsed.content.box
  const fixedWidth = options.box?.width || (plan.style.boxWidth || richBox?.width ? plan.box.width : undefined)
  const fixedHeight = options.box?.height ?? (plan.style.boxHeight || richBox?.height ? plan.box.height : undefined)
  // 放置框和容量限制可能不同；居中排在大框里的文字不能被小的 maxWidth 当成从左边起的裁切。
  layouts.set(layout, { plan, bitmaps: new Map(), id: `text:${instanceId}:${++nextLayout}`, constraint: { x: plan.box.x, y: fixedHeight === undefined ? plan.contentTop : plan.box.y, width: fixedWidth ?? (options.maxWidth || undefined), height: fixedHeight ?? options.maxHeight, maxWidth: options.maxWidth || undefined, maxHeight: options.maxHeight, maxLines: options.maxLines } })
  freeze(layout)
  recentLayouts.set(key, layout)
  if (recentLayouts.size > MAX_LAYOUTS) {
    const oldest = recentLayouts.keys().next().value!
    closeRaster(layouts.get(recentLayouts.get(oldest)!)!); recentLayouts.delete(oldest)
  }
  observeLayout(layouts.get(layout)!)
  return layout
}

/**
 * 设备缩放按 1×/2×/4× 栅格化，单边 8192、面积 32M 像素以内，超大布局继续降档。
 * 同一布局最多保留 4 个档位/颜色空间/绘制模式的位图；LRU 淘汰会关闭位图。
 */
export function drawText(context: OffscreenCanvasRenderingContext2D, layout: TextLayout, options: TextDrawOptions = {}): void {
  const state = layouts.get(layout)
  if (!state) throw new Error('drawText 需要同一库版本 layoutText 返回的原始布局对象。')
  const { plan } = state
  const selection = options.graphemes
  if (typeof selection === 'number' && (!Number.isFinite(selection) || selection < 0)) throw new Error('graphemes 必须为非负有限字素数量。')
  if (Array.isArray(selection) && selection.some(index => !Number.isInteger(index) || index < 0 || index >= plan.graphemes.length)) throw new Error('graphemes 索引必须在布局的字素范围内。')
  const indices = Array.isArray(selection) ? new Set(selection) : undefined
  const poses = selection === undefined ? undefined : plan.graphemes.map((_g, i): GraphemePose | null => {
    const pose = typeof selection === 'function' ? selection(layout.graphemes[i], i) : (typeof selection === 'number' ? i < Math.floor(selection) : indices!.has(i)) ? {} : null
    if (pose && Object.values(pose).some(value => !Number.isFinite(value))) throw new Error('字素动画参数必须为有限数值。')
    return pose && (pose.opacity ?? 1) > 0 ? pose : null
  })
  const complete = !poses || poses.every(Boolean)
  const blockOpacity = options.backgroundAndDecorationOpacity ?? (poses && !poses.some(Boolean) ? 0 : 1)
  if (!Number.isFinite(blockOpacity) || blockOpacity < 0 || blockOpacity > 1) throw new Error('backgroundAndDecorationOpacity 必须在 0..1 之间。')
  // 逐字与整段路径的塑形、对齐和分辨率不同；揭示落定仍沿用图集，避免一次性改变所有字的边缘。
  if (poses && !state.atlas) state.atlas = createGraphemeAtlas(plan, canvasTextPlanMeasure(measurement!))
  const atlas = poses ? state.atlas : undefined
  const settled = !!poses && complete && poses.every(pose => pose && !(pose.x ?? 0) && !(pose.y ?? 0) && (pose.scale ?? 1) === 1 && !(pose.rotate ?? 0) && Math.min(1, pose.opacity ?? 1) === 1)
  let settledInk: TextDrawFact['inkBounds'] = null
  const rasterContext = context as OffscreenCanvasRenderingContext2D & TextRasterProvider
  const bounds = atlas ?? plan.rasterBounds
  if (bounds.width && bounds.height && (!poses || poses.some(Boolean) || blockOpacity > 0)) {
    const physical = rasterContext[TEXT_RASTER_CONTEXT]?.()
    const transform = physical ? undefined : context.getTransform()
    const [a, b, c, d, e, f] = physical?.matrix ?? [transform!.a, transform!.b, transform!.c, transform!.d, transform!.e, transform!.f]
    const scale = (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c)) / 2 * Math.max(1, ...poses?.map(pose => Math.abs(pose?.scale ?? 1)) ?? [])
    let resolution = scale > 2 + 1e-9 ? 4 : scale > 1 + 1e-9 || atlas ? 2 : 1
    const fits = (): boolean => Math.ceil(bounds.width * resolution) <= MAX_RASTER_EDGE && Math.ceil(bounds.height * resolution) <= MAX_RASTER_EDGE && Math.ceil(bounds.width * resolution) * Math.ceil(bounds.height * resolution) <= MAX_RASTER_PIXELS
    while (!fits()) resolution /= 2
    const colorSpace = physical?.colorSpace ?? rasterContext.getContextAttributes?.().colorSpace ?? 'srgb'
    const key = `${resolution}:${colorSpace}:${atlas ? 'atlas' : 'all'}`
    const width = Math.max(1, Math.ceil(bounds.width * resolution)), height = Math.max(1, Math.ceil(bounds.height * resolution))
    const bitmap = raster(state, key, width, height, resolution, colorSpace, atlas)
    if (atlas && poses) {
      const drawCell = (cell: AtlasCell): void => context.drawImage(bitmap, cell.x * resolution, cell.y * resolution, cell.width * resolution, cell.height * resolution, cell.offsetX, cell.offsetY, cell.width, cell.height)
      const drawBlock = (cell?: AtlasCell): void => {
        if (!cell || !blockOpacity) return
        context.save(); context.globalAlpha *= blockOpacity; drawCell(cell); context.restore()
      }
      drawBlock(atlas.background)
      const placed = atlas.glyphs.map((glyph, i) => {
        const g = plan.graphemes[i]
        let x = g.x!, y = g.baseline
        // 在最终设备坐标取整，再施加作者位移；墨迹证据与实际绘制共用这份定位。
        const determinant = a * d - b * c
        if (Math.abs(determinant) > 1e-12) {
          const left = x + glyph.fill.offsetX, top = y + glyph.fill.offsetY
          const px = a * left + c * top + e, py = b * left + d * top + f
          const dx = Math.round(px) - px, dy = Math.round(py) - py
          x += (d * dx - c * dy) / determinant; y += (a * dy - b * dx) / determinant
        }
        return { glyph, x, y }
      })
      if (settled) {
        const include = (rect: NonNullable<TextDrawFact['inkBounds']>): void => {
          if (!settledInk) { settledInk = rect; return }
          const x = Math.min(settledInk.x, rect.x), y = Math.min(settledInk.y, rect.y)
          settledInk = { x, y, width: Math.max(settledInk.x + settledInk.width, rect.x + rect.width) - x, height: Math.max(settledInk.y + settledInk.height, rect.y + rect.height) - y }
        }
        for (const { glyph, x, y } of placed) {
          const ink = glyph.fill.plan.inkBounds, bounds = glyph.fill.plan.rasterBounds
          if (ink) include({ ...ink, x: x + glyph.fill.offsetX + ink.x - bounds.x, y: y + glyph.fill.offsetY + ink.y - bounds.y })
        }
        if (blockOpacity > 0) for (const batch of plan.batches) for (const row of batch.rows) if (row.underline) include(row.underline)
      }
      for (const part of ['underlay', 'fill'] as const) {
        for (const [i, { glyph, x, y }] of placed.entries()) {
          const pose = poses[i]
          if (!pose) continue
          context.save()
          context.globalAlpha *= Math.min(1, pose.opacity ?? 1)
          context.translate(x + (pose.x ?? 0), y + (pose.y ?? 0))
          context.rotate(pose.rotate ?? 0); context.scale(pose.scale ?? 1, pose.scale ?? 1)
          drawCell(glyph[part]); context.restore()
        }
      }
      drawBlock(atlas.decoration)
    } else context.drawImage(bitmap, plan.rasterBounds.x, plan.rasterBounds.y, width / resolution, height / resolution)
  }
  const observe = (context as OffscreenCanvasRenderingContext2D & TextDrawObserverContext)[TEXT_DRAW_OBSERVER]
  if (observe && !state.fact) {
    const { sourceText, box, contentSize, visibleContentSize, inkBounds, appearanceBounds, boundsKind, overflow, truncated, omittedRanges, totalLines, fit } = plan
    const painted = (style: TextDrawPlan['style']): boolean => style.fill.enabled || style.strokes.some(stroke => stroke.enabled && stroke.width > 0)
    const bodies = plan.groups.map(group => painted(group.style))
    const bodyCoverage = bodies.length ? bodies.every(Boolean) ? 'complete' : bodies.some(Boolean) ? 'partial' : 'none' : painted(plan.style) ? 'complete' : 'none'
    state.fact = { layoutId: state.id, sourceText, box, constraint: state.constraint, contentSize, visibleContentSize, inkBounds, appearanceBounds, boundsKind, overflow, truncated, omittedRanges, totalLines, fit, actualLines: plan.lines.length, bodyCoverage, paintKey: JSON.stringify([plan.style, plan.groups.map(group => group.style)]) }
  }
  // 全部行被截断或揭示尚未开始也要上报这次绘制，不能把它误当成未调用 drawText。
  if (observe) observe({ ...state.fact!, revealComplete: complete, ...(atlas ? settled ? { inkBounds: settledInk, boundsKind: atlas.glyphs.every(glyph => glyph.fill.plan.boundsKind === 'measured') ? 'measured' : 'estimated' } : { animatedGraphemes: true } : {}) })
}

function raster(state: LayoutState, key: string, width: number, height: number, resolution: number, colorSpace: 'srgb' | 'display-p3', atlas?: GraphemeAtlas): ImageBitmap {
  let entry = state.bitmaps.get(key)
  if (!entry) {
    const pixels = width * height
    if (state.bitmaps.size >= 4) closeRaster(state, state.bitmaps.values().next().value!)
    for (const [held, owner] of rasterStates) { if (rasterStates.size < MAX_LAYOUTS * 4 && rasterPixels + pixels <= MAX_RASTER_PIXELS) break; closeRaster(owner, held) }
    const canvas = new OffscreenCanvas(width, height), target = canvas.getContext('2d', { colorSpace })!
    if (atlas) paintGraphemeAtlas(target, atlas, resolution, colorSpace)
    else {
      target.scale(resolution, resolution)
      paintTextDrawPlan(target, state.plan, { width: width / resolution, height: height / resolution, resolution, x: -state.plan.rasterBounds.x, y: -state.plan.rasterBounds.y }, paintVectorAppearance)
    }
    const image: RestorableTextBitmap<ImageBitmap> = canvas.transferToImageBitmap()
    // 录制保留原规格；仅缓存被淘汰后才恢复，正常逐帧重放直接沿用图集身份。
    image[TEXT_BITMAP_RESTORE] = () => raster(state, key, width, height, resolution, colorSpace, atlas)
    entry = { key, image, pixels }; rasterPixels += pixels
  }
  state.bitmaps.delete(key); state.bitmaps.set(key, entry)
  rasterStates.delete(entry); rasterStates.set(entry, state)
  return entry.image
}
