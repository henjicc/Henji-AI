import { constants as fsConstants, type Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  WorkRootMoveErrorCode,
  WorkRootMoveProgress,
  WorkRootTargetStatus,
} from '../../../../src/platform/contracts/workRoot'

/*
 * 整体移动作品目录（任务 4.2）。只处理文件系统，不碰数据库与设置：切换设置由调用方在 `commit` 里完成。
 *
 * - 目标必须不存在或是空文件夹，不能在旧目录里面，也不能包含旧目录。
 * - 同一磁盘：整个文件夹一次改名（原子操作，文件被占用时系统直接拒绝，旧目录原样不动）。
 * - 跨磁盘（或改名报 EXDEV）：逐个复制 → 补拷复制期间新出现的文件 → 逐个核对大小 → commit → 删除旧目录。
 * - commit 之前任何失败或取消：改名模式改回原位置；复制模式删除本次复制出的全部内容
 *   （目标原本不存在就整个删掉，原本是空文件夹就清空），旧目录与设置保持原样。
 * - commit 之后不再响应取消；旧目录删不干净只影响磁盘占用，结果里报告。
 */

export class WorkRootMoveError extends Error {
  constructor(readonly code: WorkRootMoveErrorCode, message: string, options?: { cause?: unknown }) {
    // 代码写进 message 前缀：IPC 只传 name 与 message，渲染层据此区分原因。
    super(`${code}:${message}`, options)
    this.name = 'WorkRootMoveError'
  }
}

export interface MoveWorkRootFileOps {
  copyFile(source: string, target: string): Promise<void>
  rename(source: string, target: string): Promise<void>
}

const DEFAULT_FILE_OPS: MoveWorkRootFileOps = {
  copyFile: (source, target) => fs.copyFile(source, target, fsConstants.COPYFILE_EXCL),
  rename: (source, target) => fs.rename(source, target),
}

export interface MoveWorkRootInput {
  oldRoot: string
  newRoot: string
  /** 切换设置等收尾；抛错时移动整体回滚。 */
  commit: () => void | Promise<void>
  signal?: AbortSignal
  onProgress?: (progress: WorkRootMoveProgress) => void
  /** 测试注入：强制按跨磁盘复制处理。 */
  forceCopy?: boolean
  /** 测试注入：替换复制 / 改名以模拟失败。 */
  fileOps?: Partial<MoveWorkRootFileOps>
  /** 测试注入：可用空间（字节）；不传时读取磁盘。 */
  availableBytes?: (directory: string) => Promise<number | null>
}

export interface MoveWorkRootResult {
  mode: 'rename' | 'copy'
  files: number
  bytes: number
  oldRootRemoved: boolean
}

interface TreeEntry {
  relative: string
  kind: 'directory' | 'file' | 'symlink'
  size: number
}

function sameOrInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 判断目标能否作为新的作品目录（只读检查，不建任何东西）。 */
export async function inspectWorkRootTarget(oldRoot: string, newRoot: string): Promise<WorkRootTargetStatus> {
  const from = path.resolve(oldRoot)
  const to = path.resolve(newRoot)
  if (path.relative(from, to) === '') return 'current'
  if (sameOrInside(from, to) || sameOrInside(to, from)) return 'nested'
  const stat = await lstatOrNull(to)
  if (!stat) return 'ok'
  if (!stat.isDirectory()) return 'notDirectory'
  return (await fs.readdir(to)).length === 0 ? 'ok' : 'notEmpty'
}

function assertTargetStatus(status: WorkRootTargetStatus): void {
  if (status === 'ok') return
  if (status === 'current') throw new WorkRootMoveError('same_root', '新位置与当前作品目录相同')
  if (status === 'nested') throw new WorkRootMoveError('nested_root', '新位置不能在当前作品目录里面，也不能包含当前作品目录')
  if (status === 'notDirectory') throw new WorkRootMoveError('target_not_directory', '新位置是一个文件，不是文件夹')
  throw new WorkRootMoveError('target_not_empty', '新位置必须是空文件夹或尚不存在的文件夹')
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new WorkRootMoveError('cancelled', '已取消更换作品目录')
}

/** 逐级创建缺失的父文件夹，返回新建的文件夹（由浅到深），回滚时倒序删除。 */
async function ensureDirectory(directory: string): Promise<string[]> {
  const missing: string[] = []
  let current = path.resolve(directory)
  while (!(await lstatOrNull(current))) {
    missing.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  const created: string[] = []
  for (const item of missing.reverse()) {
    await fs.mkdir(item)
    created.push(item)
  }
  return created
}

async function removeEmptyDirectories(directories: readonly string[]): Promise<void> {
  for (const directory of [...directories].reverse()) {
    try {
      await fs.rmdir(directory)
    } catch {
      // 非空或已不存在：保留。
    }
  }
}

async function nearestExisting(target: string): Promise<string> {
  let current = path.resolve(target)
  while (!(await lstatOrNull(current))) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
}

async function isSameVolume(a: string, b: string): Promise<boolean> {
  const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(await nearestExisting(b))])
  return statA.dev === statB.dev
}

async function readAvailableBytes(directory: string): Promise<number | null> {
  try {
    const stat = await fs.statfs(await nearestExisting(directory))
    return Number(stat.bavail) * Number(stat.bsize)
  } catch {
    return null
  }
}

/** 列出整棵目录树（文件夹在其内容之前）；读不全就失败，避免漏拷后删除旧目录丢文件。 */
async function listTree(root: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  const walk = async (directory: string, relativeDir: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name
      const full = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        entries.push({ relative, kind: 'symlink', size: 0 })
      } else if (entry.isDirectory()) {
        entries.push({ relative, kind: 'directory', size: 0 })
        await walk(full, relative)
      } else {
        entries.push({ relative, kind: 'file', size: (await fs.stat(full)).size })
      }
    }
  }
  await walk(root, '')
  return entries
}

function isInUseError(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

async function moveByRename(input: MoveWorkRootInput, ops: MoveWorkRootFileOps): Promise<MoveWorkRootResult | 'cross_device'> {
  const oldRoot = path.resolve(input.oldRoot)
  const newRoot = path.resolve(input.newRoot)
  const targetExisted = (await lstatOrNull(newRoot)) !== null
  const createdParents = await ensureDirectory(path.dirname(newRoot))
  // Windows 不允许改名到已存在的空文件夹上：先删掉这个空文件夹，回滚时再建回来。
  if (targetExisted) await fs.rmdir(newRoot)
  const restoreTarget = async (): Promise<void> => {
    if (targetExisted) await fs.mkdir(newRoot, { recursive: true }).catch(() => undefined)
    await removeEmptyDirectories(createdParents)
  }

  assertNotAborted(input.signal)
  input.onProgress?.({ phase: 'moving', current: 0, total: 1, item: '' })
  try {
    await ops.rename(oldRoot, newRoot)
  } catch (error) {
    await restoreTarget()
    if (errorCode(error) === 'EXDEV') return 'cross_device'
    if (isInUseError(error)) {
      throw new WorkRootMoveError('in_use', `作品目录里有文件正被其他程序使用，请关闭后重试（${describe(error)}）`, { cause: error })
    }
    throw new WorkRootMoveError('move_failed', `移动失败：${describe(error)}`, { cause: error })
  }

  try {
    await input.commit()
  } catch (error) {
    try {
      await ops.rename(newRoot, oldRoot)
    } catch (rollbackError) {
      throw new WorkRootMoveError('move_failed', `保存新位置失败，且作品未能移回原位置，请到 ${newRoot} 查找：${describe(rollbackError)}`, { cause: error })
    }
    await restoreTarget()
    throw new WorkRootMoveError('move_failed', `保存新位置失败，作品已移回原位置：${describe(error)}`, { cause: error })
  }
  input.onProgress?.({ phase: 'moving', current: 1, total: 1, item: '' })
  return { mode: 'rename', files: 0, bytes: 0, oldRootRemoved: true }
}

async function moveByCopy(input: MoveWorkRootInput, ops: MoveWorkRootFileOps): Promise<MoveWorkRootResult> {
  const oldRoot = path.resolve(input.oldRoot)
  const newRoot = path.resolve(input.newRoot)
  const report = input.onProgress

  report?.({ phase: 'preparing', current: 0, total: 0, item: '' })
  const plan = await listTree(oldRoot)
  const totalBytes = plan.reduce((sum, entry) => sum + entry.size, 0)
  const available = await (input.availableBytes ?? readAvailableBytes)(newRoot)
  if (available !== null && available < totalBytes) {
    throw new WorkRootMoveError('insufficient_space', `新位置所在磁盘空间不足（需要约 ${Math.ceil(totalBytes / 1024 / 1024)} MB）`)
  }

  const targetExisted = (await lstatOrNull(newRoot)) !== null
  const createdParents = await ensureDirectory(path.dirname(newRoot))
  const copied = new Map<string, number>()
  let bytes = 0

  const cleanup = async (): Promise<void> => {
    try {
      if (targetExisted) {
        for (const name of await fs.readdir(newRoot)) await fs.rm(path.join(newRoot, name), { recursive: true, force: true })
      } else {
        await fs.rm(newRoot, { recursive: true, force: true })
      }
    } finally {
      await removeEmptyDirectories(createdParents)
    }
  }

  const copyEntry = async (entry: TreeEntry): Promise<void> => {
    const source = path.join(oldRoot, entry.relative)
    const target = path.join(newRoot, entry.relative)
    if (entry.kind === 'directory') {
      await fs.mkdir(target, { recursive: true })
    } else if (entry.kind === 'symlink') {
      await fs.symlink(await fs.readlink(source), target)
    } else {
      await ops.copyFile(source, target)
      copied.set(entry.relative, entry.size)
      bytes += entry.size
    }
  }

  try {
    await fs.mkdir(newRoot, { recursive: true })
    const files = plan.filter((entry) => entry.kind === 'file').length
    let done = 0
    for (const entry of plan) {
      assertNotAborted(input.signal)
      await copyEntry(entry)
      if (entry.kind === 'file') {
        done += 1
        report?.({ phase: 'copying', current: done, total: files, item: entry.relative })
      }
    }
    // 补拷：复制期间可能又有文件写进旧位置（写入已冻结，正常不会发生）。
    const seen = new Set(plan.map((entry) => entry.relative))
    for (const entry of await listTree(oldRoot)) {
      if (seen.has(entry.relative)) continue
      assertNotAborted(input.signal)
      await copyEntry(entry)
    }
    let verified = 0
    for (const [relative, size] of copied) {
      assertNotAborted(input.signal)
      verified += 1
      if (verified % 50 === 0 || verified === copied.size) report?.({ phase: 'verifying', current: verified, total: copied.size, item: relative })
      const [source, target] = await Promise.all([fs.stat(path.join(oldRoot, relative)), fs.stat(path.join(newRoot, relative))])
      if (source.size !== size || target.size !== size) {
        throw new WorkRootMoveError('move_failed', `复制后大小不一致：${relative}`)
      }
    }
    assertNotAborted(input.signal)
    await input.commit()
  } catch (error) {
    await cleanup().catch(() => undefined)
    if (error instanceof WorkRootMoveError) throw error
    if (isInUseError(error)) {
      throw new WorkRootMoveError('in_use', `有文件无法读取或写入，可能正被其他程序使用（${describe(error)}）`, { cause: error })
    }
    throw new WorkRootMoveError('move_failed', `复制失败：${describe(error)}`, { cause: error })
  }

  report?.({ phase: 'cleaning', current: 0, total: 0, item: '' })
  let oldRootRemoved = true
  try {
    await fs.rm(oldRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    oldRootRemoved = false
  }
  return { mode: 'copy', files: copied.size, bytes, oldRootRemoved }
}

export async function moveWorkRoot(input: MoveWorkRootInput): Promise<MoveWorkRootResult> {
  const oldRoot = path.resolve(input.oldRoot)
  const newRoot = path.resolve(input.newRoot)
  const ops: MoveWorkRootFileOps = { ...DEFAULT_FILE_OPS, ...input.fileOps }
  assertTargetStatus(await inspectWorkRootTarget(oldRoot, newRoot))
  assertNotAborted(input.signal)

  const oldStat = await lstatOrNull(oldRoot)
  if (!oldStat) {
    // 旧目录已不存在（被用户删掉）：没有东西可移动，只切换位置。
    await fs.mkdir(newRoot, { recursive: true })
    await input.commit()
    return { mode: 'rename', files: 0, bytes: 0, oldRootRemoved: true }
  }
  if (!oldStat.isDirectory()) throw new WorkRootMoveError('move_failed', '当前作品目录不是文件夹')

  if (!input.forceCopy && await isSameVolume(oldRoot, newRoot)) {
    const renamed = await moveByRename({ ...input, oldRoot, newRoot }, ops)
    if (renamed !== 'cross_device') return renamed
  }
  return await moveByCopy({ ...input, oldRoot, newRoot }, ops)
}
