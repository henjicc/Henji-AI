import type * as HarfBuzz from '../../../../../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'

export type HarfBuzzModule = typeof HarfBuzz
export interface TextOutline { readonly identity: string; readonly svg: string }
export interface FontSource { hash: string; bytes: ArrayBuffer; face?: number; variations?: Readonly<Record<string, number>> }
export interface ShapeOptions {
  size: number
  language?: string
  script?: string
  /** ttb 只用于竖排里直立的字；竖排里旋转的拉丁文仍按 ltr 整形，由放置阶段转 90 度。 */
  direction?: 'ltr' | 'rtl' | 'ttb'
  ligatures?: boolean
  features?: Readonly<Record<string, number>>
  axes?: Readonly<Record<string, number>>
  featureRanges?: readonly { tag: string; value: number; start: number; end: number }[]
}
export interface ShapedGlyph {
  id: number; cluster: number; flags: number
  advance: number; xOffset: number; yOffset: number
  run?: number
}
export interface ShapeResult { glyphs: readonly ShapedGlyph[]; width: number }
export const orderedValues = (values: Readonly<Record<string, number>> = {}): Array<[string, number]> => Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
export function shapingKey(options: ShapeOptions): string {
  return JSON.stringify([options.size, options.language ?? 'zh-CN', options.script, options.direction ?? 'ltr', options.ligatures ?? false, orderedValues(options.features), orderedValues(options.axes), options.featureRanges])
}

interface SharedBlob { hash: string; blob: HarfBuzz.Blob; references: number }
interface SharedFace { face: HarfBuzz.Face; blob: SharedBlob; references: number }
interface SharedFont { font: HarfBuzz.Font; references: number }
interface FontPool {
  blobs: Map<string, SharedBlob>
  faces: Map<string, SharedFace>
  fonts: Map<string, SharedFont>
}
// 冻结库各有 wasm 运行时；同一运行时的内容对象由会话共同 pin，最后一个引用释放时销毁。
const pools = new WeakMap<HarfBuzzModule, FontPool>()

/** Font 只在发布前设置坐标与轴；布局保留数值，不把原生对象交给作者。 */
export class TextShaper {
  private readonly faces = new Map<string, SharedFace>()
  private readonly fonts = new Map<string, SharedFont>()
  private readonly pool: FontPool
  private readonly outlines = new Map<string, TextOutline>()
  private outlineBytes = 0
  private disposed = false
  constructor(private readonly hb: HarfBuzzModule) {
    let pool = pools.get(hb)
    if (!pool) { pool = { blobs: new Map(), faces: new Map(), fonts: new Map() }; pools.set(hb, pool) }
    this.pool = pool
  }

  /** 彩色字体的基底轮廓可能只是分层占位，不能当作最终 emoji 画面。 */
  isColorGlyph(source: FontSource, glyph: number, axes?: Readonly<Record<string, number>>): boolean {
    const face = this.font(source, axes).face
    return face.hasColorPng() || face.glyphHasColorPaint(glyph) || face.getGlyphColorLayers(glyph).length > 0
  }

  /** 字形路径以字体原始坐标保存，字号与位姿由绘制矩阵表达，共享不可变轮廓。 */
  outlineShape(source: FontSource, glyph: number, axes?: Readonly<Record<string, number>>): TextOutline {
    if (this.disposed) throw new Error('文字字体会话已经关闭')
    const identity = JSON.stringify(['font-outline', this.hb.versionString(), source.hash, source.face ?? 0, glyph, orderedValues({ ...source.variations, ...axes })])
    let path = this.outlines.get(identity)
    if (path) this.outlines.delete(identity)
    else { path = Object.freeze({ svg: this.outline(source, glyph, axes), identity }); this.outlineBytes += (path.svg.length + identity.length) * 2 }
    this.outlines.set(identity, path)
    // 软预算只回收可重建缓存，布局持有的轮廓仍有效。
    while (this.outlineBytes > 4 * 1024 * 1024 && this.outlines.size > 1) {
      const [key, oldest] = this.outlines.entries().next().value!
      this.outlines.delete(key); this.outlineBytes -= (oldest.svg.length + key.length) * 2
    }
    return path
  }

  private font(source: FontSource, axes?: Readonly<Record<string, number>>): HarfBuzz.Font {
    if (this.disposed) throw new Error('文字字体会话已经关闭')
    const faceKey = JSON.stringify([source.hash, source.face ?? 0])
    let entry = this.faces.get(faceKey)
    if (!entry) {
      entry = this.pool.faces.get(faceKey)
      if (!entry) {
        let blob = this.pool.blobs.get(source.hash)
        if (!blob) { blob = { hash: source.hash, blob: new this.hb.Blob(source.bytes), references: 0 }; this.pool.blobs.set(source.hash, blob) }
        try {
          entry = { blob, face: new this.hb.Face(blob.blob, source.face ?? 0), references: 0 }
          blob.references++; this.pool.faces.set(faceKey, entry)
        } catch (error) {
          if (!blob.references) { blob.blob.dispose(); this.pool.blobs.delete(source.hash) }
          throw error
        }
      }
      entry.references++; this.faces.set(faceKey, entry)
    }
    const key = JSON.stringify([faceKey, orderedValues({ ...source.variations, ...axes })])
    let font = this.fonts.get(key)
    if (!font) {
      font = this.pool.fonts.get(key)
      if (!font) {
        const native = new this.hb.Font(entry.face)
        try {
          native.setScale(entry.face.upem, entry.face.upem)
          native.setVariations(orderedValues({ ...source.variations, ...axes }).map(([tag, value]) => new this.hb.Variation(tag, value)))
        } catch (error) { native.dispose(); throw error }
        font = { font: native, references: 0 }; this.pool.fonts.set(key, font)
      }
      font.references++; this.fonts.set(key, font)
    }
    return font.font
  }

  shape(source: FontSource, text: string, options: ShapeOptions, start = 0, end = text.length): ShapeResult {
    if (!Number.isFinite(options.size) || options.size <= 0) throw new Error('字号必须是正数')
    const font = this.font(source, options.axes), buffer = new this.hb.Buffer()
    try {
      buffer.addText(text, start, end - start)
      buffer.setLanguage(options.language ?? 'zh-CN')
      if (options.script) buffer.setScript(options.script)
      buffer.setDirection(options.direction === 'ttb' ? this.hb.Direction.TTB : options.direction === 'rtl' ? this.hb.Direction.RTL : this.hb.Direction.LTR)
      buffer.setClusterLevel(this.hb.ClusterLevel.MONOTONE_GRAPHEMES)
      buffer.setFlags(this.hb.BufferFlag.PRODUCE_UNSAFE_TO_CONCAT | this.hb.BufferFlag.BOT | this.hb.BufferFlag.EOT)
      buffer.guessSegmentProperties()
      // 连字选项是几何的唯一开关，不能被通用 features 或 draw 时的揭示模式覆盖。
      const features = { ...options.features, liga: options.ligatures ? 1 : 0, clig: options.ligatures ? 1 : 0 }
      this.hb.shape(font, buffer, [
        ...orderedValues(features).map(([tag, value]) => new this.hb.Feature(tag, value)),
        ...(options.featureRanges ?? []).filter(feature => feature.tag !== 'liga' && feature.tag !== 'clig').map(feature => new this.hb.Feature(feature.tag, feature.value, feature.start, feature.end)),
      ])
      const scale = options.size / font.face.upem
      const positions = buffer.getGlyphPositions()
      const glyphs = buffer.getGlyphInfos().map((info, index) => ({
        id: info.codepoint, cluster: info.cluster, flags: info.flags,
        // 段落只认行内方向的推进；竖排时它就是向下走的距离。
        advance: (options.direction === 'ttb' ? -positions[index].yAdvance : positions[index].xAdvance) * scale,
        xOffset: positions[index].xOffset * scale, yOffset: positions[index].yOffset * scale,
      }))
      return { glyphs, width: glyphs.reduce((sum, glyph) => sum + glyph.advance, 0) }
    } finally { buffer.dispose() }
  }

  extents(source: FontSource, glyph: number, options: ShapeOptions): { left: number; right: number } | undefined {
    const font = this.font(source, options.axes), extents = font.glyphExtents(glyph)
    if (!extents) return undefined
    const scale = options.size / font.face.upem
    return { left: extents.xBearing * scale, right: (extents.xBearing + extents.width) * scale }
  }
  outline(source: FontSource, glyph: number, axes?: Readonly<Record<string, number>>): string {
    return this.font(source, axes).glyphToPath(glyph)
  }
  metrics(source: FontSource, options: ShapeOptions): { ascent: number; descent: number; scale: number } {
    const font = this.font(source, options.axes), extents = font.hExtents(), scale = options.size / font.face.upem
    return { ascent: extents.ascender * scale, descent: -extents.descender * scale, scale }
  }
  ink(source: FontSource, glyph: number, options: ShapeOptions): { x: number; y: number; width: number; height: number } | null {
    const font = this.font(source, options.axes), bounds = font.glyphExtents(glyph), scale = options.size / font.face.upem
    return bounds && bounds.width && bounds.height ? { x: bounds.xBearing * scale, y: -bounds.yBearing * scale, width: bounds.width * scale, height: -bounds.height * scale } : null
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [key, entry] of this.fonts) if (--entry.references === 0) { entry.font.dispose(); this.pool.fonts.delete(key) }
    for (const [key, entry] of this.faces) if (--entry.references === 0) {
      entry.face.dispose(); this.pool.faces.delete(key)
      if (--entry.blob.references === 0) {
        entry.blob.blob.dispose()
        this.pool.blobs.delete(entry.blob.hash)
      }
    }
    this.fonts.clear(); this.faces.clear(); this.outlines.clear(); this.outlineBytes = 0
  }
}
