import { Worker } from 'node:worker_threads'
import { trashUserFile } from '../recycle/runtime'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { fontDirectories } from './discovery'
import { BrowserWindow } from 'electron'
import type { FontCatalog, FontFaceInfo, FontFileSource, FixedFontCatalog } from '../../../../src/core/fonts/catalog'
import { FONTS_IPC } from '../../../../src/platform/contracts/fonts'
import { createMainLogger } from '../logging'
import { getProgramDataDir } from '../appBasePaths'
import type { InternalFace } from './scanner'
import type { FontWorkerRequest } from './worker'
const logger = createMainLogger('main.fonts')
type Request = FontWorkerRequest extends infer T ? T extends FontWorkerRequest ? Omit<T, 'id'> : never : never
type ScanResult = { faces: InternalFace[]; failures: string[]; signature: string }
const CATALOG_CACHE_FILE = /^(?:catalog-cache\.(?:json|tmp)|\.catalog-cache\.json\.[\w-]+\.tmp)$/
/** 一次复制、解压或安装字体会连发很多目录事件，合并成一次核对。 */
const WATCH_SETTLE_MS = 500
export class FontService {
  private worker?: Worker
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private closing?: Promise<void>
  private id = 0
  private faces: InternalFace[] = []
  /** 当前目录对应的文件清单签名（路径 + 大小 + 修改时间）；未扫描过时为空。 */
  private signature?: string
  private revision = 0
  private dirty = true
  private scan?: Promise<FontCatalog>
  private scannedAt = 0
  private watchers: FSWatcher[] = []
  private watched = new Set<string>()
  private changeTimer?: ReturnType<typeof setTimeout>
  private watchEvents: string[] = []
  /** 有目录事件落在扫描进行中，扫描结束后要再核对一次。 */
  private recheck = false
  constructor(private readonly library: string) {}
  private request<T>(request: Request): Promise<T> {
    if (!this.worker) {
      const worker = new Worker(path.join(__dirname, 'font-worker.cjs'), { workerData: { library: this.library } })
      this.worker = worker; worker.unref()
      worker.on('message', (reply: { id: number; result?: unknown; error?: string }) => {
        const item = this.pending.get(reply.id); this.pending.delete(reply.id)
        if (reply.error) item?.reject(new Error(reply.error)); else item?.resolve(reply.result)
      })
      const fail = (error: Error): void => { if (this.worker !== worker) return; for (const item of this.pending.values()) item.reject(error); this.pending.clear(); this.worker = undefined; this.dirty = true }
      worker.on('error', fail); worker.on('exit', () => fail(new Error('字体扫描线程已退出，请重试。')))
    }
    const id = ++this.id
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve: value => resolve(value as T), reject }); this.worker!.postMessage({ ...request, id }) })
  }
  private catalog(): FontCatalog { return { faces: this.faces.map(value => value.face), revision: this.revision } }
  private apply(result: ScanResult): FontCatalog {
    const changed = JSON.stringify(result.faces) !== JSON.stringify(this.faces)
    this.faces = result.faces; this.signature = result.signature
    if (changed) { this.revision++; for (const window of BrowserWindow.getAllWindows()) window.webContents.send(FONTS_IPC.changed) }
    // OS directories can contain unsupported or damaged font files. A catalog scan skips those
    // candidates; explicit import/read failures still use their existing error paths.
    if (result.failures.length) logger.debug('字体目录中跳过不可解析的文件', { event: 'fonts.scan.partial', context: { failures: result.failures } })
    const roots = fontDirectories()
    for (const directory of new Set([...roots, this.library, ...this.faces.map(face => path.dirname(face.path))])) {
      if (this.watched.has(directory)) continue
      try { const watcher = watch(directory, { persistent: false }, (event, name) => this.observe(directory, event, name ? String(name) : '')); watcher.on('error', () => { this.dirty = true }); this.watchers.push(watcher); this.watched.add(directory) } catch { /* Missing OS font directories are normal; refreshed on the next scan. */ }
    }
    return this.catalog()
  }
  /**
   * 目录事件只说明“可能变了”：空文件名（系统合并或溢出的事件）与目录改名同样要核对，
   * 但核对只比文件清单签名，签名没变就不扫描、不通知界面。
   */
  private observe(directory: string, event: string, name: string): void {
    if (directory === this.library && CATALOG_CACHE_FILE.test(name)) return
    this.dirty = true
    if (this.watchEvents.length < 8) this.watchEvents.push(`${event}:${path.join(directory, name)}`)
    clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => {
      logger.debug('字体目录有变化，核对文件清单', { event: 'fonts.watch.changed', context: { samples: this.watchEvents } })
      this.watchEvents = []
      if (this.scan) { this.recheck = true; return }
      void this.list().catch(() => undefined)
    }, WATCH_SETTLE_MS)
    this.changeTimer.unref()
  }
  async list(): Promise<FontCatalog> {
    if (this.scan) return this.scan
    // Watchers cover live changes; periodic stat-only refresh also detects newly created OS font directories.
    if (!this.dirty && Date.now() - this.scannedAt < 60_000) return this.catalog()
    this.dirty = false
    this.scan = this.refresh().finally(() => {
      this.scan = undefined
      // 扫描进行中到达的目录事件拿到的是这次（可能已过时）的结果，结束后补核对一次，有变化由 apply 广播。
      if (this.recheck) { this.recheck = false; void this.list().catch(() => undefined) }
    })
    return this.scan
  }
  private async refresh(): Promise<FontCatalog> {
    try {
      if (this.signature !== undefined && await this.request<string>({ kind: 'inventory' }) === this.signature) { this.scannedAt = Date.now(); return this.catalog() }
      logger.info('开始读取字体目录', { event: 'fonts.scan.start' })
      const result = await this.request<ScanResult>({ kind: 'scan' })
      this.scannedAt = Date.now()
      const catalog = this.apply(result)
      logger.info('字体目录读取完成', { event: 'fonts.scan.completed', context: { faces: catalog.faces.length } })
      return catalog
    } catch (error) { this.dirty = true; logger.error('字体目录读取失败', { event: 'fonts.scan.failed', error }); throw error }
  }
  async importFiles(paths: string[]): Promise<FontCatalog> {
    logger.info('开始导入字体', { event: 'fonts.import.start', context: { count: paths.length } })
    try { const result = await this.request<ScanResult>({ kind: 'import', paths }); const catalog = this.apply(result); logger.info('字体导入完成', { event: 'fonts.import.completed', context: { count: paths.length } }); return catalog }
    // 部分文件可能已写入字体库：清掉签名强制完整重扫，不靠清单核对。
    catch (error) { this.dirty = true; this.signature = undefined; await this.list().catch(() => undefined); logger.error('字体导入失败', { event: 'fonts.import.failed', error }); throw error }
  }
  private async requireFace(id: string): Promise<InternalFace> { await this.list(); const face = this.faces.find(value => value.face.id === id); if (!face) throw new Error('字体不存在，请刷新后重选。'); return face }
  async readFace(id: string, source?: FontFileSource): Promise<{ face: FontFaceInfo; bytes: Uint8Array }> {
    const value = source ?? await this.requireFace(id)
    return { face: value.face, bytes: await this.request<Uint8Array>({ kind: 'read', face: value, fixed: !!source }) }
  }
  /** 导出固定的是文件身份：先按文件清单签名核对一次，有变化才重扫；读取时再逐个校验身份。 */
  async captureSnapshot(): Promise<FixedFontCatalog> {
    this.dirty = true
    const catalog = await this.list()
    return { ...catalog, sources: Object.fromEntries(this.faces.map(value => [value.face.id, value])) }
  }
  async remove(id: string): Promise<FontCatalog> {
    const face = await this.requireFace(id)
    logger.info('开始删除导入字体', { event: 'fonts.remove.start', context: { font: face.face.fullName } })
    try {
      if (!face.face.imported || path.dirname(face.path) !== this.library) throw new Error('只能删除已导入的字体，系统字体请在系统设置中管理。')
      await trashUserFile(face.path, face.face.localizedFamily || face.face.family)
      const catalog = this.apply(await this.request<ScanResult>({ kind: 'scan' }))
      logger.info('导入字体已删除', { event: 'fonts.remove.completed', context: { font: face.face.fullName } }); return catalog
    }
    catch (error) { logger.error('导入字体删除失败', { event: 'fonts.remove.failed', error }); throw error }
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    clearTimeout(this.changeTimer)
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []; this.watched.clear()
    const worker = this.worker
    this.closing = Promise.resolve(worker?.terminate()).then(() => undefined)
    return this.closing
  }
}
let service: FontService | undefined
export function getFontService(): FontService { return service ??= new FontService(path.join(getProgramDataDir(), 'fonts')) }
export async function disposeFonts(): Promise<void> { const current = service; service = undefined; await current?.dispose() }
