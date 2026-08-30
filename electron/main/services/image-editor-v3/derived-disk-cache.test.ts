import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DerivedDiskCache, type DerivedCacheAddress } from './derived-disk-cache'

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-cache-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

function address(key: string): DerivedCacheAddress {
  return { kind: 'tile', key }
}

describe('DerivedDiskCache', () => {
  it('用 SHA-256 路径隐藏并约束任意逻辑缓存键', async () => {
    const cache = new DerivedDiskCache(rootDir, 1024)
    const unsafeLooking = address('../../source/path?node=blur')
    await cache.put(unsafeLooking, Buffer.from('derived tile'))

    const filePath = cache.resolveEntryPath(unsafeLooking)
    expect(path.relative(rootDir, filePath).startsWith('..')).toBe(false)
    expect(path.basename(filePath)).toMatch(/^[a-f0-9]{64}\.cache$/)
    expect(filePath).not.toContain('source')
    expect((await cache.get(unsafeLooking))?.toString()).toBe('derived tile')
  })

  it('按全局 LRU 逐出 proxy/pyramid/tile/analysis 中最旧的条目', async () => {
    const cache = new DerivedDiskCache(rootDir, 8)
    const first: DerivedCacheAddress = { kind: 'proxy', key: 'first' }
    const second: DerivedCacheAddress = { kind: 'analysis', key: 'second' }
    const third: DerivedCacheAddress = { kind: 'pyramid', key: 'third' }
    await cache.put(first, Buffer.alloc(4, 1))
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    await cache.put(second, Buffer.alloc(4, 2))
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    await cache.get(first)
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    const result = await cache.put(third, Buffer.alloc(4, 3))

    expect(result).toMatchObject({ totalBytes: 8, evictedBytes: 4, evictedEntries: 1 })
    expect(await cache.has(first)).toBe(true)
    expect(await cache.has(second)).toBe(false)
    expect(await cache.has(third)).toBe(true)
  })

  it('lease 使用期间不逐出，释放后重新纳入配额回收', async () => {
    const cache = new DerivedDiskCache(rootDir, 4)
    const leased = address('leased')
    const incoming = address('incoming')
    await cache.put(leased, Buffer.alloc(4, 1))
    const lease = await cache.acquireLease(leased)
    const overBudget = await cache.put(incoming, Buffer.alloc(4, 2))

    expect(overBudget.totalBytes).toBe(4)
    expect(await cache.has(leased)).toBe(true)
    expect(await cache.has(incoming)).toBe(false)
    await expect(fsp.access(cache.resolveEntryPath(incoming))).rejects.toThrow()
    await lease.release()
    await cache.put(incoming, Buffer.alloc(4, 2))
    expect(await cache.has(leased)).toBe(false)
    expect(await cache.has(incoming)).toBe(true)
  })

  it('写盘前拒绝超过单项 admission 的缓存，避免大对象突破资源账本', async () => {
    const cache = new DerivedDiskCache(rootDir, 16, 8)
    const oversized = address('oversized')

    await expect(cache.put(oversized, Buffer.alloc(9))).rejects.toThrow('admission limit')
    expect(await cache.has(oversized)).toBe(false)
    await expect(fsp.access(cache.resolveEntryPath(oversized))).rejects.toThrow()
  })

  it('路径 lease 允许 libvips 等消费者直接读取文件且在使用期间阻止逐出', async () => {
    const cache = new DerivedDiskCache(rootDir, 8, 8)
    const first = address('path-lease')
    const incoming = address('path-incoming')
    await cache.put(first, Buffer.from('12345678'))
    const lease = await cache.acquireFileLease(first)

    expect(lease).toMatchObject({ byteLength: 8 })
    expect(await fsp.readFile(lease?.filePath ?? '', 'utf8')).toBe('12345678')
    await cache.put(incoming, Buffer.from('abcdefgh'))
    expect(await cache.has(first)).toBe(true)
    expect(await cache.has(incoming)).toBe(false)

    await lease?.release()
    await cache.put(incoming, Buffer.from('abcdefgh'))
    expect(await cache.has(first)).toBe(false)
    expect(await cache.has(incoming)).toBe(true)
  })

  it('流式读取不调用兼容 readFile，并自动持有 lease 到 stream close', async () => {
    const cache = new DerivedDiskCache(rootDir, 64, 64)
    const streamed = address('streamed')
    await cache.put(streamed, Buffer.from('stream without full buffer read'))
    const readFile = vi.spyOn(fsp, 'readFile')
    const leasedStream = await cache.openReadStream(streamed)

    expect(leasedStream).not.toBeNull()
    expect(await cache.invalidate(streamed)).toBe(false)
    const chunks: Buffer[] = []
    if (leasedStream) {
      for await (const chunk of leasedStream.stream) chunks.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(chunks).toString()).toBe('stream without full buffer read')
    expect(readFile).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(await cache.invalidate(streamed)).toBe(true)
    })
    readFile.mockRestore()
  })

  it('重启后只扫描一次磁盘索引，随后用内存 LRU 决定逐出顺序', async () => {
    const first = address('persisted-first')
    const second = address('persisted-second')
    const writer = new DerivedDiskCache(rootDir, 8)
    await writer.put(first, Buffer.alloc(4, 1))
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    await writer.put(second, Buffer.alloc(4, 2))

    const reopened = new DerivedDiskCache(rootDir, 8)
    expect((await reopened.get(first))?.[0]).toBe(1)
    const third = address('new-third')
    await reopened.put(third, Buffer.alloc(4, 3))

    expect(await reopened.has(first)).toBe(true)
    expect(await reopened.has(second)).toBe(false)
    expect(await reopened.has(third)).toBe(true)
    await reopened.flushTouches()
  })

  it('首次建索引后连续 put 不重复扫描磁盘，并合并同一项的 touch 写回', async () => {
    const readdir = vi.spyOn(fsp, 'readdir')
    const utimes = vi.spyOn(fsp, 'utimes')
    const cache = new DerivedDiskCache(rootDir, 64, 16)
    const first = address('indexed-first')
    await cache.put(first, Buffer.alloc(4, 1))
    const initialScanCalls = readdir.mock.calls.length

    await cache.put(address('indexed-second'), Buffer.alloc(4, 2))
    await cache.put(address('indexed-third'), Buffer.alloc(4, 3))
    expect(readdir).toHaveBeenCalledTimes(initialScanCalls)

    await cache.get(first)
    await cache.get(first)
    await cache.get(first)
    expect(utimes).not.toHaveBeenCalled()
    await cache.flushTouches()
    expect(utimes).toHaveBeenCalledTimes(1)
    readdir.mockRestore()
    utimes.mockRestore()
  })
})
