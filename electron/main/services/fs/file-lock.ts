import fsp from 'node:fs/promises'
import path from 'node:path'

/*
 * 跨进程文件锁：同一份数据可能同时被正式窗口与无窗口助手进程写入，进程内的串行执行器挡不住，
 * 用独占创建的锁文件互斥。锁文件超过 staleMs 未释放视为崩溃残留，可以接管。
 * 图片编辑器文档仓库与通用文档仓库共用这一份实现。
 */

export interface FileLockOptions {
  /** 等待锁的最长时间。 */
  timeoutMs?: number
  /** 锁文件修改时间早于这么久视为残留，直接接管。 */
  staleMs?: number
  /** 超时错误信息。 */
  timeoutMessage?: string
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_STALE_MS = 30_000
const RETRY_DELAY_MS = 10

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined
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
  let lock: fsp.FileHandle | undefined
  while (!lock) {
    try {
      const candidate = await fsp.open(lockPath, 'wx', 0o600)
      try {
        await candidate.writeFile(`${process.pid} ${Date.now()}\n`, 'utf8')
        lock = candidate
      } catch (error) {
        await candidate.close().catch(() => undefined)
        await fsp.rm(lockPath, { force: true }).catch(() => undefined)
        throw error
      }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const stats = await fsp.stat(lockPath).catch(() => undefined)
      if (stats && Date.now() - stats.mtimeMs > staleMs) {
        await fsp.rm(lockPath, { force: true }).catch(() => undefined)
        continue
      }
      if (Date.now() >= deadline) throw new Error(options.timeoutMessage ?? `Timed out acquiring file lock: ${lockPath}`)
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  try {
    return await operation()
  } finally {
    await lock.close().catch(() => undefined)
    await fsp.rm(lockPath, { force: true }).catch(() => undefined)
  }
}
