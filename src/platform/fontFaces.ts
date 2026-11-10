import type { FontPayload } from './fonts'
import { fontMatchesName, resolveFontVariations, type FontFaceInfo } from '../core/fonts/catalog'
import { setTextVariationFamilyResolver } from '../core/imaging/vectorContent/metrics'
import type { TextStyle } from '../core/imaging/vectorContent/text'
let documentRevision = 0
type VariationRequest = Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'fontVariations'>
/** 本线程里所有已加载字体集；Canvas 文字按样式里的轴数值向它们要变体字体名。 */
const liveFaceSets = new Set<LoadedFontFaces>()
setTextVariationFamilyResolver(style => { for (const set of liveFaceSets) { const family = set.variationFamily(style); if (family) return family } return undefined })
/** 变体字体各自复制一份字体字节；动画逐帧产生新坐标，按字节预算淘汰最久未用的。 */
const VARIATION_BUDGET_BYTES = 256 * 1024 * 1024
let variationSerial = 0
/** Shared by document.fonts and WorkerGlobalScope.fonts. No PAL calls inside the worker. */
export class LoadedFontFaces {
  private readonly loaded = new Map<string, { faces: FontFace[]; bytes: number; info: FontFaceInfo; source: ArrayBuffer }>()
  private readonly variations = new Map<string, { family: string; face: FontFace; faceId: string; bytes: number }>()
  private readonly pending = new Map<string, Promise<void>>()
  private generation = 0
  private allowedIds?: Set<string>
  private pinnedIds = new Set<string>()
  constructor(private readonly fonts: FontFaceSet, private readonly cacheBudget = Infinity, private readonly onChange: () => void = () => undefined) { liveFaceSets.add(this) }
  private changed(): void { documentRevision++; this.onChange() }
  /**
   * 按家族名或完整字形名找到已加载的样式，与浏览器同样按字重、斜体就近匹配；轴坐标 = 命名实例坐标 + 样式覆盖。
   * 字节已在内存，FontFace 同步解析完成，同一帧就能用它量字和绘制。
   */
  variationFamily(style: VariationRequest): string | undefined {
    const name = style.fontFamily.trim().toLocaleLowerCase()
    const candidates = [...this.loaded.values()].filter(entry => fontMatchesName(entry.info, style.fontFamily))
    const italic = style.fontStyle !== 'normal'
    const entry = candidates.find(value => value.info.fullName.toLocaleLowerCase() === name || value.info.postscriptName.toLocaleLowerCase() === name)
      ?? candidates.sort((a, b) => Math.abs(a.info.weight - style.fontWeight) + Number(a.info.italic !== italic) * 1000 - Math.abs(b.info.weight - style.fontWeight) - Number(b.info.italic !== italic) * 1000)[0]
    const coordinates = entry && resolveFontVariations(entry.info, style.fontVariations)
    if (!entry || !coordinates) return undefined
    const settings = Object.entries(coordinates).sort(([a], [b]) => a.localeCompare(b)).map(([axis, value]) => `"${axis}" ${Math.round(value * 1000) / 1000}`).join(', ')
    const key = JSON.stringify([entry.info.id, settings, style.fontWeight, style.fontStyle])
    const existing = this.variations.get(key)
    if (existing) { this.variations.delete(key); this.variations.set(key, existing); return existing.family }
    const family = `henji-variation-${++variationSerial}`
    // TypeScript 的 DOM 声明还没有 variationSettings；Chromium 支持这个描述符。
    const descriptors: FontFaceDescriptors & { variationSettings: string } = { weight: String(style.fontWeight), style: style.fontStyle, variationSettings: settings }
    const face = new FontFace(family, entry.source, descriptors)
    this.fonts.add(face)
    this.variations.set(key, { family, face, faceId: entry.info.id, bytes: entry.source.byteLength })
    let bytes = [...this.variations.values()].reduce((sum, value) => sum + value.bytes, 0)
    for (const [oldKey, value] of this.variations) {
      if (bytes <= VARIATION_BUDGET_BYTES || oldKey === key) break
      this.fonts.delete(value.face); this.variations.delete(oldKey); bytes -= value.bytes
    }
    return family
  }
  private dropVariations(faceId: string): void {
    for (const [key, value] of this.variations) if (value.faceId === faceId) { this.fonts.delete(value.face); this.variations.delete(key) }
  }
  async load(payload: FontPayload): Promise<void> {
    const existing = this.loaded.get(payload.face.id)
    if (existing) { this.loaded.delete(payload.face.id); this.loaded.set(payload.face.id, existing); return }
    const previous = this.pending.get(payload.face.id)
    if (previous) return previous
    const generation = this.generation
    const operation = this.loadFace(payload, generation).finally(() => this.pending.delete(payload.face.id))
    this.pending.set(payload.face.id, operation)
    return operation
  }
  private async loadFace(payload: FontPayload, generation: number): Promise<void> {
    const face = payload.face
    const aliases = [...new Set([face.fullName, face.family, face.localizedFamily, ...(face.variation ? [] : [face.postscriptName]), ...face.aliases])].filter(Boolean)
    const result: FontFace[] = []
    const source = new Uint8Array(payload.bytes).buffer
    for (const alias of aliases) {
      const exact = alias === face.fullName || alias === face.postscriptName
      // FontFace 的家族名按字面登记：Chromium 不去掉引号，带引号登记的名字与 CSS、Canvas 里解析出的家族名对不上。
      const value = new FontFace(alias, source, { weight: exact ? '400' : String(face.weight), style: exact ? 'normal' : face.italic ? 'italic' : 'normal', ...(face.variation ? { variationSettings: Object.entries(face.variation).map(([axis, number]) => `"${axis}" ${number}`).join(', ') } : {}) })
      await value.load(); result.push(value)
    }
    if (generation !== this.generation || this.allowedIds && !this.allowedIds.has(face.id)) return
    for (const value of result) this.fonts.add(value)
    this.loaded.set(face.id, { faces: result, bytes: source.byteLength * result.length, info: face, source }); this.changed()
    this.trim()
  }
  retain(faces: readonly FontFaceInfo[]): void {
    this.retainIds(faces.map(face => face.id))
  }
  retainIds(values: readonly string[]): void {
    const ids = new Set(values)
    this.allowedIds = ids
    for (const [id, entry] of this.loaded) if (!ids.has(id)) { for (const value of entry.faces) this.fonts.delete(value); this.dropVariations(id); this.loaded.delete(id); this.changed() }
  }
  setPinnedIds(ids: readonly string[]): void { this.pinnedIds = new Set(ids); this.trim() }
  private trim(): void {
    let bytes = [...this.loaded.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    for (const [id, entry] of this.loaded) {
      if (bytes <= this.cacheBudget) break
      if (this.pinnedIds.has(id)) continue
      for (const value of entry.faces) this.fonts.delete(value)
      this.dropVariations(id); this.loaded.delete(id); this.changed(); bytes -= entry.bytes
    }
  }
  dispose(): void { this.generation++; this.retain([]); this.pending.clear(); liveFaceSets.delete(this) }
}
let documentFonts: LoadedFontFaces | undefined
/** Typography textures must be invalidated when actual loaded font resources change. */
export function documentFontRevision(): number { return documentRevision }
const documentPins = new Map<object, readonly string[]>()
function updatePins(): void { documentFonts?.setPinnedIds([...documentPins.values()].flat()) }
/** Active rows, fields and render sessions stay live even above the soft cache budget. */
export function pinDocumentFonts(owner: object, ids: readonly string[]): void { documentPins.set(owner, ids); updatePins() }
export function releaseDocumentFonts(owner: object): void { documentPins.delete(owner); updatePins() }
export async function loadDocumentFont(payload: FontPayload): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return
  documentFonts ??= new LoadedFontFaces(document.fonts, 64 * 1024 * 1024)
  updatePins()
  await documentFonts.load(payload)
}
export function retainDocumentFonts(faces: readonly FontFaceInfo[]): void { documentFonts?.retain(faces) }
