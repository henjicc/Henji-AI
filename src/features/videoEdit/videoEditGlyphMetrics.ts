import { CODE_MATERIAL_LIMITS, CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'

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
  if (typeof text !== 'string' || text.length > CODE_MATERIAL_LIMITS.stringLength || !Number.isFinite(fontSize) || fontSize < 1 || fontSize > 1024 || !['sans-serif', 'serif', 'monospace'].includes(fontFamily)) throw new CodeMaterialError('CONTEXT', '文字、字号或字体不在有效范围内。')
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
