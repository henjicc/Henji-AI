import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'

const logger = createMainLogger('main.image_editor_v3.atomic_file')

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

function isReplaceCompatibilityError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  return error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'ENOTEMPTY'
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
      event: 'image_editor_v3.atomic_file.durability_uncertain',
      context: { targetPath },
      error,
    })
  }
}

/**
 * POSIX 下 rename 会直接原子替换；Windows 不允许覆盖时才退到带备份的兼容路径。
 * 兼容路径若第二次 rename 失败，会尽力恢复旧目标，绝不把半成品当成成功结果。
 */
export async function replaceFileAtomically(
  stagedPath: string,
  targetPath: string,
  operations: AtomicFileOperations = DEFAULT_OPERATIONS,
): Promise<void> {
  try {
    await operations.rename(stagedPath, targetPath)
    await syncPublishedDirectory(targetPath, operations)
    return
  } catch (error) {
    if (!isReplaceCompatibilityError(error)) throw error
  }

  const targetExists = await operations.access(targetPath).then(() => true).catch(() => false)
  if (!targetExists) {
    await operations.rename(stagedPath, targetPath)
    await syncPublishedDirectory(targetPath, operations)
    return
  }

  const backupPath = `${targetPath}.${crypto.randomUUID()}.bak`
  await operations.rename(targetPath, backupPath)
  try {
    await operations.rename(stagedPath, targetPath)
  } catch (error) {
    await operations.rename(backupPath, targetPath).catch(() => undefined)
    throw error
  }
  // 新目标已经发布后，旧备份清理失败不能再被当成发布失败，更不能尝试用旧文件
  // 覆盖已发布目标。残留 backup 可由后续维护清理，目标文件仍是唯一权威结果。
  await operations.remove(backupPath).catch(() => undefined)
  await syncPublishedDirectory(targetPath, operations)
}

export async function writeBufferAtomically(
  targetPath: string,
  content: Uint8Array,
  operations: AtomicFileOperations = DEFAULT_OPERATIONS,
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`,
  )
  try {
    const handle = await fs.open(stagedPath, 'wx', 0o600)
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceFileAtomically(stagedPath, targetPath, operations)
  } catch (error) {
    await fs.rm(stagedPath, { force: true }).catch(() => undefined)
    throw error
  }
}
