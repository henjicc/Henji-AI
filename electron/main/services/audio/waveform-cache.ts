import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 多级波形的磁盘缓存（任务 2.3）：按内容身份命名的 `.hwpk` 文件，临时文件 + 改名原子写入；
 * 读命中刷新修改时间，总量超过上限时按最久未用删除。文件内容由调用方解码校验，坏文件调用 remove。
 */
export interface WaveformDiskCache {
  read(key: string): Promise<Uint8Array | undefined>
  write(key: string, bytes: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
  prune(): Promise<{ removed: number; bytes: number }>
}

export interface WaveformDiskCacheOptions {
  /** 缓存目录；返回 undefined 时缓存停用（例如宿主尚未提供 userData）。 */
  directory: () => string | undefined
  budgetBytes?: number
  onError?: (event: string, error: unknown) => void
}

const EXTENSION = '.hwpk'
const KEY_PATTERN = /^[0-9a-f]{64}$/
const STALE_TEMPORARY_MS = 10 * 60 * 1000

export function createWaveformDiskCache(options: WaveformDiskCacheOptions): WaveformDiskCache {
  const budget = options.budgetBytes ?? 512 * 1024 * 1024
  let pruning: Promise<{ removed: number; bytes: number }> | undefined
  let prunedOnce = false
  const directory = (): string | undefined => {
    try { return options.directory() } catch { return undefined }
  }
  const file = (key: string): string | undefined => {
    if (!KEY_PATTERN.test(key)) throw new Error('无效的波形缓存键。')
    const root = directory()
    return root ? path.join(root, `${key}${EXTENSION}`) : undefined
  }
  const prune = (): Promise<{ removed: number; bytes: number }> => {
    pruning ??= (async () => {
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
          } else if (name.endsWith(EXTENSION) && stat.isFile()) entries.push({ file: target, size: stat.size, used: stat.mtimeMs })
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
  return {
    async read(key) {
      const target = file(key)
      if (!target) return undefined
      try {
        const bytes = await fs.readFile(target)
        const now = new Date()
        // Touch before the first-use prune so the entry being read is the most recently used one.
        await fs.utimes(target, now, now).catch(() => undefined)
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.onError?.('read', error)
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
      prunedOnce = true
      void prune().catch((error) => options.onError?.('prune', error))
    },
    async remove(key) {
      const target = file(key)
      if (target) await fs.rm(target, { force: true })
    },
    prune,
  }
}
