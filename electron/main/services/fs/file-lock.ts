import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createMainLogger } from '../logging/main-logger'

/*
 * 跨进程文件锁：同一份数据可能同时被正式窗口与无窗口助手进程写入，进程内的串行执行器挡不住，
 * 用独占创建的锁文件互斥。持有者心跳续期，过期且进程已退出才接管。
 * 图片编辑器文档仓库与通用文档仓库共用这一份实现。
 */

export interface FileLockOptions {
  /** 等待锁的最长时间。 */
  timeoutMs?: number
  /** 心跳超过此时长且持有进程已退出时才回收。 */
  staleMs?: number
  /** 超时错误信息。 */
  timeoutMessage?: string
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_STALE_MS = 30_000
const RETRY_DELAY_MS = 10
const logger = createMainLogger('main.fs.file_lock')

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined
}

function ownerAlive(value: string): boolean {
  const pid = Number(value.split(' ')[0])
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return errorCode(error) !== 'ESRCH' }
}

async function readOwner(lockPath: string): Promise<string | null> {
  try { return await fsp.readFile(lockPath, 'utf8') }
  catch (error) { if (errorCode(error) === 'ENOENT') return null; throw error }
}

async function removeStale(lockPath: string, staleMs: number): Promise<void> {
  try {
    const before = await fsp.stat(lockPath)
    if (Date.now() - before.mtimeMs <= staleMs) return
    const owner = await readOwner(lockPath)
    if (owner === null || ownerAlive(owner)) return
    // 回收者也互斥；回收进程若中途退出，其锁仍由同一规则回收。
    // 只在已确认残留时拿此锁，不把普通持锁工作串进另一个等待队列。
    await withFileLock(`${lockPath}.reaper`, async () => {
      const current = await fsp.stat(lockPath)
      if (current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || await readOwner(lockPath) !== owner) return
      const stalePath = `${lockPath}.stale-${randomUUID()}`
      await fsp.rename(lockPath, stalePath)
      await fsp.rm(stalePath)
      logger.warn('已回收退出进程留下的文件锁', { event: 'fs.file_lock.reclaimed', context: { lockPath } })
    }, { staleMs })
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  await fsp.mkdir(path.dirname(lockPath), { recursive: true })
  const deadline = Date.now() + timeoutMs
  const owner = `${process.pid} ${randomUUID()}\n`
  let lock: fsp.FileHandle | undefined
  while (!lock) {
    try {
      const candidate = await fsp.open(lockPath, 'wx', 0o600)
      try {
        await candidate.writeFile(owner, 'utf8')
        lock = candidate
      } catch (error) {
        await candidate.close().catch(() => undefined)
        await fsp.rm(lockPath, { force: true }).catch(() => undefined)
        throw error
      }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      await removeStale(lockPath, staleMs)
      if (Date.now() >= deadline) throw new Error(options.timeoutMessage ?? `Timed out acquiring file lock: ${lockPath}`)
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  let heartbeat: Promise<void> = Promise.resolve()
  const handle = lock
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(async () => {
      const now = new Date()
      await handle.utimes(now, now)
    }).catch((error: unknown) => {
      logger.warn('文件锁心跳更新失败', { event: 'fs.file_lock.heartbeat_failed', context: { lockPath }, error })
    })
  }, Math.max(1, Math.floor(staleMs / 3)))
  timer.unref()
  try {
    return await operation()
  } finally {
    clearInterval(timer)
    await heartbeat
    await lock.close()
    if (await readOwner(lockPath) === owner) await fsp.rm(lockPath, { force: true })
    else logger.warn('文件锁持有者已变化，保留当前锁', { event: 'fs.file_lock.owner_changed', context: { lockPath } })
  }
}
