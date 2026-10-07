import { CODE_MATERIAL_LIMITS, CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeTextLayout, CodeTextMeasureRequest } from '@/core/videoEdit/codeMaterial/contract'
import { codeFont, layoutCodeText } from '@/core/videoEdit/codeMaterial/textLayout'

export interface VideoEditGlyphMetrics {
  readonly width: number
  readonly height: number
  readonly font: string
  readonly offsetX: number
}

const MAX_WIDTH = 8192
const MAX_PIXELS = 4 * 1024 ** 2
const MAX_CACHE_ENTRIES = 64
const MAX_CACHE_BYTES = 1024 ** 2
const cache = new Map<string, { metrics: VideoEditGlyphMetrics; bytes: number }>()
let cacheBytes = 0
let canvasConstructor: typeof OffscreenCanvas | undefined
let measure: OffscreenCanvasRenderingContext2D | undefined

/** The same real 2D measurement certifies publication and sizes GPU glyphs.
 * Only numeric metrics are cached; this creates no GPU or pixel resources. */
export function measureVideoEditGlyph(text: string, fontSize: number, fontFamily: string): VideoEditGlyphMetrics {
  if (typeof text !== 'string' || text.length > CODE_MATERIAL_LIMITS.stringLength || !Number.isFinite(fontSize) || fontSize < 1 || fontSize > 1024 || !fontFamily.length || fontFamily.length > 200) throw new CodeMaterialError('CONTEXT', '文字、字号或字体不在有效范围内。')
  if (typeof OffscreenCanvas !== 'function') throw new CodeMaterialError('CONTEXT', '当前环境无法测量文字字形，请恢复画面环境后重试。')
  if (canvasConstructor !== OffscreenCanvas) {
    canvasConstructor = OffscreenCanvas; measure = undefined; cache.clear(); cacheBytes = 0
  }
  const key = JSON.stringify([text, fontSize, fontFamily])
  const cached = cache.get(key)
  if (cached) { cache.delete(key); cache.set(key, cached); return cached.metrics }
  if (!measure) {
    const context = new OffscreenCanvas(1, 1).getContext('2d')
    if (!context) throw new CodeMaterialError('CONTEXT', '当前环境无法测量文字字形，请恢复画面环境后重试。')
    measure = context
  }
  measure.font = `${fontSize}px ${fontFamily}`
  const measured = measure.measureText(text)
  if (![measured.width, measured.actualBoundingBoxLeft, measured.actualBoundingBoxRight].every(Number.isFinite) || measured.width < 0) throw new CodeMaterialError('CONTEXT', '文字字形测量结果无效，请恢复画面环境后重试。')
  const width = Math.max(1, Math.ceil(Math.max(measured.width, measured.actualBoundingBoxRight + measured.actualBoundingBoxLeft)) + 4)
  const height = Math.max(1, Math.ceil(fontSize * 1.5) + 4)
  if (width > MAX_WIDTH || width * height > MAX_PIXELS) throw new CodeMaterialError('BUDGET', '标题字形超出8192宽或四百万像素，请缩短文字或减小字号。')
  const metrics: VideoEditGlyphMetrics = Object.freeze({ width, height, font: measure.font, offsetX: 2 + Math.max(0, measured.actualBoundingBoxLeft) })
  const bytes = key.length * 2 + 96
  while (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + bytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest)
  }
  cache.set(key, { metrics, bytes }); cacheBytes += bytes
  return metrics
}

const layouts = new Map<string, { layout: CodeTextLayout; bytes: number }>(); let layoutBytes = 0
let fontGeneration = 0
/** t63 calls this after loading/importing fonts; missing-font results must never survive a font-set change. */
export function invalidateCodeTextMetrics(): void { fontGeneration++; layouts.clear(); layoutBytes = 0; cache.clear(); cacheBytes = 0 }
export function measureCodeText(request: CodeTextMeasureRequest): CodeTextLayout {
  if (typeof OffscreenCanvas !== 'function') throw new CodeMaterialError('CONTEXT', '当前环境无法测量文字字形。')
  if (canvasConstructor !== OffscreenCanvas) { invalidateCodeTextMetrics(); canvasConstructor = OffscreenCanvas; measure = undefined }
  const key = JSON.stringify(request); const cached = layouts.get(key)
  if (cached) { layouts.delete(key); layouts.set(key, cached); return cached.layout }
  measure ??= new OffscreenCanvas(1, 1).getContext('2d') ?? undefined
  if (!measure) throw new CodeMaterialError('CONTEXT', '无法获取字体度量环境。')
  const context = measure
  const advance = (text: string, font: string): number => { context.font = font; return context.measureText(text).width }
  let missingFont: string | undefined
  if (!['sans-serif', 'serif', 'monospace'].includes(request.fontFamily)) {
    const base = codeFont(request).replace(/, sans-serif$/, '')
    // Canvas resolves installed and imported fonts; a missing face follows both different generic fallbacks.
    const probe = 'mmmmmmWWWWii汉字'
    if (Math.abs(advance(probe, `${base}, serif`) - advance(probe, `${base}, sans-serif`)) > .001) missingFont = request.fontFamily
  }
  const layout = layoutCodeText(missingFont ? { ...request, fontFamily: 'sans-serif' } : request, advance, missingFont)
  // The glyph raster cache also sees this generation, including font changes with identical advance widths.
  layout.fontGeneration = fontGeneration
  context.font = layout.font
  const metrics = context.measureText('Hg汉')
  const ascent = metrics.fontBoundingBoxAscent; const descent = metrics.fontBoundingBoxDescent
  if (Number.isFinite(ascent) && Number.isFinite(descent)) layout.baselineOffset = (layout.fontSize * request.lineHeight - ascent - descent) / 2 + ascent
  if (layout.width > 8192 || layout.width * layout.height > MAX_PIXELS) throw new CodeMaterialError('BUDGET', '文字字形超出8192宽或四百万像素。')
  const bytes = key.length * 2 + layout.glyphs.length * 64 + 256
  while (layouts.size && (layouts.size >= 128 || layoutBytes + bytes > MAX_CACHE_BYTES)) { const oldest = layouts.keys().next().value!; layoutBytes -= layouts.get(oldest)!.bytes; layouts.delete(oldest) }
  layouts.set(key, { layout, bytes }); layoutBytes += bytes
  return layout
}
