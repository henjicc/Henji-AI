import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inspectWorkRootTarget, moveWorkRoot, WorkRootMoveError } from './moveWorkRoot'

/*
 * 作品目录整体移动（任务 4.2）。全部在临时目录里进行，不碰真实用户目录。
 * 跨磁盘用 forceCopy 模拟；失败用注入的 copyFile / rename 模拟。
 */

let base: string
let oldRoot: string

async function writeFile(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const key = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        result[`${key}/`] = ''
        await walk(full)
      } else {
        result[key] = await fs.readFile(full, 'utf8')
      }
    }
  }
  await walk(root)
  return result
}

async function exists(target: string): Promise<boolean> {
  return await fs.access(target).then(() => true, () => false)
}

function codeOf(error: unknown): string | undefined {
  return error instanceof WorkRootMoveError ? error.code : undefined
}

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-work-root-'))
  oldRoot = path.join(base, '痕迹AI')
  await writeFile(oldRoot, '项目/短片 A/短片 A.henji-video', '{"format":"henji-document"}')
  await writeFile(oldRoot, '项目/短片 A/生成结果/a.png', 'png-bytes')
  await writeFile(oldRoot, '生成结果/b.mp4', 'video-bytes-video-bytes')
  await writeFile(oldRoot, '助手技能/示例/SKILL.md', '# 技能')
  await fs.mkdir(path.join(oldRoot, '导出'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('inspectWorkRootTarget', () => {
  it('区分当前、嵌套、非空、文件与可用', async () => {
    await writeFile(base, '有东西/x.txt', 'x')
    await writeFile(base, '是文件', 'x')
    await fs.mkdir(path.join(base, '空的'))
    expect(await inspectWorkRootTarget(oldRoot, oldRoot)).toBe('current')
    expect(await inspectWorkRootTarget(oldRoot, path.join(oldRoot, '项目', '里面'))).toBe('nested')
    expect(await inspectWorkRootTarget(oldRoot, base)).toBe('nested')
    expect(await inspectWorkRootTarget(oldRoot, path.join(base, '有东西'))).toBe('notEmpty')
    expect(await inspectWorkRootTarget(oldRoot, path.join(base, '是文件'))).toBe('notDirectory')
    expect(await inspectWorkRootTarget(oldRoot, path.join(base, '空的'))).toBe('ok')
    expect(await inspectWorkRootTarget(oldRoot, path.join(base, '不存在', '痕迹AI'))).toBe('ok')
  })
})

describe('moveWorkRoot', () => {
  it('同一磁盘整体改名，内容不变，旧目录消失，commit 被调用一次', async () => {
    const before = await snapshot(oldRoot)
    const newRoot = path.join(base, '新位置', '深一层', '痕迹AI')
    const commit = vi.fn()
    const result = await moveWorkRoot({ oldRoot, newRoot, commit })
    expect(result.mode).toBe('rename')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(await snapshot(newRoot)).toEqual(before)
    expect(await exists(oldRoot)).toBe(false)
  })

  it('目标是已存在的空文件夹时也能改名过去', async () => {
    const before = await snapshot(oldRoot)
    const newRoot = path.join(base, '空文件夹')
    await fs.mkdir(newRoot)
    await moveWorkRoot({ oldRoot, newRoot, commit: () => undefined })
    expect(await snapshot(newRoot)).toEqual(before)
  })

  it('跨磁盘复制：内容一致（含空文件夹），核对后删除旧目录，报告进度', async () => {
    const before = await snapshot(oldRoot)
    const newRoot = path.join(base, 'E盘', '痕迹AI')
    const phases = new Set<string>()
    const commit = vi.fn()
    const result = await moveWorkRoot({ oldRoot, newRoot, commit, forceCopy: true, onProgress: (progress) => phases.add(progress.phase) })
    expect(result).toMatchObject({ mode: 'copy', files: 4, oldRootRemoved: true })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(await snapshot(newRoot)).toEqual(before)
    expect(await exists(oldRoot)).toBe(false)
    expect([...phases]).toEqual(expect.arrayContaining(['preparing', 'copying', 'verifying', 'cleaning']))
  })

  it('改名报 EXDEV 时退回复制', async () => {
    const before = await snapshot(oldRoot)
    const newRoot = path.join(base, '另一个盘', '痕迹AI')
    const exdev = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
    const result = await moveWorkRoot({ oldRoot, newRoot, commit: () => undefined, fileOps: { rename: async () => { throw exdev } } })
    expect(result.mode).toBe('copy')
    expect(await snapshot(newRoot)).toEqual(before)
    expect(await exists(oldRoot)).toBe(false)
  })

  it('复制中途失败：删除已复制的部分，原目录完整，设置不切换', async () => {
    const before = await snapshot(oldRoot)
    const newRoot = path.join(base, '新盘', '痕迹AI')
    const commit = vi.fn()
    let copied = 0
    const error = await moveWorkRoot({
      oldRoot, newRoot, commit, forceCopy: true,
      fileOps: {
        copyFile: async (source, target) => {
          copied += 1
          if (copied === 3) throw new Error('磁盘写入失败')
          await fs.copyFile(source, target)
        },
      },
    }).catch((caught: unknown) => caught)
    expect(codeOf(error)).toBe('move_failed')
    expect(commit).not.toHaveBeenCalled()
    expect(await snapshot(oldRoot)).toEqual(before)
    expect(await exists(newRoot)).toBe(false)
    expect(await exists(path.join(base, '新盘'))).toBe(false)
  })

  it('取消：复制中途中止并清理，原目录完整，已存在的空目标文件夹保留为空', async () => {
    const before = await snapshot(oldRoot)
    const newRoot = path.join(base, '空目标')
    await fs.mkdir(newRoot)
    const controller = new AbortController()
    const commit = vi.fn()
    const error = await moveWorkRoot({
      oldRoot, newRoot, commit, forceCopy: true, signal: controller.signal,
      onProgress: (progress) => { if (progress.phase === 'copying' && progress.current === 2) controller.abort() },
    }).catch((caught: unknown) => caught)
    expect(codeOf(error)).toBe('cancelled')
    expect(commit).not.toHaveBeenCalled()
    expect(await snapshot(oldRoot)).toEqual(before)
    expect(await fs.readdir(newRoot)).toEqual([])
  })

  it('目标非空、目标在旧目录里面或包含旧目录时拒绝，什么都不动', async () => {
    const before = await snapshot(oldRoot)
    await writeFile(base, '已有内容/别人的.txt', 'x')
    const commit = vi.fn()
    const notEmpty = await moveWorkRoot({ oldRoot, newRoot: path.join(base, '已有内容'), commit }).catch((caught: unknown) => caught)
    const inside = await moveWorkRoot({ oldRoot, newRoot: path.join(oldRoot, '生成结果', '新'), commit }).catch((caught: unknown) => caught)
    const outside = await moveWorkRoot({ oldRoot, newRoot: base, commit }).catch((caught: unknown) => caught)
    expect(codeOf(notEmpty)).toBe('target_not_empty')
    expect(codeOf(inside)).toBe('nested_root')
    expect(codeOf(outside)).toBe('nested_root')
    expect(commit).not.toHaveBeenCalled()
    expect(await snapshot(oldRoot)).toEqual(before)
    expect(await fs.readFile(path.join(base, '已有内容', '别人的.txt'), 'utf8')).toBe('x')
  })

  it('切换设置失败：改名模式移回原位置，复制模式删除新副本', async () => {
    const before = await snapshot(oldRoot)
    const failingCommit = (): void => { throw new Error('设置写入失败') }
    const renameTarget = path.join(base, '改名目标', '痕迹AI')
    const renamed = await moveWorkRoot({ oldRoot, newRoot: renameTarget, commit: failingCommit }).catch((caught: unknown) => caught)
    expect(codeOf(renamed)).toBe('move_failed')
    expect(await snapshot(oldRoot)).toEqual(before)
    expect(await exists(path.join(base, '改名目标'))).toBe(false)

    const copyTarget = path.join(base, '复制目标', '痕迹AI')
    const copied = await moveWorkRoot({ oldRoot, newRoot: copyTarget, commit: failingCommit, forceCopy: true }).catch((caught: unknown) => caught)
    expect(codeOf(copied)).toBe('move_failed')
    expect(await snapshot(oldRoot)).toEqual(before)
    expect(await exists(path.join(base, '复制目标'))).toBe(false)
  })

  it('文件被占用（改名被拒绝）时报告 in_use，原目录不动', async () => {
    const before = await snapshot(oldRoot)
    const busy = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
    const newRoot = path.join(base, '目标', '痕迹AI')
    const error = await moveWorkRoot({ oldRoot, newRoot, commit: vi.fn(), fileOps: { rename: async () => { throw busy } } }).catch((caught: unknown) => caught)
    expect(codeOf(error)).toBe('in_use')
    expect(await snapshot(oldRoot)).toEqual(before)
    expect(await exists(path.join(base, '目标'))).toBe(false)
  })

  it('空间不足时不开始复制', async () => {
    const newRoot = path.join(base, '小盘', '痕迹AI')
    const error = await moveWorkRoot({ oldRoot, newRoot, commit: vi.fn(), forceCopy: true, availableBytes: async () => 1 }).catch((caught: unknown) => caught)
    expect(codeOf(error)).toBe('insufficient_space')
    expect(await exists(path.join(base, '小盘'))).toBe(false)
  })
})
