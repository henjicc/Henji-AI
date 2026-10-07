import { readFile, stat, readdir, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { discoverSystemFonts, FONT_FILE_EXTENSION, type FontDiscovery } from './discovery'
import { parseFontFile, standaloneFont, type ParsedFontFace } from './metadata'
import type { FontFaceInfo } from '../../../../src/core/fonts/catalog'

export interface InternalFace { face: FontFaceInfo; path: string; index: number; signature: string }
interface CachedFile { signature: string; faces: ParsedFontFace[] }
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
        const parsed = cached?.signature === signature ? cached.faces : parseFontFile(await readFile(file))
        next[file] = { signature, faces: parsed }
        for (const value of parsed) faces.push({ face: { ...value.face, id: createHash('sha256').update(`${file}:${value.index}:${signature}:${JSON.stringify(value.face.variation ?? {})}`).digest('hex'), imported: importedSet.has(file) }, path: file, index: value.index, signature })
      } catch (error) { failures.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    this.cache = next
    const temp = path.join(this.library, 'catalog-cache.tmp')
    await writeFile(temp, JSON.stringify(next)); await rename(temp, path.join(this.library, 'catalog-cache.json'))
    return { faces, failures }
  }
  async importFile(source: string): Promise<void> {
    await this.init()
    if (!/\.(ttf|otf|ttc|woff2)$/i.test(source)) throw new Error('请选择 TTF、OTF、TTC 或 WOFF2 字体文件。')
    const bytes = await readFile(source)
    const parsed = parseFontFile(bytes)
    if (!parsed.length) throw new Error('字体文件中没有可用样式。')
    const hash = createHash('sha256').update(bytes).digest('hex')
    // Hash is the library filename. Equivalent content never creates another asset, even with a different filename.
    const existing = (await readdir(this.library)).find(name => name.startsWith(`${hash}.`))
    if (existing) return
    await writeFile(path.join(this.library, `${hash}${path.extname(source).toLowerCase()}`), bytes, { flag: 'wx' })
  }
  async remove(face: InternalFace): Promise<void> {
    if (!face.face.imported || path.dirname(face.path) !== this.library) throw new Error('只能删除已导入的字体，系统字体请在系统设置中管理。')
    await unlink(face.path)
    delete this.cache[face.path]
  }
  async read(face: InternalFace): Promise<Uint8Array> {
    const info = await stat(face.path)
    if (`${info.size}:${info.mtimeMs}` !== face.signature) throw new Error('字体已发生变化，请刷新字体列表。')
    return new Uint8Array(standaloneFont(await readFile(face.path), face.index))
  }
}
