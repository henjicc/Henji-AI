import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentAddressedResourceStore } from './resource-store'

let rootDir = ''
let store: ContentAddressedResourceStore

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-resource-'))
  store = new ContentAddressedResourceStore(rootDir)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('ContentAddressedResourceStore', () => {
  it('一个资源的去重校验挂起时，不同 id 的写入仍可完成', async () => {
    const bytes = Buffer.from('slow duplicate verification')
    const first = await store.putBuffer(bytes)
    const destination = store.getFilesystemPath(first.id)
    let entered!: () => void
    let resume!: () => void
    const enteredVerification = new Promise<void>((resolve) => { entered = resolve })
    const barrier = new Promise<void>((resolve) => { resume = resolve })
    const open = fsp.open.bind(fsp)
    const spy = vi.spyOn(fsp, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode)
      if (file === destination) { entered(); await barrier }
      return handle
    })
    const duplicate = store.putBuffer(bytes)
    let other: ReturnType<typeof store.putBuffer> | undefined
    try {
      await enteredVerification
      let completed = false
      other = store.putBuffer(Buffer.from('independent resource')).then((result) => {
        completed = true
        return result
      })
      await vi.waitFor(() => expect(completed).toBe(true), { timeout: 2_000, interval: 10 })
      expect((await other).created).toBe(true)
    } finally {
      resume()
      await Promise.allSettled([duplicate, ...(other ? [other] : [])])
      spy.mockRestore()
    }
    expect((await duplicate).created).toBe(false)
  })

  it('去重校验后对象消失时重新发布，而不是在刷新 mtime 时失败', async () => {
    const bytes = Buffer.from('duplicate collected before refresh')
    const first = await store.putBuffer(bytes)
    const destination = store.getFilesystemPath(first.id)
    const open = fsp.open.bind(fsp)
    const spy = vi.spyOn(fsp, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode)
      if (file === destination) {
        const close = handle.close.bind(handle)
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
          await close()
          // 模拟 GC 在完整校验结束、尚未进入刷新临界区时移除旧对象。
          await fsp.rm(destination)
        })
      }
      return handle
    })
    try {
      await expect(store.putBuffer(bytes)).resolves.toMatchObject({ id: first.id, created: true })
    } finally { spy.mockRestore() }
    expect((await store.garbageCollect(new Set())).deleted).toEqual([])
    expect((await store.verify(first.id)).byteLength).toBe(bytes.byteLength)
  })

  it('去重写入刷新旧对象年龄，默认 GC 保留尚未保存的引用', async () => {
    const bytes = Buffer.from('reused mask tile')
    const first = await store.putBuffer(bytes)
    const old = new Date(Date.now() - 120_000)
    await fsp.utimes(store.getFilesystemPath(first.id), old, old)
    expect((await store.putBuffer(bytes)).created).toBe(false)
    expect((await store.garbageCollect(new Set())).deleted).toEqual([])
    expect(await store.has(first.id)).toBe(true)
  })

  it('按 SHA-256 去重并拒绝与声明哈希不一致的内容', async () => {
    const bytes = Buffer.from('same immutable pixels')
    const expected = crypto.createHash('sha256').update(bytes).digest('hex')
    const first = await store.putBuffer(bytes, { mediaType: 'application/octet-stream' })
    const second = await store.putBuffer(bytes)

    expect(first.id).toBe(`sha256:${expected}`)
    expect(first.created).toBe(true)
    expect(second.id).toBe(first.id)
    expect(second.created).toBe(false)
    expect((await store.verify(first.id)).byteLength).toBe(bytes.byteLength)

    await expect(store.putBuffer(Buffer.from('tampered'), { expectedSha256: expected }))
      .rejects.toThrow('SHA-256 mismatch')
  })

  it('GC 保留活跃 lease，释放后只删除不在 live set 中的资源', async () => {
    const kept = await store.putBuffer(Buffer.from('referenced'))
    const leased = await store.putBuffer(Buffer.from('leased'))
    const orphan = await store.putBuffer(Buffer.from('orphan'))
    const lease = await store.acquireLease([leased.id])

    const first = await store.garbageCollect(new Set([kept.id]), { minimumAgeMs: 0 })
    expect(first.deleted).toContain(orphan.id)
    expect(first.retainedByLease).toEqual([leased.id])
    expect(await store.has(kept.id)).toBe(true)
    expect(await store.has(leased.id)).toBe(true)
    expect(await store.has(orphan.id)).toBe(false)

    await lease.release()
    await lease.release()
    const second = await store.garbageCollect(new Set([kept.id]), { minimumAgeMs: 0 })
    expect(second.deleted).toEqual([leased.id])
    expect(await store.has(leased.id)).toBe(false)
  })

  it('重复写入会校验既有对象，并隔离后重建损坏内容', async () => {
    const bytes = Buffer.from('authoritative pixels')
    const first = await store.putBuffer(bytes)
    await fsp.writeFile(store.getFilesystemPath(first.id), 'truncated')

    const repaired = await store.putBuffer(bytes)
    expect(repaired).toMatchObject({ id: first.id, created: true, byteLength: bytes.byteLength })
    expect(await store.verify(first.id)).toMatchObject({ id: first.id, byteLength: bytes.byteLength })
  })

  it('在流式写入越过硬上限前停止，且不遗留暂存文件', async () => {
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('1234')
      yield Buffer.from('5678')
    }

    await expect(store.putReadable(chunks(), { maxBytes: 7 }))
      .rejects.toThrow('exceeds maximum byte length')
    await expect(fsp.readdir(path.join(rootDir, '.staging'))).resolves.toEqual([])
    await expect(store.putBuffer(Buffer.from('ok'), { maxBytes: 0 }))
      .rejects.toThrow('positive safe integer')
  })

  it('putFile 只读取已打开的普通文件并拒绝符号链接', async () => {
    const sourcePath = path.join(rootDir, 'source.bin')
    const linkPath = path.join(rootDir, 'source-link.bin')
    await fsp.writeFile(sourcePath, 'source-bytes')
    await fsp.symlink(sourcePath, linkPath)

    await expect(store.putFile(sourcePath, { maxBytes: 32 }))
      .resolves.toMatchObject({ byteLength: 12 })
    await expect(store.putFile(linkPath, { maxBytes: 32 }))
      .rejects.toThrow('symbolic link')
  })

  it('所有流式读取都拒绝路径替换，并在结束前复核内容哈希', async () => {
    const stored = await store.putBuffer(Buffer.from('authoritative'))
    const resourcePath = store.getFilesystemPath(stored.id)
    await fsp.writeFile(resourcePath, 'same-length!!')

    await expect(store.readVerifiedBuffer(stored.id, 64)).rejects.toThrow('Corrupt resource')
    await fsp.rm(resourcePath)
    await fsp.symlink('/etc/hosts', resourcePath)
    expect(() => store.openReadStream(stored.id)).toThrow('symbolic link')
    await expect(store.describe(stored.id)).rejects.toThrow()
  })

  it('初始化时清理超过一天的中断暂存，但保留仍可能活跃的目录', async () => {
    const stagingDir = path.join(rootDir, '.staging')
    const staleFile = path.join(stagingDir, 'stale.tmp')
    const staleImport = path.join(rootDir, '.henjiimg-import-stale')
    const freshImport = path.join(rootDir, '.henjiimg-import-fresh')
    await fsp.mkdir(stagingDir, { recursive: true })
    await fsp.mkdir(staleImport)
    await fsp.mkdir(freshImport)
    await fsp.writeFile(staleFile, 'partial')
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1_000)
    await fsp.utimes(staleFile, staleTime, staleTime)
    await fsp.utimes(staleImport, staleTime, staleTime)

    await new ContentAddressedResourceStore(rootDir).initialize()

    await expect(fsp.access(staleFile)).rejects.toThrow()
    await expect(fsp.access(staleImport)).rejects.toThrow()
    await expect(fsp.access(freshImport)).resolves.toBeUndefined()
  })
})

it('隐私擦除只清除指定孤立资源，不等待年龄，也不触碰其他在途资源', async () => {
  const secret = await store.putBuffer(Buffer.from('private body')), image = await store.putBuffer(Buffer.from('private image')), other = await store.putBuffer(Buffer.from('other operation'))
  const erased = await store.garbageCollect(new Set(), { minimumAgeMs: 0, onlyResourceIds: new Set([secret.id, image.id]) })
  expect(new Set(erased.deleted)).toEqual(new Set([secret.id, image.id]))
  expect(await store.has(secret.id)).toBe(false); expect(await store.has(image.id)).toBe(false); expect(await store.has(other.id)).toBe(true)
})
