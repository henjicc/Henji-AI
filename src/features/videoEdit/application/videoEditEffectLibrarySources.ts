import { getPlatform } from '@/platform/runtime'
import { sha256HexString } from '@/utils/save/hash'
import { storedVideoEditEffectLibrary, type StoredVideoEditEffectLibrary } from '@/core/videoEdit/effectLibrary'
import { videoEditEffectLibrarySchema, type VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
import type { CodeSource } from '@/core/videoEdit/codeMaterial/sources'

export interface EffectLibrarySourceStorage { read(hash: string): Promise<string>; write(source: CodeSource): Promise<void> }
/** 复用代码文件的摘要校验读入口和 PAL 独占写入，不依赖原工程是否仍然存在。 */
export const desktopEffectLibrarySources: EffectLibrarySourceStorage = {
  async read(hash) {
    const { system, documents } = getPlatform()
    const location = await system.paths.join(await system.paths.appLocalDataDir(), 'code-sources', `${hash}.js`)
    return documents.readCodeFile({ path: `${hash}.js`, location, hash })
  },
  async write({ hash, source }) {
    if (await sha256HexString(source) !== hash) throw new Error('效果库源码内容校验失败。')
    const { system } = getPlatform(), dir = await system.paths.join(await system.paths.appLocalDataDir(), 'code-sources')
    const file = await system.paths.join(dir, `${hash}.js`)
    await system.fs.mkdir(dir, { recursive: true })
    // 相同摘要是同一不可变内容；并发发布只能复用通过校验的已存在文件。
    try { await system.fs.writeFile(file, new TextEncoder().encode(source), { exclusive: true }) }
    catch (error) { if (!await system.fs.exists(file)) throw error; if (await desktopEffectLibrarySources.read(hash) !== source) throw new Error('效果库源码存储内容不符。') }
  },
}
export async function readEffectLibrarySources(value: StoredVideoEditEffectLibrary, io: EffectLibrarySourceStorage): Promise<{ favorites: string[]; presets: VideoEditEffectPreset[] }> {
  const sources = new Map<string, string>()
  for (const preset of value.presets) for (const snapshot of Object.values(preset.codeSnapshots ?? {})) for (const entry of snapshot.codeSources) {
    if (sources.has(entry.hash)) continue
    const source = entry.source ?? await io.read(entry.hash)
    if (await sha256HexString(source) !== entry.hash) throw new Error('效果库源码内容校验失败。')
    if (entry.source !== undefined) await io.write({ hash: entry.hash, source })
    sources.set(entry.hash, source)
  }
  return videoEditEffectLibrarySchema.parse({ ...value, presets: value.presets.map(preset => ({ ...preset, ...(preset.codeSnapshots ? { codeSnapshots: Object.fromEntries(Object.entries(preset.codeSnapshots).map(([id, snapshot]) => [id, { ...snapshot, codeSources: snapshot.codeSources.map(({ hash }) => ({ hash, source: sources.get(hash)! })) }])) } : {}) })) })
}
export async function writeEffectLibrarySources(value: { favorites: string[]; presets: VideoEditEffectPreset[] }, io: EffectLibrarySourceStorage, persisted: ReadonlySet<string> = new Set()): Promise<StoredVideoEditEffectLibrary> {
  const written = new Set<string>()
  for (const preset of value.presets) for (const snapshot of Object.values(preset.codeSnapshots ?? {})) for (const source of snapshot.codeSources) if (!written.has(source.hash) && !persisted.has(source.hash)) { await io.write(source); written.add(source.hash) }
  return storedVideoEditEffectLibrary(value)
}
