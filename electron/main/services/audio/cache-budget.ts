import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { autoMediaCacheBudgetBytes } from '../../../../src/core/media/mediaCache'
import { getMediaCacheManager } from '../media/media-cache-runtime'

/*
 * 音频派生物缓存的统一预算，按这台电脑的物理内存与作品磁盘取值。
 * 预算只是淘汰目标：超出时按最近使用淘汰，从不因此拒绝操作。
 * 内存份额以 64 GB 机器为参照：份额 1/64 约 1 GB。
 */

/** 物理内存的 1/denominator，不低于 minBytes：内存很小的机器也要能装下十分钟级素材的派生物。 */
export function audioMemoryBudgetBytes(denominator: number, minBytes: number, totalBytes = os.totalmem()): number {
  return Math.max(minBytes, Math.floor(totalBytes / denominator))
}

/** 全局媒体缓存当前的总容量上限（用户固定值，或按作品磁盘可用空间自动取值）。 */
export function mediaCacheBudgetBytes(): number {
  const manager = getMediaCacheManager()
  const fixed = manager.readSettings().budgetGb
  if (fixed !== null) return fixed * 1024 ** 3
  let probe = manager.cacheRoot()
  let available: number | null = null
  // 缓存目录可能还没建：向上找到已存在的目录读磁盘空间。
  while (probe && available === null) {
    try { const disk = fs.statfsSync(probe); available = Number(disk.bavail) * Number(disk.bsize) } catch {
      const parent = path.dirname(probe)
      probe = parent === probe ? undefined : parent
    }
  }
  return autoMediaCacheBudgetBytes(available)
}

/** 全局媒体缓存上限的 1/denominator，不低于 minBytes；跨类总量仍由全局缓存管理统一执行。 */
export function audioDiskBudgetBytes(denominator: number, minBytes: number): number {
  return Math.max(minBytes, Math.floor(mediaCacheBudgetBytes() / denominator))
}
