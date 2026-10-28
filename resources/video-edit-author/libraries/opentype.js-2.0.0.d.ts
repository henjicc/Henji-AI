// opentype.js 2.0.0 的作者类型声明（MIT，https://github.com/opentypejs/opentype.js）。
// 上游没有随包类型，@types/opentype.js 停在 1.3.x：2.0 去掉了默认导出，load/loadSync 只打印弃用提示。
// 只写代码效果常用的部分；每个类都带索引签名，没列出的成员按 any 处理，不报成错误。

export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' }

export interface RenderOptions {
  script?: string
  language?: string
  kerning?: boolean
  letterSpacing?: number
  tracking?: number
  features?: Record<string, boolean>
  hinting?: boolean
  [key: string]: unknown
}

export interface ParseOptions {
  lowMemory?: boolean
  [key: string]: unknown
}

export class BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
  isEmpty(): boolean
  addPoint(x: number, y: number): void
  addX(x: number): void
  addY(y: number): void
  addBezier(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
  addQuad(x0: number, y0: number, x1: number, y1: number, x: number, y: number): void
  [key: string]: any
}

export class Path {
  constructor()
  commands: PathCommand[]
  fill: string | null
  stroke: string | null
  strokeWidth: number
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
  quadTo(x1: number, y1: number, x: number, y: number): void
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void
  close(): void
  closePath(): void
  extend(pathOrCommands: Path | PathCommand[] | BoundingBox): void
  getBoundingBox(): BoundingBox
  draw(ctx: OffscreenCanvasRenderingContext2D): void
  toPathData(options?: number | { decimalPlaces?: number; optimize?: boolean; flipY?: boolean; flipYBase?: number }): string
  toSVG(options?: number | { decimalPlaces?: number; optimize?: boolean; flipY?: boolean; flipYBase?: number }, pathData?: string): string
  fromSVG(pathData: string, options?: Record<string, unknown>): Path
  [key: string]: any
}

export class Glyph {
  constructor(options: Record<string, unknown>)
  index: number
  name: string | null
  unicode: number | undefined
  unicodes: number[]
  advanceWidth: number | undefined
  leftSideBearing: number | undefined
  xMin: number | undefined
  yMin: number | undefined
  xMax: number | undefined
  yMax: number | undefined
  path: Path
  getPath(x?: number, y?: number, fontSize?: number, options?: RenderOptions, font?: Font): Path
  getBoundingBox(): BoundingBox
  getMetrics(): { xMin: number; yMin: number; xMax: number; yMax: number; leftSideBearing: number; rightSideBearing: number }
  getContours(): Array<Array<{ x: number; y: number; onCurve: boolean }>>
  draw(ctx: OffscreenCanvasRenderingContext2D, x?: number, y?: number, fontSize?: number, options?: RenderOptions, font?: Font): void
  toPathData(options?: Record<string, unknown>, font?: Font): string
  toSVG(options?: Record<string, unknown>, font?: Font): string
  addUnicode(unicode: number): void
  [key: string]: any
}

export interface GlyphSet {
  length: number
  get(index: number): Glyph
  [key: string]: any
}

export class Font {
  constructor(options: { familyName: string; styleName: string; unitsPerEm: number; ascender: number; descender: number; glyphs?: Glyph[]; [key: string]: unknown })
  names: Record<string, Record<string, Record<string, string>>>
  unitsPerEm: number
  ascender: number
  descender: number
  numGlyphs: number
  glyphs: GlyphSet
  tables: Record<string, any>
  outlinesFormat: 'truetype' | 'cff' | string
  hasChar(c: string): boolean
  charToGlyphIndex(s: string): number
  charToGlyph(c: string): Glyph
  stringToGlyphs(s: string, options?: RenderOptions): Glyph[]
  stringToGlyphIndexes(s: string, options?: RenderOptions): number[]
  nameToGlyphIndex(name: string): number
  nameToGlyph(name: string): Glyph | undefined
  glyphIndexToName(gid: number): string
  getKerningValue(leftGlyph: Glyph | number, rightGlyph: Glyph | number): number
  forEachGlyph(text: string, x: number | undefined, y: number | undefined, fontSize: number | undefined, options: RenderOptions | undefined, callback: (glyph: Glyph, x: number, y: number, fontSize: number, options?: RenderOptions) => void): number
  getPath(text: string, x?: number, y?: number, fontSize?: number, options?: RenderOptions): Path
  getPaths(text: string, x?: number, y?: number, fontSize?: number, options?: RenderOptions): Path[]
  getAdvanceWidth(text: string, fontSize?: number, options?: RenderOptions): number
  draw(ctx: OffscreenCanvasRenderingContext2D, text: string, x?: number, y?: number, fontSize?: number, options?: RenderOptions): void
  getEnglishName(name: string): string | undefined
  toArrayBuffer(): ArrayBuffer
  validate(): string[]
  [key: string]: any
}

/** 从字体文件字节解析；2.0 起是读取字体的唯一入口。 */
export function parse(buffer: ArrayBuffer | ArrayBufferView, options?: ParseOptions): Font
/** @deprecated 2.0 只打印弃用提示、不加载字体；请先取得字节再调用 parse。 */
export function load(...args: unknown[]): void
/** @deprecated 2.0 只打印弃用提示、不加载字体；请先取得字节再调用 parse。 */
export function loadSync(...args: unknown[]): void
