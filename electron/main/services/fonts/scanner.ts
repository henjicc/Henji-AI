import { readFile, stat, readdir, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { discoverSystemFonts, FONT_FILE_EXTENSION, type FontDiscovery } from './discovery'
import { FONT_METADATA_VERSION, parseFontFile, standaloneFont, type ParsedFontFace } from './metadata'
import type { FontFaceInfo } from '../../../../src/core/fonts/catalog'

export interface InternalFace { face: FontFaceInfo; path: string; index: number; signature: string }
interface CachedFile { signature: string; parser?: number; faces: ParsedFontFace[] }
interface FontInventory { files: string[]; imported: Set<string>; stats: Map<string, string>; failures: string[]; signature: string }
export class FontScanner {
  private cache: Record<string, CachedFile> = {}
  private initialized = false
  constructor(private readonly library: string, private readonly discover: () => Promise<string[] | FontDiscovery> = discoverSystemFonts) {}
  private cacheText = ''
  private async init(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.library, { recursive: true })
    try { this.cacheText = await readFile(path.join(this.library, 'catalog-cache.json'), 'utf8'); this.cache = JSON.parse(this.cacheText) as Record<string, CachedFile> } catch { this.cache = {}; this.cacheText = '' }
    this.initialized = true
  }
  /** 只做目录遍历与 stat，不解析字体；签名相同说明目录里的字体文件集合与文件身份都没变。 */
  async inventory(): Promise<FontInventory> {
    await this.init()
    const imported = (await readdir(this.library)).filter(name => FONT_FILE_EXTENSION.test(name)).map(name => path.join(this.library, name))
    const discovery = await this.discover(); const found = Array.isArray(discovery) ? { files: discovery, failures: [] } : discovery
    const files = [...new Set([...found.files, ...imported])]
    const stats = new Map<string, string>(); const failures = [...found.failures]
    await Promise.all(files.map(async file => {
      try { const info = await stat(file); stats.set(file, `${info.size}:${info.mtimeMs}`) }
      catch (error) { failures.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`) }
    }))
    const signature = createHash('sha256').update(JSON.stringify([...stats].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest('hex')
    return { files: files.filter(file => stats.has(file)), imported: new Set(imported), stats, failures, signature }
  }
  /**
   * 扫描跑在字体线程里，线程里不能加载 electron（安装版没有 electron 包可解析），所以缓存不在这里落盘：
   * 内容有变化时把新缓存文本交回 `cache`，由主进程原子写入。
   */
  async scan(): Promise<{ faces: InternalFace[]; failures: string[]; signature: string; cache?: string }> {
    const { files, imported: importedSet, stats, failures, signature: inventorySignature } = await this.inventory()
    const next: Record<string, CachedFile> = {}; const faces: InternalFace[] = []
    for (const file of files) {
      try {
        const signature = stats.get(file)!
        const cached = this.cache[file]
        const parsed = cached?.signature === signature && cached.parser === FONT_METADATA_VERSION ? cached.faces : parseFontFile(await readFile(file))
        next[file] = { signature, parser: FONT_METADATA_VERSION, faces: parsed }
        for (const value of parsed) faces.push({ face: { ...value.face, id: createHash('sha256').update(`${file}:${value.index}:${signature}:${JSON.stringify(value.face.variation ?? {})}`).digest('hex'), imported: importedSet.has(file) }, path: file, index: value.index, signature })
      } catch (error) { failures.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    // 内容没变就不交回：缓存文件在字体库目录里，重写会触发目录监听。
    const text = JSON.stringify(next)
    const cache = text !== this.cacheText ? text : undefined
    this.cacheText = text; this.cache = next
    return { faces, failures, signature: inventorySignature, cache }
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
