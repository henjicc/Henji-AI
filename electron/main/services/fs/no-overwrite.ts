import { constants as fsConstants } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { pathKey, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import { writeBufferAtomically } from './atomic-file'

/*
 * 不覆盖的文件系统操作（实施方案 2.8 同名检测：真正创建 / 改名 / 移动时原子复查）。
 *
 * 查重接口只给出提示，检查后到真正写入之间可能被别处抢先建了同名；这里的每个操作都以
 * “目标已存在就失败”的方式完成，失败时抛 EntryExistsError，不会覆盖已有文件或文件夹。
 * 只在 Windows 上大小写不同的同一位置（改名只改大小写）按原地改名处理。
 */

export class EntryExistsError extends Error {
  constructor(readonly path: string) {
    super(`同一位置已有同名的文件或文件夹：${path}`)
    this.name = 'EntryExistsError'
  }
}

const HOST_STYLE: PathStyle = process.platform === 'win32' ? 'win32' : 'posix'

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined
}

async function exists(target: string): Promise<boolean> {
  return await fsp.lstat(target).then(() => true, () => false)
}

/** 两个路径在当前平台是否指向同一位置（Windows 不分大小写）。 */
export function isSameLocation(left: string, right: string, style: PathStyle = HOST_STYLE): boolean {
  const leftKey = pathKey(style, left)
  return leftKey !== null && leftKey === pathKey(style, right)
}

/**
 * 以不覆盖的方式创建文件：先独占创建占位（已存在则失败），再原子替换成完整内容；
 * 写入失败时删除占位。不依赖硬链接，外部盘（exFAT、网络位置）同样可用。
 */
export async function createFileExclusively(target: string, content: Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  let handle: fsp.FileHandle
  try {
    handle = await fsp.open(target, 'wx')
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw new EntryExistsError(target)
    throw error
  }
  await handle.close()
  try {
    await writeBufferAtomically(target, content)
  } catch (error) {
    await fsp.rm(target, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 不覆盖地复制文件（目标已存在则失败）；复制不完整时删除残留。 */
export async function copyFileNoOverwrite(source: string, target: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  try {
    await fsp.copyFile(source, target, fsConstants.COPYFILE_EXCL)
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw new EntryExistsError(target)
    await fsp.rm(target, { force: true }).catch(() => undefined)
    throw error
  }
  const [from, to] = await Promise.all([fsp.stat(source), fsp.stat(target)])
  if (from.size !== to.size) {
    await fsp.rm(target, { force: true }).catch(() => undefined)
    throw new Error('复制的文件不完整，请重试。')
  }
}

/**
 * 不覆盖地移动文件：同一磁盘用硬链接 + 删除原文件（原子占位）；不支持硬链接的文件系统先确认目标不存在再改名；
 * 跨磁盘时复制后删除原文件。只改大小写时原地改名。
 */
export async function moveFileNoOverwrite(source: string, target: string): Promise<void> {
  if (isSameLocation(source, target)) {
    await fsp.rename(source, target)
    return
  }
  await fsp.mkdir(path.dirname(target), { recursive: true })
  try {
    await fsp.link(source, target)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'EEXIST') throw new EntryExistsError(target)
    if (code === 'EXDEV') {
      await copyFileNoOverwrite(source, target)
      await fsp.rm(source, { force: true })
      return
    }
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw error
    if (await exists(target)) throw new EntryExistsError(target)
    await fsp.rename(source, target)
    return
  }
  try {
    await fsp.unlink(source)
  } catch (error) {
    await fsp.unlink(target).catch(() => undefined)
    throw error
  }
}

/** 以不覆盖的方式建文件夹（父文件夹按需创建；文件夹本身已存在则失败）。 */
export async function createDirectoryExclusively(target: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  try {
    await fsp.mkdir(target)
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw new EntryExistsError(target)
    throw error
  }
}

async function copyDirectoryThenRemove(source: string, target: string): Promise<void> {
  try {
    await fsp.cp(source, target, { recursive: true, errorOnExist: true, force: false })
  } catch (error) {
    await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  await fsp.rm(source, { recursive: true, force: true })
}

/**
 * 不覆盖地移动文件夹。Windows 改名遇到已有目标会失败（不会替换）；POSIX 先独占建空目标再改名，
 * 改名只会替换这个刚建的空文件夹。跨磁盘时复制后删除原文件夹。只改大小写时原地改名。
 */
export async function moveDirectoryNoOverwrite(source: string, target: string): Promise<void> {
  if (isSameLocation(source, target)) {
    await fsp.rename(source, target)
    return
  }
  await fsp.mkdir(path.dirname(target), { recursive: true })
  if (process.platform === 'win32') {
    try {
      await fsp.rename(source, target)
      return
    } catch (error) {
      if (await exists(target)) throw new EntryExistsError(target)
      if (errorCode(error) !== 'EXDEV') throw error
    }
    await createDirectoryExclusively(target)
    await copyDirectoryThenRemove(source, target)
    return
  }
  await createDirectoryExclusively(target)
  try {
    await fsp.rename(source, target)
  } catch (error) {
    if (errorCode(error) !== 'EXDEV') {
      await fsp.rmdir(target).catch(() => undefined)
      throw error
    }
    await copyDirectoryThenRemove(source, target)
  }
}
