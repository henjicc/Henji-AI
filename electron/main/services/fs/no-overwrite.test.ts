import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

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
const logWarn = vi.hoisted(() => vi.fn())

vi.mock('../logging/main-logger', () => ({
  createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: logWarn, error: vi.fn() }),
}))

beforeEach(() => { logWarn.mockClear(); root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-no-overwrite-')) })
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })

describe('不覆盖的文件操作', () => {
  it('非硬链接独占创建的占位句柄关闭失败也清理占位，可再次创建', async () => {
    const target = path.join(root, 'a.json')
    vi.spyOn(fsp, 'link').mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }))
    const open = fsp.open.bind(fsp)
    vi.spyOn(fsp, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode)
      if (file === target) {
        const close = handle.close.bind(handle)
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw new Error('close failed') })
      }
      return handle
    })
    await expect(createFileExclusively(target, Buffer.from('new'))).rejects.toThrow('close failed')
    expect(fs.readdirSync(root)).toEqual([])
    vi.restoreAllMocks()
    await createFileExclusively(target, Buffer.from('retry'))
    expect(fs.readFileSync(target, 'utf8')).toBe('retry')
  })
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
  it('PID 仍存活但心跳停止远超 staleMs 时回收残留，不因 PID 复用永久锁死', async () => {
    const lock = path.join(root, 'reused-pid.lock')
    await fsp.writeFile(lock, `${process.pid} previous-owner\n`)
    const old = new Date(Date.now() - 4_000)
    await fsp.utimes(lock, old, old)
    await expect(withFileLock(lock, async () => 'recovered', { staleMs: 1_000, timeoutMs: 100 })).resolves.toBe('recovered')
    expect(fs.existsSync(lock)).toBe(false)
  })

  it('存活 PID 的心跳只超过 staleMs、尚在宽限期内时不接管', async () => {
    const lock = path.join(root, 'delayed-heartbeat.lock')
    const owner = `${process.pid} delayed-owner\n`
    await fsp.writeFile(lock, owner)
    const old = new Date(Date.now() - 1_500)
    await fsp.utimes(lock, old, old)
    await expect(withFileLock(lock, async () => 'never', { staleMs: 1_000, timeoutMs: 50 })).rejects.toThrow('Timed out')
    expect(await fsp.readFile(lock, 'utf8')).toBe(owner)
  })

  it.each([false, true])('关闭句柄失败仍释放锁并保留操作结果（操作失败：%s）', async fails => {
    const lock = path.join(root, 'close-error.lock')
    const closeError = new Error('close failed')
    const operationError = new Error('operation failed')
    const open = fsp.open.bind(fsp)
    vi.spyOn(fsp, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args)
      const close = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close()
        throw closeError
      })
      return handle
    })
    const result = withFileLock(lock, async () => {
      if (fails) throw operationError
      return 'operation result'
    })
    if (fails) await expect(result).rejects.toBe(operationError)
    else await expect(result).resolves.toBe('operation result')
    expect(fs.existsSync(lock)).toBe(false)
    expect(logWarn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'fs.file_lock.close_failed', error: closeError }))
  })

  it('多个等待者同时回收同一残留锁时，只有一个进入操作', async () => {
    const lock = path.join(root, 'stale.lock')
    await fsp.writeFile(lock, 'abandoned')
    const old = new Date(Date.now() - 60_000)
    await fsp.utimes(lock, old, old)
    let active = 0
    let peak = 0
    await Promise.all(Array.from({ length: 8 }, () => withFileLock(lock, async () => {
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active--
    }, { staleMs: 60 })))
    expect(peak).toBe(1)
    expect(await fsp.readdir(root)).toEqual([])
  })
  it('持锁超过 staleMs 时多个等待者仍串行，心跳持续更新', async () => {
    const lock = path.join(root, 'long.lock')
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let active = 0
    let peak = 0
    const operation = async () => {
      peak = Math.max(peak, ++active)
      entered()
      await new Promise(resolve => setTimeout(resolve, 240))
      active--
    }
    const first = withFileLock(lock, operation, { staleMs: 60 })
    await started
    await new Promise(resolve => setTimeout(resolve, 100))
    const age = Date.now() - (await fsp.stat(lock)).mtimeMs
    await Promise.all([first, ...Array.from({ length: 3 }, () => withFileLock(lock, operation, { staleMs: 60 }))])
    expect(peak).toBe(1)
    expect(age).toBeLessThan(60)
  })

  it('释放时不删除替换后的其他持有者锁', async () => {
    const lock = path.join(root, 'ownership.lock')
    await withFileLock(lock, async () => {
      await fsp.rm(lock)
      await fsp.writeFile(lock, 'replacement-owner')
    })
    expect(await fsp.readFile(lock, 'utf8')).toBe('replacement-owner')
  })

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
