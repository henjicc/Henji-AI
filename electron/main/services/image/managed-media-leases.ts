import path from 'node:path'

interface ManagedMediaLeaseEntry {
  count: number
}

export type ManagedMediaLeaseRelease = 'untracked' | 'retained' | 'delete'

const leases = new Map<string, ManagedMediaLeaseEntry>()
const acquisitionTails = new Map<string, Promise<void>>()

function normalize(filePath: string): string {
  return path.resolve(filePath)
}

async function withAcquisitionLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const key = normalize(filePath)
  const previous = acquisitionTails.get(key) ?? Promise.resolve()
  let releaseLock: (() => void) | undefined
  const current = new Promise<void>((resolve) => { releaseLock = resolve })
  acquisitionTails.set(key, current)
  await previous
  try {
    return await action()
  } finally {
    releaseLock?.()
    if (acquisitionTails.get(key) === current) acquisitionTails.delete(key)
  }
}

/**
 * 为内容寻址 Media 文件取得一次进程内所有权。
 * 已由本进程持有时直接增加租约；无租约时只有物理新建成功才取得首个租约。
 */
export async function acquireManagedMediaFileLease(
  filePath: string,
  tryCreate: () => Promise<boolean>,
): Promise<boolean> {
  const key = normalize(filePath)
  return await withAcquisitionLock(key, async () => {
    const active = leases.get(key)
    if (active) {
      active.count += 1
      return true
    }
    if (!await tryCreate()) return false
    leases.set(key, { count: 1 })
    return true
  })
}

/** 返回 delete 时调用方才可删除文件；untracked 保留旧式非租约媒体的兼容处理。 */
export function releaseManagedMediaFileLease(filePath: string): ManagedMediaLeaseRelease {
  const key = normalize(filePath)
  const active = leases.get(key)
  if (!active) return 'untracked'
  if (active.count > 1) {
    active.count -= 1
    return 'retained'
  }
  leases.delete(key)
  return 'delete'
}

export function resetManagedMediaFileLeasesForTest(): void {
  leases.clear()
  acquisitionTails.clear()
}
