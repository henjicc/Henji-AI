import fs from 'node:fs/promises'
import path from 'node:path'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'

/**
 * 细层（level < 3）频谱块按需计算、按块落盘，每块约 5 MB；声音每改一次，看过的块就换一套。
 * 它们单独限额、按最近使用清理（读取时刷新修改时间），不靠全局的容量上限兜底。
 */
export const SPECTRAL_TILE_BUDGET_BYTES = 1024 ** 3
/** 刚用过的块不删：读取方可能正要打开它。 */
const RECENT_MS = 60_000
/** 只认发布后的块（内容哈希名）；计算中的临时文件是随机名，不动。 */
const TILE_NAME = /^[a-f0-9]{64}\.rg$/

export async function touchSpectralTile(file: string, now = new Date()): Promise<void> {
  await fs.utimes(file, now, now).catch(() => undefined)
}

export async function trimSpectralTiles(directory: string, options: { budgetBytes?: number; nowMs?: number } = {}): Promise<{ removedFiles: number; removedBytes: number }> {
  const budget = options.budgetBytes ?? SPECTRAL_TILE_BUDGET_BYTES, now = options.nowMs ?? Date.now()
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const tiles = (await Promise.all(entries.filter(entry => entry.isFile() && TILE_NAME.test(entry.name)).map(async entry => {
    const file = path.join(directory, entry.name)
    const stat = await fs.stat(file).catch(() => null)
    return stat ? { file, size: stat.size, usedMs: stat.mtimeMs } : null
  }))).filter((tile): tile is NonNullable<typeof tile> => tile !== null)
  let total = tiles.reduce((sum, tile) => sum + tile.size, 0)
  const result = { removedFiles: 0, removedBytes: 0 }
  if (total <= budget) return result
  // 清到上限的八成，免得每写一块就清一次。
  for (const tile of tiles.sort((a, b) => a.usedMs - b.usedMs)) {
    if (total <= budget * 0.8) break
    if (now - tile.usedMs < RECENT_MS) continue
    try { await removeUnmanagedCachePath(tile.file, { force: true }) } catch { continue }
    total -= tile.size; result.removedFiles++; result.removedBytes += tile.size
  }
  return result
}
