import { writeBufferAtomically } from '../fs/atomic-file'
import { readFile, stat, readdir, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { discoverSystemFonts, FONT_FILE_EXTENSION, type FontDiscovery } from './discovery'
import { FONT_METADATA_VERSION, parseFontFile, standaloneFont, type ParsedFontFace } from './metadata'
import type { FontFaceInfo } from '../../../../src/core/fonts/catalog'

export interface InternalFace { face: FontFaceInfo; path: string; index: number; signature: string }
interface CachedFile { signature: string; parser?: number; faces: ParsedFontFace[] }
export class FontScanner {
  private cache: Record<string, CachedFile> = {}
  private initialized = false
  constructor(private readonly library: string, private readonly discover: () => Promise<string[] | FontDiscovery> = discoverSystemFonts) {}
  private async init(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.library, { recursive: true })
    try { this.cache = JSON.parse(await readFile(path.join(this.library, 'catalog-cache.json'), 'utf8')) as Record<string, CachedFile> } catch { this.cache = {} }
    this.initialized = true
  }
  async scan(): Promise<{ faces: InternalFace[]; failures: string[] }> {
    await this.init()
    const imported = (await readdir(this.library)).filter(name => FONT_FILE_EXTENSION.test(name)).map(name => path.join(this.library, name))
    const discovery = await this.discover(); const found = Array.isArray(discovery) ? { files: discovery, failures: [] } : discovery
    const files = [...new Set([...found.files, ...imported])]
    const importedSet = new Set(imported)
    const next: Record<string, CachedFile> = {}; const faces: InternalFace[] = []; const failures = [...found.failures]
    for (const file of files) {
      try {
        const info = await stat(file); const signature = `${info.size}:${info.mtimeMs}`
        const cached = this.cache[file]
        const parsed = cached?.signature === signature && cached.parser === FONT_METADATA_VERSION ? cached.faces : parseFontFile(await readFile(file))
        next[file] = { signature, parser: FONT_METADATA_VERSION, faces: parsed }
        for (const value of parsed) faces.push({ face: { ...value.face, id: createHash('sha256').update(`${file}:${value.index}:${signature}:${JSON.stringify(value.face.variation ?? {})}`).digest('hex'), imported: importedSet.has(file) }, path: file, index: value.index, signature })
      } catch (error) { failures.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    await writeBufferAtomically(path.join(this.library, 'catalog-cache.json'), Buffer.from(JSON.stringify(next)))
    this.cache = next
    return { faces, failures }
  }
  async importFile(source: string): Promise<void> {
    await this.init()
    if (!/\.(ttf|otf|ttc|woff2)$/i.test(source)) throw new Error('请选择 TTF、OTF、TTC 或 WOFF2 字体文件。')
    const bytes = await readFile(source)
    const parsed = parseFontFile(bytes)
    if (!parsed.length) throw new Error('字体文件中没有可用样式。')
    const hash = createHash('sha256').update(bytes).digest('hex')
    // 内容哈希作文件名，使改名后的相同字体仍指向同一资产。
    const existing = (await readdir(this.library)).find(name => name.startsWith(`${hash}.`))
    if (existing) return
    await writeFile(path.join(this.library, `${hash}${path.extname(source).toLowerCase()}`), bytes, { flag: 'wx' })
  }
  async read(face: InternalFace, fixed = false): Promise<Uint8Array> {
    const changed = (): Error => new Error(fixed ? '字体在导出期间被修改' : '字体已发生变化，请刷新字体列表。')
    const inspect = () => stat(face.path).catch(error => { if (fixed && (error as NodeJS.ErrnoException).code === 'ENOENT') throw changed(); throw error })
    const info = await inspect()
    if (`${info.size}:${info.mtimeMs}` !== face.signature) throw changed()
    const bytes = await readFile(face.path).catch(error => { if (fixed && (error as NodeJS.ErrnoException).code === 'ENOENT') throw changed(); throw error })
    const normalized = await standaloneFont(bytes, face.index)
    // 解压可能跨越一次文件替换；不能把新目录里的字节发布到旧快照。
    const after = await inspect()
    if (`${after.size}:${after.mtimeMs}` !== face.signature) throw changed()
    return new Uint8Array(normalized)
  }
}
