import { getPlatform } from './runtime'
import { GENERIC_FONT_FACES, fontMatchesName, type FontCatalog, type FontFaceInfo, type FontPreferences } from '../core/fonts/catalog'
import { createLogger } from '../core/logging'
const logger = createLogger('services.fonts')
export interface FontLibrarySnapshot extends FontCatalog { loading: boolean; error: string; preferences: FontPreferences }
let snapshot: FontLibrarySnapshot = { faces: GENERIC_FONT_FACES, revision: 0, loading: false, error: '', preferences: { favorites: [], recent: [] } }
const listeners = new Set<() => void>()
let loading: Promise<FontLibrarySnapshot> | undefined
let subscribed = false
let loaded = false
let preferencesLoaded = false
let refreshPending = false
let preferenceWrites = Promise.resolve()
const facesLoaded = new Map<string, Promise<FontPayload>>()
const payloadSizes = new Map<string, number>()
// Soft byte budget for preview/cache data, never a font-library or project count limit.
const FONT_PAYLOAD_CACHE_BYTES = 64 * 1024 * 1024
export interface FontPayload { face: FontFaceInfo; bytes: Uint8Array }
export const fontLibrarySnapshot = (): FontLibrarySnapshot => snapshot
export function subscribeFontLibrary(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(value: Partial<FontLibrarySnapshot>): FontLibrarySnapshot { snapshot = { ...snapshot, ...value }; for (const listener of listeners) listener(); return snapshot }
function adopt(catalog: FontCatalog): void {
  const available = new Set(catalog.faces.map(face => face.id))
  for (const [id] of facesLoaded) if (!available.has(id)) { facesLoaded.delete(id); payloadSizes.delete(id) }
  publish({ ...catalog, faces: [...GENERIC_FONT_FACES, ...catalog.faces], loading: false, error: '' })
  loaded = true
}
export function loadFontLibrary(refresh = false): Promise<FontLibrarySnapshot> {
  if (loading) { refreshPending ||= refresh; return loading }
  if (loaded && !refresh) return Promise.resolve(snapshot)
  publish({ loading: true, error: '' })
  loading = (async () => {
    const platform = getPlatform()
    if (!subscribed) { platform.fonts.onChanged(() => { void loadFontLibrary(true).catch(() => undefined) }); subscribed = true }
    const catalog = await platform.fonts.list()
    if (!preferencesLoaded) {
      try {
        const record = await platform.settings.get('fonts.preferences')
        if (record) {
          const value: unknown = JSON.parse(record.value)
          if (value && typeof value === 'object' && 'favorites' in value && 'recent' in value && Array.isArray(value.favorites) && Array.isArray(value.recent) && [...value.favorites, ...value.recent].every(item => typeof item === 'string')) publish({ preferences: { favorites: value.favorites as string[], recent: value.recent as string[] } })
          else throw new Error('字体偏好格式无效')
        }
      } catch (error) { logger.warn('字体偏好无法读取，使用默认偏好', { event: 'fonts.preferences.read_failed', error }) }
      preferencesLoaded = true
    }
    adopt(catalog)
    return snapshot
  })().catch(error => { publish({ loading: false, error: error instanceof Error ? error.message : '无法读取字体库，请重试。' }); logger.error('字体库读取失败', { event: 'fonts.catalog.failed', error }); throw error }).finally(() => { loading = undefined; if (refreshPending) { refreshPending = false; void loadFontLibrary(true).catch(() => undefined) } })
  return loading
}
export async function importFonts(): Promise<void> { adopt(await getPlatform().fonts.importFiles()) }
export async function removeFont(id: string): Promise<void> { adopt(await getPlatform().fonts.remove(id)) }
function writePreferences(preferences: FontPreferences): void {
  publish({ preferences })
  preferenceWrites = preferenceWrites.catch(() => undefined).then(() => getPlatform().settings.set('fonts.preferences', JSON.stringify(preferences), 'json'))
  void preferenceWrites.catch(error => { publish({ error: '字体偏好保存失败，请重试。' }); logger.error('字体偏好保存失败', { event: 'fonts.preferences.failed', error }) })
}
export function favoriteFont(family: string): void { const previous = snapshot.preferences; writePreferences({ ...previous, favorites: previous.favorites.includes(family) ? previous.favorites.filter(value => value !== family) : [...previous.favorites, family] }) }
export function rememberFont(family: string): void { writePreferences({ ...snapshot.preferences, recent: [family, ...snapshot.preferences.recent.filter(value => value !== family)] }) }
export function resolveFont(name: string): FontFaceInfo | undefined {
  return snapshot.faces.find(face => face.fullName.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? snapshot.faces.filter(face => fontMatchesName(face, name)).sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400) || Number(a.italic) - Number(b.italic))[0]
}
export function validateFontName(name: string): void {
  if (GENERIC_FONT_FACES.some(face => face.family === name)) return
  if (!loaded) throw new Error('字体目录尚未就绪，请先查询 font 实体后重试。')
  if (resolveFont(name)) return
  const key = name.toLocaleLowerCase()
  const candidates = snapshot.faces.filter(face => face.family.toLocaleLowerCase().includes(key) || face.localizedFamily.includes(name)).slice(0, 8)
  throw new Error(`字体“${name}”不存在。可用候选：${(candidates.length ? candidates : snapshot.faces.slice(0, 8)).map(face => face.localizedFamily).join('、')}。可查询 font 实体或导入缺失字体。`)
}
export function readFontPayload(face: FontFaceInfo): Promise<FontPayload> {
  let pending = facesLoaded.get(face.id)
  if (!pending) {
    pending = getPlatform().fonts.readFace(face.id).then(payload => {
      if (facesLoaded.get(face.id) !== pending) return payload
      payloadSizes.set(face.id, payload.bytes.byteLength)
      let bytes = [...payloadSizes.values()].reduce((sum, size) => sum + size, 0)
      for (const [id] of facesLoaded) {
        if (bytes <= FONT_PAYLOAD_CACHE_BYTES) break
        const size = payloadSizes.get(id)
        if (size !== undefined) { bytes -= size; payloadSizes.delete(id); facesLoaded.delete(id) }
      }
      return payload
    }).catch(error => { facesLoaded.delete(face.id); payloadSizes.delete(face.id); throw error })
    facesLoaded.set(face.id, pending)
  } else { facesLoaded.delete(face.id); facesLoaded.set(face.id, pending) }
  return pending
}
export async function prepareFontPayloads(names: readonly string[]): Promise<FontPayload[]> {
  await loadFontLibrary()
  const faces = [...new Map(names.map(name => resolveFont(name)).filter((face): face is FontFaceInfo => Boolean(face && !face.id.startsWith('generic:'))).map(face => [face.id, face])).values()]
  return Promise.all(faces.map(readFontPayload))
}
