import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withFileLock } from './file-lock'
import {
  copyFileNoOverwrite,
  createDirectoryExclusively,
  createFileExclusively,
  EntryExistsError,
  moveDirectoryNoOverwrite,
  moveFileNoOverwrite,
} from './no-overwrite'

let root: string

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-no-overwrite-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('不覆盖的文件操作', () => {
  it('独占创建：目标已存在时报 EntryExistsError 且原内容不变；成功时不留暂存文件', async () => {
    const target = path.join(root, '子目录', 'a.json')
    await createFileExclusively(target, Buffer.from('first'))
    await expect(createFileExclusively(target, Buffer.from('second'))).rejects.toBeInstanceOf(EntryExistsError)
    expect(fs.readFileSync(target, 'utf8')).toBe('first')
    expect(fs.readdirSync(path.dirname(target))).toEqual(['a.json'])
  })

  it('复制与移动文件都不覆盖已有目标；只改大小写时原地改名', async () => {
    const source = path.join(root, 'a.txt')
    const other = path.join(root, 'b.txt')
    fs.writeFileSync(source, 'source')
    fs.writeFileSync(other, 'other')
    await expect(copyFileNoOverwrite(source, other)).rejects.toBeInstanceOf(EntryExistsError)
    await expect(moveFileNoOverwrite(source, other)).rejects.toBeInstanceOf(EntryExistsError)
    expect(fs.readFileSync(other, 'utf8')).toBe('other')
    await copyFileNoOverwrite(source, path.join(root, 'copy', 'a.txt'))
    expect(fs.readFileSync(path.join(root, 'copy', 'a.txt'), 'utf8')).toBe('source')
    await moveFileNoOverwrite(source, path.join(root, 'moved', 'a.txt'))
    expect(fs.existsSync(source)).toBe(false)
    const upper = path.join(root, 'moved', 'A.txt')
    await moveFileNoOverwrite(path.join(root, 'moved', 'a.txt'), upper)
    expect(fs.readdirSync(path.join(root, 'moved'))).toEqual(['A.txt'])
  })

  it('文件夹：独占创建与不覆盖移动；目标已存在（含空文件夹）时报错且两边不变', async () => {
    const first = path.join(root, '项目', '甲')
    await createDirectoryExclusively(first)
    await expect(createDirectoryExclusively(first)).rejects.toBeInstanceOf(EntryExistsError)
    fs.writeFileSync(path.join(first, 'doc.txt'), 'x')
    const occupied = path.join(root, '项目', '乙')
    fs.mkdirSync(occupied)
    await expect(moveDirectoryNoOverwrite(first, occupied)).rejects.toBeInstanceOf(EntryExistsError)
    expect(fs.readdirSync(first)).toEqual(['doc.txt'])
    expect(fs.readdirSync(occupied)).toEqual([])
    const target = path.join(root, '别处', '甲')
    await moveDirectoryNoOverwrite(first, target)
    expect(fs.existsSync(first)).toBe(false)
    expect(fs.readFileSync(path.join(target, 'doc.txt'), 'utf8')).toBe('x')
  })
})

describe('跨进程文件锁', () => {
  it('同一把锁串行执行，结束后释放；操作抛错也释放', async () => {
    const lock = path.join(root, 'locks', 'doc.lock')
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const first = withFileLock(lock, async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      order.push('first:end')
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = withFileLock(lock, async () => { order.push('second') })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
    await expect(withFileLock(lock, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(fs.existsSync(lock)).toBe(false)
  })

  it('等不到锁时按给定信息超时；超过残留时长的锁文件被接管', async () => {
    const lock = path.join(root, 'locks', 'held.lock')
    fs.mkdirSync(path.dirname(lock), { recursive: true })
    fs.writeFileSync(lock, 'held')
    await expect(withFileLock(lock, async () => 'never', { timeoutMs: 50, timeoutMessage: '正在被写入' })).rejects.toThrow('正在被写入')
    const old = new Date(Date.now() - 60_000)
    await fsp.utimes(lock, old, old)
    await expect(withFileLock(lock, async () => 'taken', { staleMs: 30_000 })).resolves.toBe('taken')
  })
})
