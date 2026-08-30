import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'
import { writeBufferAtomically } from './atomic-file'
import { KeyedSerialExecutor } from './serial-executor'

export const DEFAULT_DERIVED_CACHE_QUOTA_BYTES = 8 * 1024 * 1024 * 1024
export const DEFAULT_DERIVED_CACHE_MAX_ENTRY_BYTES = 512 * 1024 * 1024
export const DERIVED_CACHE_KINDS = ['proxy', 'pyramid', 'tile', 'analysis'] as const
export type DerivedCacheKind = typeof DERIVED_CACHE_KINDS[number]

export interface DerivedCacheAddress {
  kind: DerivedCacheKind
  /** 调用方应包含源指纹、子树哈希、节点版本、参数、mip、质量、后端与颜色模式。 */
  key: string
}

export interface DerivedCacheLease {
  release(): Promise<void>
}

export interface DerivedCacheFileLease extends DerivedCacheLease {
  readonly filePath: string
  readonly byteLength: number
}

export interface DerivedCacheStreamLease extends DerivedCacheFileLease {
  readonly stream: fs.ReadStream
}

export interface DerivedCacheEvictionResult {
  quotaBytes: number
  totalBytes: number
  evictedBytes: number
  evictedEntries: number
  retainedByLease: number
}

interface CacheEntry {
  identity: string
  filePath: string
  byteLength: number
  lastAccessMs: number
}

const logger = createMainLogger('main.image_editor_v3.derived_cache')
const CACHE_KEY_MAX_BYTES = 1024 * 1024
const TOUCH_FLUSH_DELAY_MS = 1_000

function normalizeAddress(address: DerivedCacheAddress): {
  kind: DerivedCacheKind
  hash: string
  identity: string
} {
  if (!(DERIVED_CACHE_KINDS as readonly string[]).includes(address.kind)) {
    throw new Error(`Unsupported derived cache kind: ${String(address.kind)}`)
  }
  if (!address.key || Buffer.byteLength(address.key, 'utf8') > CACHE_KEY_MAX_BYTES) {
    throw new Error('Invalid derived cache key')
  }
  const hash = crypto.createHash('sha256').update(address.kind).update('\0').update(address.key).digest('hex')
  return { kind: address.kind, hash, identity: `${address.kind}:${hash}` }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * 全局派生缓存只接受可重建数据。索引在首次访问时扫描一次，之后由当前进程增量维护；
 * 高频命中只更新内存 LRU，mtime 合并写回，避免逐瓦片全盘 stat/sort 和同步 touch。
 */
export class DerivedDiskCache {
  private readonly executor = new KeyedSerialExecutor()
  private readonly leaseCounts = new Map<string, number>()
  private readonly entries = new Map<string, CacheEntry>()
  private readonly pendingTouches = new Map<string, number>()
  private indexLoaded = false
  private indexedTotalBytes = 0
  private touchTimer: NodeJS.Timeout | undefined

  readonly maxEntryBytes: number

  constructor(
    readonly rootDir: string,
    readonly quotaBytes = DEFAULT_DERIVED_CACHE_QUOTA_BYTES,
    maxEntryBytes = Math.min(DEFAULT_DERIVED_CACHE_MAX_ENTRY_BYTES, quotaBytes),
  ) {
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1) throw new Error('Invalid derived cache quota')
    if (!Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1 || maxEntryBytes > quotaBytes) {
      throw new Error('Invalid derived cache entry limit')
    }
    this.maxEntryBytes = maxEntryBytes
  }

  resolveEntryPath(address: DerivedCacheAddress): string {
    const { kind, hash } = normalizeAddress(address)
    return path.join(this.rootDir, kind, hash.slice(0, 2), `${hash}.cache`)
  }

  async put(address: DerivedCacheAddress, bytes: Uint8Array): Promise<DerivedCacheEvictionResult> {
    if (bytes.byteLength > this.maxEntryBytes) {
      throw new Error(`Derived cache entry exceeds ${this.maxEntryBytes} byte admission limit`)
    }
    const normalized = normalizeAddress(address)
    const filePath = this.resolveEntryPath(address)
    return this.executor.run('cache-index', async () => {
      await this.ensureIndexLoadedLocked()
      const previous = this.entries.get(normalized.identity)
      const previousLeased = previous && (this.leaseCounts.get(previous.identity) ?? 0) > 0
      const leasedBytes = [...this.entries.values()].reduce((sum, entry) => (
        sum + ((this.leaseCounts.get(entry.identity) ?? 0) > 0 ? entry.byteLength : 0)
      ), 0)
      // 新项必须能在保留全部 lease 的前提下留在配额内；否则不进行一次注定会被
      // 立即逐出的写盘。相同 identity 被租用时也不能替换其路径内容。
      if (previousLeased || leasedBytes + bytes.byteLength > this.quotaBytes) {
        logger.debug('图片编辑派生缓存拒绝超预算写入', {
          event: 'image_editor_v3.derived_cache.put.admission_rejected',
          context: {
            cacheIdentity: normalized.identity,
            incomingBytes: bytes.byteLength,
            leasedBytes,
            quotaBytes: this.quotaBytes,
            previousLeased: Boolean(previousLeased),
          },
        })
        return {
          quotaBytes: this.quotaBytes,
          totalBytes: this.indexedTotalBytes,
          evictedBytes: 0,
          evictedEntries: 0,
          retainedByLease: this.leaseCounts.size,
        }
      }
      await writeBufferAtomically(filePath, bytes)
      if (previous) this.indexedTotalBytes -= previous.byteLength
      const entry: CacheEntry = {
        identity: normalized.identity,
        filePath,
        byteLength: bytes.byteLength,
        lastAccessMs: Date.now(),
      }
      this.entries.set(normalized.identity, entry)
      this.indexedTotalBytes += entry.byteLength
      this.pendingTouches.delete(normalized.identity)
      return this.enforceQuotaLocked()
    })
  }

  /** 兼容小对象调用方；大型项应使用 acquireFileLease/openReadStream。 */
  async get(address: DerivedCacheAddress): Promise<Buffer | null> {
    const normalized = normalizeAddress(address)
    const lease = await this.acquireFileLease(address)
    if (!lease) return null
    try {
      return await fsp.readFile(lease.filePath)
    } catch (error) {
      if (isNotFound(error)) return null
      logger.warn('读取图片编辑派生缓存失败', {
        event: 'image_editor_v3.derived_cache.read.failed',
        context: { cacheIdentity: normalized.identity },
        error,
      })
      throw error
    } finally {
      await lease.release()
    }
  }

  async openReadStream(address: DerivedCacheAddress): Promise<DerivedCacheStreamLease | null> {
    const lease = await this.acquireFileLease(address)
    if (!lease) return null
    const stream = fs.createReadStream(lease.filePath)
    const release = lease.release.bind(lease)
    stream.once('close', () => { void release().catch(() => undefined) })
    stream.once('error', () => { void release().catch(() => undefined) })
    return { ...lease, stream, release }
  }

  async has(address: DerivedCacheAddress): Promise<boolean> {
    const normalized = normalizeAddress(address)
    return this.executor.run('cache-index', async () => {
      await this.ensureIndexLoadedLocked()
      const entry = this.entries.get(normalized.identity)
      if (!entry) return false
      const exists = await fsp.access(entry.filePath).then(() => true).catch(() => false)
      if (!exists) this.removeEntryFromIndexLocked(entry)
      return exists
    })
  }

  async acquireFileLease(address: DerivedCacheAddress): Promise<DerivedCacheFileLease | null> {
    const normalized = normalizeAddress(address)
    return this.executor.run('cache-index', async () => {
      await this.ensureIndexLoadedLocked()
      const entry = this.entries.get(normalized.identity)
      if (!entry) return null
      const exists = await fsp.access(entry.filePath).then(() => true).catch(() => false)
      if (!exists) {
        this.removeEntryFromIndexLocked(entry)
        return null
      }
      this.leaseCounts.set(normalized.identity, (this.leaseCounts.get(normalized.identity) ?? 0) + 1)
      this.touchEntryLocked(entry)
      let released = false
      return {
        filePath: entry.filePath,
        byteLength: entry.byteLength,
        release: async (): Promise<void> => {
          if (released) return
          released = true
          await this.executor.run('cache-index', async () => {
            const next = (this.leaseCounts.get(normalized.identity) ?? 1) - 1
            if (next <= 0) this.leaseCounts.delete(normalized.identity)
            else this.leaseCounts.set(normalized.identity, next)
          })
        },
      }
    })
  }

  async acquireLease(address: DerivedCacheAddress): Promise<DerivedCacheLease> {
    const normalized = normalizeAddress(address)
    const lease = await this.acquireFileLease(address)
    if (!lease) throw new Error(`Derived cache entry not found: ${normalized.identity}`)
    return { release: lease.release }
  }

  async invalidate(address: DerivedCacheAddress): Promise<boolean> {
    const normalized = normalizeAddress(address)
    return this.executor.run('cache-index', async () => {
      await this.ensureIndexLoadedLocked()
      if ((this.leaseCounts.get(normalized.identity) ?? 0) > 0) return false
      const entry = this.entries.get(normalized.identity)
      if (!entry) return false
      try {
        await fsp.rm(entry.filePath, { force: true })
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      this.removeEntryFromIndexLocked(entry)
      return true
    })
  }

  async enforceQuota(): Promise<DerivedCacheEvictionResult> {
    return this.executor.run('cache-index', async () => {
      await this.ensureIndexLoadedLocked()
      return this.enforceQuotaLocked()
    })
  }

  /** 关闭会话或测试收尾时可显式刷回批量 LRU touch。 */
  async flushTouches(): Promise<void> {
    if (this.touchTimer) clearTimeout(this.touchTimer)
    this.touchTimer = undefined
    await this.executor.run('cache-index', () => this.flushTouchesLocked())
  }

  private async enforceQuotaLocked(): Promise<DerivedCacheEvictionResult> {
    let evictedBytes = 0
    let evictedEntries = 0
    let retainedByLease = 0
    if (this.indexedTotalBytes <= this.quotaBytes) {
      return {
        quotaBytes: this.quotaBytes,
        totalBytes: this.indexedTotalBytes,
        evictedBytes,
        evictedEntries,
        retainedByLease,
      }
    }
    const candidates = [...this.entries.values()]
      .sort((left, right) => left.lastAccessMs - right.lastAccessMs)
    for (const entry of candidates) {
      if (this.indexedTotalBytes <= this.quotaBytes) break
      if ((this.leaseCounts.get(entry.identity) ?? 0) > 0) {
        retainedByLease += 1
        continue
      }
      await fsp.rm(entry.filePath, { force: true })
      this.removeEntryFromIndexLocked(entry)
      evictedBytes += entry.byteLength
      evictedEntries += 1
    }
    const result = {
      quotaBytes: this.quotaBytes,
      totalBytes: this.indexedTotalBytes,
      evictedBytes,
      evictedEntries,
      retainedByLease,
    }
    if (evictedEntries > 0 || this.indexedTotalBytes > this.quotaBytes) {
      logger.debug('图片编辑派生缓存完成 LRU 逐出', {
        event: 'image_editor_v3.derived_cache.evict.completed',
        context: result,
      })
    }
    return result
  }

  private touchEntryLocked(entry: CacheEntry): void {
    const now = Date.now()
    entry.lastAccessMs = now
    this.pendingTouches.set(entry.identity, now)
    if (this.touchTimer) return
    this.touchTimer = setTimeout(() => {
      this.touchTimer = undefined
      void this.executor.run('cache-index', () => this.flushTouchesLocked()).catch((error: unknown) => {
        logger.warn('刷新图片编辑派生缓存 LRU 失败', {
          event: 'image_editor_v3.derived_cache.touch.failed', error,
        })
      })
    }, TOUCH_FLUSH_DELAY_MS)
    this.touchTimer.unref()
  }

  private async flushTouchesLocked(): Promise<void> {
    const touches = [...this.pendingTouches]
    this.pendingTouches.clear()
    for (const [identity, touchedAt] of touches) {
      const entry = this.entries.get(identity)
      if (!entry) continue
      const timestamp = new Date(touchedAt)
      await fsp.utimes(entry.filePath, timestamp, timestamp).catch(() => undefined)
    }
  }

  private removeEntryFromIndexLocked(entry: CacheEntry): void {
    if (!this.entries.delete(entry.identity)) return
    this.indexedTotalBytes -= entry.byteLength
    this.pendingTouches.delete(entry.identity)
  }

  private async ensureIndexLoadedLocked(): Promise<void> {
    if (this.indexLoaded) return
    const entries = await this.scanEntries()
    this.entries.clear()
    this.indexedTotalBytes = 0
    for (const entry of entries) {
      this.entries.set(entry.identity, entry)
      this.indexedTotalBytes += entry.byteLength
    }
    this.indexLoaded = true
  }

  private async scanEntries(): Promise<CacheEntry[]> {
    const entries: CacheEntry[] = []
    for (const kind of DERIVED_CACHE_KINDS) {
      const kindDir = path.join(this.rootDir, kind)
      const prefixes = await fsp.readdir(kindDir, { withFileTypes: true }).catch(() => [])
      for (const prefix of prefixes) {
        if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue
        const prefixDir = path.join(kindDir, prefix.name)
        const files = await fsp.readdir(prefixDir, { withFileTypes: true }).catch(() => [])
        for (const file of files) {
          const match = /^([a-f0-9]{64})\.cache$/.exec(file.name)
          if (!file.isFile() || !match?.[1]) continue
          const filePath = path.join(prefixDir, file.name)
          const stats = await fsp.stat(filePath).catch(() => undefined)
          if (!stats?.isFile()) continue
          entries.push({
            identity: `${kind}:${match[1]}`,
            filePath,
            byteLength: stats.size,
            lastAccessMs: stats.mtimeMs,
          })
        }
      }
    }
    return entries
  }
}
