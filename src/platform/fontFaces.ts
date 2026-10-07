import type { FontPayload } from './fonts'
import { cssFontFamily, type FontFaceInfo } from '../core/fonts/catalog'
/** Shared by document.fonts and WorkerGlobalScope.fonts. No PAL calls inside the worker. */
export class LoadedFontFaces {
  private readonly loaded = new Map<string, { faces: FontFace[]; bytes: number }>()
  private readonly pending = new Map<string, Promise<void>>()
  private generation = 0
  private allowedIds?: Set<string>
  private pinnedIds = new Set<string>()
  constructor(private readonly fonts: FontFaceSet, private readonly cacheBudget = Infinity, private readonly onChange: () => void = () => undefined) {}
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
      const familyToken = cssFontFamily(alias).replace(/, sans-serif$/, '')
      const value = new FontFace(familyToken, source, { weight: exact ? '400' : String(face.weight), style: exact ? 'normal' : face.italic ? 'italic' : 'normal', ...(face.variation ? { variationSettings: Object.entries(face.variation).map(([axis, number]) => `"${axis}" ${number}`).join(', ') } : {}) })
      await value.load(); result.push(value)
    }
    if (generation !== this.generation || this.allowedIds && !this.allowedIds.has(face.id)) return
    for (const value of result) this.fonts.add(value)
    this.loaded.set(face.id, { faces: result, bytes: source.byteLength * result.length }); this.onChange()
    this.trim()
  }
  retain(faces: readonly FontFaceInfo[]): void {
    this.retainIds(faces.map(face => face.id))
  }
  retainIds(values: readonly string[]): void {
    const ids = new Set(values)
    this.allowedIds = ids
    for (const [id, entry] of this.loaded) if (!ids.has(id)) { for (const value of entry.faces) this.fonts.delete(value); this.loaded.delete(id); this.onChange() }
  }
  setPinnedIds(ids: readonly string[]): void { this.pinnedIds = new Set(ids); this.trim() }
  private trim(): void {
    let bytes = [...this.loaded.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    for (const [id, entry] of this.loaded) {
      if (bytes <= this.cacheBudget) break
      if (this.pinnedIds.has(id)) continue
      for (const value of entry.faces) this.fonts.delete(value)
      this.loaded.delete(id); this.onChange(); bytes -= entry.bytes
    }
  }
  dispose(): void { this.generation++; this.retain([]); this.pending.clear() }
}
let documentFonts: LoadedFontFaces | undefined
let documentRevision = 0
/** Typography textures must be invalidated when actual loaded font resources change. */
export function documentFontRevision(): number { return documentRevision }
const documentPins = new Map<object, readonly string[]>()
function updatePins(): void { documentFonts?.setPinnedIds([...documentPins.values()].flat()) }
/** Active rows, fields and render sessions stay live even above the soft cache budget. */
export function pinDocumentFonts(owner: object, ids: readonly string[]): void { documentPins.set(owner, ids); updatePins() }
export function releaseDocumentFonts(owner: object): void { documentPins.delete(owner); updatePins() }
export async function loadDocumentFont(payload: FontPayload): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return
  documentFonts ??= new LoadedFontFaces(document.fonts, 64 * 1024 * 1024, () => { documentRevision++ })
  updatePins()
  await documentFonts.load(payload)
}
export function retainDocumentFonts(faces: readonly FontFaceInfo[]): void { documentFonts?.retain(faces) }
