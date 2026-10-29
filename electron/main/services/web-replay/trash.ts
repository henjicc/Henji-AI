import { RECYCLE_RETENTION_MS } from '../../../../src/core/localRecords/recycle'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 删除的网页录制在回收区里留多久：期间随时可以恢复，满期后启动时彻底删掉。 */
export const WEB_RECORDING_TRASH_RETENTION_MS = RECYCLE_RETENTION_MS

const DELETED_AT = '.deleted-at'
const ORIGIN = '.origin.json'

const deletedAtFile = (trash: string, id: string): string => path.join(trash, `${id}${DELETED_AT}`)

/** 同一录制再次删除时给旧副本独立身份，保留原来的恢复位置和保留期限。 */
export async function vacateWebRecordingTrash(trash: string, id: string): Promise<void> {
  try { await fs.access(path.join(trash, id)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const archived = randomUUID()
  for (const suffix of [DELETED_AT, ORIGIN]) {
    try { await fs.copyFile(path.join(trash, `${id}${suffix}`), path.join(trash, `${archived}${suffix}`)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  await fs.rename(path.join(trash, id), path.join(trash, archived))
  for (const suffix of [DELETED_AT, ORIGIN]) await fs.rm(path.join(trash, `${id}${suffix}`), { force: true })
}

/** 记下移进回收区的时刻。目录挪动不改它自己的修改时间，所以不能拿目录时间当删除时间。 */
export async function markWebRecordingTrashed(trash: string, id: string, at = new Date()): Promise<void> {
  await fs.writeFile(deletedAtFile(trash, id), at.toISOString())
}

export async function forgetWebRecordingTrashMark(trash: string, id: string): Promise<void> {
  await fs.rm(deletedAtFile(trash, id), { force: true })
}

export interface WebRecordingTrashPurge {
  purged: string[]
  failed: Array<{ id: string; error: string }>
}

/**
 * 清掉回收区里删除满期的录制，连同它的删除时刻与原位置记录。没有删除时刻的（这项功能之前删的）从现在起算，
 * 不按目录时间猜，免得刚删的旧录制一启动就没了；目录已不在的残留记录一并清掉。单项失败不影响其他项。
 */
export async function purgeExpiredWebRecordingTrash(trash: string, now = Date.now()): Promise<WebRecordingTrashPurge> {
  const result: WebRecordingTrashPurge = { purged: [], failed: [] }
  const entries = await fs.readdir(trash, { withFileTypes: true }).catch(() => null)
  if (!entries) return result
  const directories = new Set(entries.filter(entry => entry.isDirectory()).map(entry => entry.name))
  for (const id of directories) {
    try {
      const deletedAt = Date.parse(await fs.readFile(deletedAtFile(trash, id), 'utf8').catch(() => ''))
      if (!Number.isFinite(deletedAt)) { await markWebRecordingTrashed(trash, id, new Date(now)); continue }
      if (now - deletedAt < WEB_RECORDING_TRASH_RETENTION_MS) continue
      await fs.rm(path.join(trash, id), { recursive: true, force: true })
      await fs.rm(path.join(trash, `${id}${ORIGIN}`), { force: true })
      await forgetWebRecordingTrashMark(trash, id)
      result.purged.push(id)
    } catch (error) {
      result.failed.push({ id, error: String(error) })
    }
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const suffix = [DELETED_AT, ORIGIN].find(value => entry.name.endsWith(value))
    if (suffix && !directories.has(entry.name.slice(0, -suffix.length))) await fs.rm(path.join(trash, entry.name), { force: true }).catch(() => undefined)
  }
  return result
}
