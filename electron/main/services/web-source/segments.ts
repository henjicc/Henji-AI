import fs from 'node:fs/promises'
import path from 'node:path'
import type { MediaCacheFamilyEntry } from '../media/media-cache'
import { WebCacheLockBusy, type WebCacheLocks, type WebCacheSegmentLease } from './locks'

const FAMILY = /^([a-f0-9]{64})-(\d+)(\.tmp-.+)?$/

export interface WebCacheSegmentHold { root: string; lease: WebCacheSegmentLease; release(): Promise<void> }

/** 网页段的三个文件共用容量、最近使用时间和内核锁，不允许通用缓存逐个删成员。 */
export class WebCacheSegments {
  constructor(readonly directory: () => string | undefined, private readonly locks: WebCacheLocks) {}

  /** 解封装器仍打开文件时保留内核锁，避免 Windows 目录回收与跨实例发布撞上在用文件。 */
  hold(key: string, index: number): Promise<WebCacheSegmentHold | undefined> {
    let ready!: (value: WebCacheSegmentHold | undefined) => void
    let failed!: (error: unknown) => void
    const acquired = new Promise<WebCacheSegmentHold | undefined>((resolve, reject) => { ready = resolve; failed = reject })
    const finished = this.read(key, index, async (root, lease) => {
      let release!: () => void
      const retained = new Promise<void>(resolve => { release = resolve })
      ready({ root, lease, release: async () => {
        release()
        try { await finished } catch (error) { if (!lease.signal.aborted) throw error }
      } })
      await retained
    })
    void finished.then(() => ready(undefined), failed)
    return acquired
  }

  async read<T>(key: string, index: number, work: (root: string, lease: WebCacheSegmentLease) => Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
    const directory = this.directory()
    if (!directory) return undefined
    let root: string
    try { root = await fs.realpath(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    try { return await this.locks.withSegmentLock(`${root}:${key}:${index}`, lease => work(root, lease), signal, false) }
    catch (error) { if (error instanceof WebCacheLockBusy) return undefined; throw error }
  }

  async touch(directory: string): Promise<void> {
    const now = new Date()
    await fs.utimes(directory, now, now)
  }

  async list(): Promise<MediaCacheFamilyEntry[]> {
    const directory = this.directory()
    if (!directory) return []
    let names
    try { names = await fs.readdir(directory, { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const result: MediaCacheFamilyEntry[] = []
    for (const name of names) {
      const match = FAMILY.exec(name.name)
      if (!match || !name.isDirectory() || name.isSymbolicLink()) continue
      const file = path.join(directory, name.name)
      try {
        const stat = await fs.stat(file), size = await familySize(file)
        result.push({ file, size: size.bytes, fileCount: size.files, usedMs: stat.mtimeMs, temporary: !!match[3], remove: async () => {
          const removed = await this.read(match[1], Number(match[2]), async (root, lease) => {
            const current = await fs.stat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error })
            if (!current || current.mtimeMs !== stat.mtimeMs || current.ino !== stat.ino) return false
            return lease.discard(path.join(root, name.name))
          })
          return removed === true
        } })
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return result
  }
}

async function familySize(directory: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0, files = 0
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { const size = await familySize(file); bytes += size.bytes; files += size.files }
    else if (entry.isFile()) { bytes += (await fs.stat(file)).size; files++ }
  }
  return { bytes, files }
}
