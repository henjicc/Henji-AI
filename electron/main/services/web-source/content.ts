import fs from 'node:fs'
import path from 'node:path'
import type { MainLogger } from '../logging/main-logger'
import { webSourceContentHash } from './site'

/** 文件改动后等这么久没有新的改动再重新散列（编辑器保存、构建输出常是一串连续写入）。 */
const SETTLE_MS = 300
/** 监视建不起来或中断后，隔这么久再试（文件夹可能正被构建工具整个替换，或还不存在）。 */
const RETRY_MS = 2_000

interface WatchedRoot {
  /** 持有者：打开着的页面，加上引用这个文件夹的、打开着的剪辑所在的窗口。为 0 时停止监视、释放条目。 */
  holders: number
  /** 当前指纹；从没读出来过时是失败的 Promise。 */
  hash: Promise<string>
  /** 渲染层用来引用这个文件夹的路径（文件夹本身或其中的 index.html）：指纹变化按这些路径通知。 */
  paths: Set<string>
  watcher?: fs.FSWatcher
  /** 重新监视与重新散列各用一个计时器，互不取消。 */
  watchTimer?: ReturnType<typeof setTimeout>
  hashTimer?: ReturnType<typeof setTimeout>
  /** 最近一次开始的重新散列的序号。 */
  hashGeneration?: number
  /** 监视失败、散列失败各只记一次，恢复后清掉。 */
  watchWarned?: boolean
  hashWarned?: boolean
}

/**
 * 网页文件夹的内容指纹。只要有持有者就监视文件夹：改动后重新散列，指纹变了就通知（打开着的页面重新载入，渲染层让
 * 用到它的预渲染窗口失效）。文件夹被删掉或整个替换时，散列失败会丢掉旧监视、隔一会儿重新监视，监视建好后补一次散列；
 * 散列成功时发现没有监视也补建。没有持有者时按需现算（各文件按大小与修改时间记住散列，没变的不重读）。
 */
export class WebSourceContent {
  private readonly roots = new Map<string, WatchedRoot>()

  constructor(private readonly onChanged: (root: string, hash: string, paths: string[]) => void, private readonly logger: Pick<MainLogger, 'info' | 'warn'>) {}

  /** 开始持有：第一次持有时开始监视与散列。文件夹不存在也照常持有，等它出现。 */
  hold(root: string): void {
    let entry = this.roots.get(root)
    if (!entry) {
      const created: WatchedRoot = { holders: 0, hash: webSourceContentHash(root), paths: new Set() }
      entry = created
      this.roots.set(root, created)
      created.hash.catch(error => { if (this.roots.get(root) === created) this.hashFailed(root, created, error) })
      this.watch(root, created, false)
    }
    entry.holders++
  }

  release(root: string): void {
    const entry = this.roots.get(root)
    if (!entry || --entry.holders > 0) return
    this.roots.delete(root)
    clearTimeout(entry.watchTimer)
    clearTimeout(entry.hashTimer)
    entry.watcher?.close()
  }

  /** 记下渲染层引用这个（已持有的）文件夹所用的路径。 */
  request(root: string, paths: readonly string[]): void {
    const entry = this.roots.get(root)
    if (entry) for (const path of paths) entry.paths.add(path)
  }

  /** 当前指纹：持有中的用监视维护的那份，否则现算。 */
  current(root: string): Promise<string> {
    return this.roots.get(root)?.hash ?? webSourceContentHash(root)
  }

  private watch(root: string, entry: WatchedRoot, recovering: boolean): void {
    if (this.roots.get(root) !== entry || entry.watcher) return
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, name) => {
        // 被监视的文件夹本身被删掉时（Windows 实测），监视不报错，只会不停地报这个文件夹自己的改名（文件名是它的绝对路径），
        // 之后重建的同名文件夹也看不到：丢掉这个监视，隔一会儿重新监视，建好后补一次散列。
        if (typeof name === 'string' && path.isAbsolute(name) || !fs.existsSync(root)) {
          this.unwatch(entry, watcher)
          this.scheduleWatch(root, entry)
          return
        }
        this.scheduleHash(root, entry, SETTLE_MS)
      })
      entry.watcher = watcher
      watcher.on('error', error => {
        if (!entry.watchWarned) this.logger.warn('网页文件夹监视中断，稍后重新监视', { event: 'web_source.content.watch_failed', error, context: { root } })
        entry.watchWarned = true
        this.unwatch(entry, watcher)
        this.scheduleWatch(root, entry)
      })
      watcher.unref?.()
      entry.watchWarned = false
      // 重新监视之前的改动没人看到：补一次散列。
      if (recovering) this.scheduleHash(root, entry, 0)
    } catch (error) {
      if (!entry.watchWarned) this.logger.warn('无法监视网页文件夹，稍后重试', { event: 'web_source.content.watch_failed', error, context: { root } })
      entry.watchWarned = true
      this.scheduleWatch(root, entry)
    }
  }

  private unwatch(entry: WatchedRoot, watcher = entry.watcher): void {
    watcher?.close()
    if (entry.watcher === watcher) entry.watcher = undefined
  }

  private scheduleWatch(root: string, entry: WatchedRoot): void {
    clearTimeout(entry.watchTimer)
    entry.watchTimer = setTimeout(() => { entry.watchTimer = undefined; this.watch(root, entry, true) }, RETRY_MS)
  }

  private scheduleHash(root: string, entry: WatchedRoot, delay: number): void {
    clearTimeout(entry.hashTimer)
    entry.hashTimer = setTimeout(() => { entry.hashTimer = undefined; void this.rehash(root, entry) }, delay)
  }

  private async rehash(root: string, entry: WatchedRoot): Promise<void> {
    if (this.roots.get(root) !== entry) return
    // 大文件夹散列较慢时可能有两次同时在算：只认最后开始的那次，先开始、后算完的旧结果不能盖掉新的
    const generation = entry.hashGeneration = (entry.hashGeneration ?? 0) + 1
    const previous = await entry.hash.catch(() => undefined)
    let hash: string
    try {
      hash = await webSourceContentHash(root)
    } catch (error) {
      if (this.roots.get(root) === entry && entry.hashGeneration === generation) this.hashFailed(root, entry, error)
      return
    }
    if (this.roots.get(root) !== entry || entry.hashGeneration !== generation) return
    entry.hash = Promise.resolve(hash)
    entry.hashWarned = false
    if (!entry.watcher && !entry.watchTimer) this.watch(root, entry, false)
    if (hash === previous) return
    this.logger.info('网页文件夹内容已变化', { event: 'web_source.content.changed', context: { root, hash } })
    this.onChanged(root, hash, [...entry.paths])
  }

  /**
   * 读不出来多半是文件夹正被整个替换或已删掉：保留上一次的指纹，丢掉可能已经失效的旧监视，隔一会儿重新监视，
   * 监视建好后补一次散列。
   */
  private hashFailed(root: string, entry: WatchedRoot, error: unknown): void {
    if (!entry.hashWarned) this.logger.warn('网页文件夹读不出来，等它恢复后重新散列', { event: 'web_source.content.hash_failed', error, context: { root } })
    entry.hashWarned = true
    this.unwatch(entry)
    this.scheduleWatch(root, entry)
  }

  dispose(): void {
    for (const entry of this.roots.values()) { clearTimeout(entry.watchTimer); clearTimeout(entry.hashTimer); entry.watcher?.close() }
    this.roots.clear()
  }
}
