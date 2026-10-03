import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 按内容身份命名的媒体派生物磁盘缓存（任务 2.3 波形 `.hwpk`、2.4 片段缩略帧 `.webp` 共用）：
 * 键是 64 位十六进制摘要；临时文件 + 改名原子写入；读命中刷新修改时间，总量超过上限时按最久未用删除，
 * 同时清理残留临时文件。文件内容由调用方解码校验，坏文件调用 remove。
 */
export interface ContentDiskCache {
  /** 读出整个文件（波形）；未命中返回 undefined。 */
  read(key: string): Promise<Uint8Array | undefined>
  /** 只确认存在并刷新使用时间，返回文件路径（缩略帧由渲染层按路径显示）；未命中返回 undefined。 */
  locate(key: string): Promise<string | undefined>
  write(key: string, bytes: Uint8Array): Promise<void>
  /** 建好目录并给出供外部进程直接写出的临时文件路径（与 `adopt` 配对，清理规则与 write 的临时文件相同）；缓存停用时返回 undefined。 */
  prepareTemporary(key: string): Promise<string | undefined>
  /** 把外部写好的临时文件原子改名为缓存文件并返回路径。 */
  adopt(key: string, temporaryFile: string): Promise<string>
  remove(key: string): Promise<void>
  prune(): Promise<{ removed: number; bytes: number }>
}

export interface ContentDiskCacheOptions {
  /** 缓存目录；返回 undefined 时缓存停用（例如宿主尚未提供 userData）。 */
  directory: () => string | undefined
  /** 缓存文件扩展名（含点），如 `.hwpk`、`.webp`。 */
  extension: string
  budgetBytes?: number
  /** 两次写入后清理之间的最短间隔；文件多而小的缓存（缩略帧）用它避免每次写入都扫描目录。默认 0。 */
  pruneIntervalMs?: number
  onError?: (event: string, error: unknown) => void
}

const KEY_PATTERN = /^[0-9a-f]{64}$/
const STALE_TEMPORARY_MS = 10 * 60 * 1000

export function createContentDiskCache(options: ContentDiskCacheOptions): ContentDiskCache {
  const extension = options.extension
  if (!/^\.[a-z0-9]{1,8}$/.test(extension)) throw new Error('无效的缓存扩展名。')
  const budget = options.budgetBytes ?? 512 * 1024 * 1024
  const pruneInterval = options.pruneIntervalMs ?? 0
  let pruning: Promise<{ removed: number; bytes: number }> | undefined
  let prunedOnce = false
  let lastPrune = 0
  const directory = (): string | undefined => {
    try { return options.directory() } catch { return undefined }
  }
  const file = (key: string): string | undefined => {
    if (!KEY_PATTERN.test(key)) throw new Error('无效的缓存键。')
    const root = directory()
    return root ? path.join(root, `${key}${extension}`) : undefined
  }
  const prune = (): Promise<{ removed: number; bytes: number }> => {
    pruning ??= (async () => {
      lastPrune = Date.now()
      const root = directory()
      if (!root) return { removed: 0, bytes: 0 }
      let names: string[]
      try { names = await fs.readdir(root) } catch { return { removed: 0, bytes: 0 } }
      const now = Date.now()
      const entries: Array<{ file: string; size: number; used: number }> = []
      let removed = 0
      for (const name of names) {
        const target = path.join(root, name)
        try {
          const stat = await fs.stat(target)
          if (name.endsWith('.tmp')) {
            if (now - stat.mtimeMs > STALE_TEMPORARY_MS) { await fs.rm(target, { force: true }); removed++ }
          } else if (name.endsWith(extension) && stat.isFile()) entries.push({ file: target, size: stat.size, used: stat.mtimeMs })
        } catch { /* 并发删除或无权限：跳过该项 */ }
      }
      let total = entries.reduce((sum, entry) => sum + entry.size, 0)
      if (total > budget) {
        entries.sort((a, b) => a.used - b.used)
        const target = budget * 0.8
        for (const entry of entries) {
          if (total <= target) break
          try { await fs.rm(entry.file, { force: true }); total -= entry.size; removed++ } catch (error) { options.onError?.('prune', error) }
        }
      }
      return { removed, bytes: total }
    })().finally(() => { pruning = undefined })
    return pruning
  }
  const pruneOnFirstUse = (): void => {
    if (prunedOnce) return
    prunedOnce = true
    void prune().catch((error) => options.onError?.('prune', error))
  }
  const pruneAfterWrite = (): void => {
    prunedOnce = true
    if (Date.now() - lastPrune < pruneInterval) return
    void prune().catch((error) => options.onError?.('prune', error))
  }
  const touch = async (target: string): Promise<void> => {
    const now = new Date()
    await fs.utimes(target, now, now).catch(() => undefined)
  }
  return {
    async read(key) {
      const target = file(key)
      if (!target) return undefined
      try {
        const bytes = await fs.readFile(target)
        // Touch before the first-use prune so the entry being read is the most recently used one.
        await touch(target)
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.onError?.('read', error)
        return undefined
      } finally {
        pruneOnFirstUse()
      }
    },
    async locate(key) {
      const target = file(key)
      if (!target) return undefined
      try {
        const stat = await fs.stat(target)
        if (!stat.isFile() || stat.size === 0) return undefined
        await touch(target)
        return target
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.onError?.('locate', error)
        return undefined
      } finally {
        pruneOnFirstUse()
      }
    },
    async write(key, bytes) {
      const target = file(key)
      if (!target) return
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(temporary, bytes)
        await fs.rename(temporary, target)
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
      pruneAfterWrite()
    },
    async prepareTemporary(key) {
      const target = file(key)
      if (!target) return undefined
      await fs.mkdir(path.dirname(target), { recursive: true })
      return `${target}.${randomUUID()}.tmp`
    },
    async adopt(key, temporaryFile) {
      const target = file(key)
      if (!target) throw new Error('缓存目录不可用。')
      if (path.dirname(temporaryFile) !== path.dirname(target) || !path.basename(temporaryFile).startsWith(`${key}${extension}.`) || !temporaryFile.endsWith('.tmp')) throw new Error('临时文件不属于该缓存键。')
      try {
        await fs.rename(temporaryFile, target)
      } catch (error) {
        await fs.rm(temporaryFile, { force: true }).catch(() => undefined)
        throw error
      }
      pruneAfterWrite()
      return target
    },
    async remove(key) {
      const target = file(key)
      if (target) await fs.rm(target, { force: true })
    },
    prune,
  }
}
