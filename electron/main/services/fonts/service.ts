import { Worker } from 'node:worker_threads'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { fontDirectories } from './discovery'
import { app, BrowserWindow } from 'electron'
import type { FontCatalog } from '../../../../src/core/fonts/catalog'
import { FONTS_IPC } from '../../../../src/platform/contracts/fonts'
import { createMainLogger } from '../logging'
import type { InternalFace } from './scanner'
import type { FontWorkerRequest } from './worker'
const logger = createMainLogger('main.fonts')
type Request = FontWorkerRequest extends infer T ? T extends FontWorkerRequest ? Omit<T, 'id'> : never : never
export class FontService {
  private worker?: Worker
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private id = 0
  private faces: InternalFace[] = []
  private revision = 0
  private dirty = true
  private scan?: Promise<FontCatalog>
  private scannedAt = 0
  private watchers: FSWatcher[] = []
  private watched = new Set<string>()
  private changeTimer?: ReturnType<typeof setTimeout>
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
  private apply(result: { faces: InternalFace[]; failures: string[] }): FontCatalog {
    const changed = JSON.stringify(result.faces) !== JSON.stringify(this.faces)
    this.faces = result.faces
    if (changed) { this.revision++; for (const window of BrowserWindow.getAllWindows()) window.webContents.send(FONTS_IPC.changed) }
    // OS directories can contain unsupported or damaged font files. A catalog scan skips those
    // candidates; explicit import/read failures still use their existing error paths.
    if (result.failures.length) logger.debug('字体目录中跳过不可解析的文件', { event: 'fonts.scan.partial', context: { failures: result.failures } })
    const roots = fontDirectories()
    for (const directory of new Set([...roots, this.library, ...this.faces.map(face => path.dirname(face.path))])) {
      if (this.watched.has(directory)) continue
      try { const watcher = watch(directory, { persistent: false }, (_event, name) => {
        if (directory === this.library && name && /^catalog-cache\.(json|tmp)$/.test(String(name))) return
        this.dirty = true; clearTimeout(this.changeTimer)
        // Directory renames matter too: new nested font folders must not be filtered as non-font filenames.
        this.changeTimer = setTimeout(() => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(FONTS_IPC.changed) }, 200)
        this.changeTimer.unref()
      }); watcher.on('error', () => { this.dirty = true }); this.watchers.push(watcher); this.watched.add(directory) } catch { /* Missing OS font directories are normal; refreshed on the next scan. */ }
    }
    return { faces: this.faces.map(value => value.face), revision: this.revision }
  }
  async list(): Promise<FontCatalog> {
    if (this.scan) return this.scan
    // Watchers cover live changes; periodic stat-only refresh also detects newly created OS font directories.
    if (!this.dirty && Date.now() - this.scannedAt < 60_000) return { faces: this.faces.map(value => value.face), revision: this.revision }
    this.dirty = false
    logger.info('开始读取字体目录', { event: 'fonts.scan.start' })
    this.scan = this.request<{ faces: InternalFace[]; failures: string[] }>({ kind: 'scan' }).then(result => { this.scannedAt = Date.now(); const catalog = this.apply(result); logger.info('字体目录读取完成', { event: 'fonts.scan.completed', context: { faces: catalog.faces.length } }); return catalog }, error => { this.dirty = true; logger.error('字体目录读取失败', { event: 'fonts.scan.failed', error }); throw error }).finally(() => { this.scan = undefined })
    return this.scan
  }
  async importFiles(paths: string[]): Promise<FontCatalog> {
    logger.info('开始导入字体', { event: 'fonts.import.start', context: { count: paths.length } })
    try { const result = await this.request<{ faces: InternalFace[]; failures: string[] }>({ kind: 'import', paths }); const catalog = this.apply(result); logger.info('字体导入完成', { event: 'fonts.import.completed', context: { count: paths.length } }); return catalog }
    catch (error) { this.dirty = true; await this.list().catch(() => undefined); logger.error('字体导入失败', { event: 'fonts.import.failed', error }); throw error }
  }
  private async requireFace(id: string): Promise<InternalFace> { await this.list(); const face = this.faces.find(value => value.face.id === id); if (!face) throw new Error('字体不存在，请刷新后重选。'); return face }
  async readFace(id: string) { const value = await this.requireFace(id); return { face: value.face, bytes: await this.request<Uint8Array>({ kind: 'read', face: value }) } }
  async remove(id: string): Promise<FontCatalog> {
    const face = await this.requireFace(id)
    logger.info('开始删除导入字体', { event: 'fonts.remove.start', context: { font: face.face.fullName } })
    try { const catalog = this.apply(await this.request({ kind: 'remove', face })); logger.info('导入字体已删除', { event: 'fonts.remove.completed', context: { font: face.face.fullName } }); return catalog }
    catch (error) { logger.error('导入字体删除失败', { event: 'fonts.remove.failed', error }); throw error }
  }
  dispose(): void { clearTimeout(this.changeTimer); for (const watcher of this.watchers) watcher.close(); this.watchers = []; this.watched.clear(); void this.worker?.terminate(); this.worker = undefined; for (const item of this.pending.values()) item.reject(new Error('字体服务已关闭。')); this.pending.clear() }
}
let service: FontService | undefined
export function getFontService(): FontService { return service ??= new FontService(path.join(app.getPath('userData'), 'fonts')) }
export function disposeFonts(): void { service?.dispose(); service = undefined }
