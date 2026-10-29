import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'

/*
 * 原子文件写入：所有需要“写完整再发布、失败不留半成品”的落盘共用这一份实现
 * （文档仓库、图片编辑器、系统写文件、窗口外观缓存等）。
 */
const logger = createMainLogger('main.fs.atomic_file')

export interface AtomicFileOperations {
  rename(source: string, target: string): Promise<void>
  remove(target: string): Promise<void>
  access(target: string): Promise<void>
  syncDirectory?(directory: string): Promise<void>
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(directory, 'r')
    await handle.sync()
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EINVAL', 'ENOTSUP', 'EPERM'].includes(String(error.code))) {
      throw error
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const DEFAULT_OPERATIONS: AtomicFileOperations = {
  rename: (source, target) => fs.rename(source, target),
  remove: (target) => fs.rm(target, { force: true }),
  access: (target) => fs.access(target),
  syncDirectory,
}

async function syncPublishedDirectory(
  targetPath: string,
  operations: AtomicFileOperations,
): Promise<void> {
  try {
    await operations.syncDirectory?.(path.dirname(targetPath))
  } catch (error) {
    // rename 已经提交，目录 fsync 失败只代表断电耐久性无法确认；此时回滚或报告
    // “保存失败”都会与磁盘上的新目标相矛盾。保留新目标并记录明确的降级证据。
    logger.warn('文件已原子发布，但目录耐久化无法确认', {
      event: 'fs.atomic_file.durability_uncertain',
      context: { targetPath },
      error,
    })
  }
}

/**
 * 同目录 rename 使用系统替换原语（Windows 的 libuv 使用 MoveFileExW /
 * MOVEFILE_REPLACE_EXISTING）。占用、权限或文件系统不支持替换时直接失败，
 * 绝不先搬走旧目标：那会产生崩溃或恢复失败后原路径消失的窗口。
 */
export async function replaceFileAtomically(
  stagedPath: string,
  targetPath: string,
  operations: AtomicFileOperations = DEFAULT_OPERATIONS,
): Promise<void> {
  await renameWithRetry(stagedPath, targetPath, (from, to) => operations.rename(from, to))
  await syncPublishedDirectory(targetPath, operations)
}

export async function renameWithRetry(
  source: string,
  target: string,
  rename: AtomicFileOperations['rename'] = (from, to) => fs.rename(from, to),
): Promise<void> {
  // Windows 上杀毒/索引器短暂占用目标会让替换报 EPERM/EBUSY；短退避重试，原件始终留在原路径。
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, target); return } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw error
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt))
    }
  }
}

export async function writeBufferAtomically(
  targetPath: string,
  content: Uint8Array | AsyncIterable<string | Uint8Array>,
  operations: AtomicFileOperations = DEFAULT_OPERATIONS,
  options: { exclusive?: boolean; signal?: AbortSignal; validate?: (stagedPath: string) => Promise<void> } = {},
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`,
  )
  try {
    options.signal?.throwIfAborted()
    const handle = await fs.open(stagedPath, 'wx', 0o600)
    try {
      if (ArrayBuffer.isView(content)) await handle.writeFile(content, { signal: options.signal })
      else for await (const chunk of content) {
        options.signal?.throwIfAborted()
        await handle.writeFile(chunk, { signal: options.signal })
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    await options.validate?.(stagedPath)
    options.signal?.throwIfAborted()
    if (options.exclusive) {
      // A same-directory hard link publishes the complete closed file without
      // overwriting a racing target. Failed writes only ever touch our staging.
      try { await fs.link(stagedPath, targetPath) } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : ''
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EINVAL', 'EISDIR'].includes(code)) throw error
        // exFAT/FAT32 和部分网络卷不支持硬链接；wx 仍保证竞速目标不被覆盖。
        const reservation = await fs.open(targetPath, 'wx', 0o600)
        try {
          await reservation.close()
          options.signal?.throwIfAborted()
          await replaceFileAtomically(stagedPath, targetPath, operations)
        } catch (publishError) {
          await reservation.close().catch(() => undefined)
          await operations.remove(targetPath).catch(cleanupError => logger.warn('排他发布失败，占位清理失败', { event: 'fs.atomic_file.reservation_cleanup_failed', error: cleanupError, context: { targetPath } }))
          throw publishError
        }
        return
      }
      await operations.remove(stagedPath).catch(error => logger.warn('文件已发布，暂存文件清理失败', { event: 'fs.atomic_file.staging_cleanup_failed', error, context: { targetPath } }))
      await syncPublishedDirectory(targetPath, operations)
    } else await replaceFileAtomically(stagedPath, targetPath, operations)
  } catch (error) {
    await fs.rm(stagedPath, { force: true }).catch(() => undefined)
    throw error
  }
}
